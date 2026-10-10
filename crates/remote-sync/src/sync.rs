//! One sync pass for one VRChat account: find or create its vault, make sure
//! this PC may write to it, upload local history, then import what other
//! sources uploaded. Everything the server returns is verified before use.

use std::collections::BTreeMap;
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use vrcx_0_nanashi_website_protocol::{
    api::{codes, ChunkStored, CompactRequest, CreateVaultRequest, VaultInfo},
    b64,
    chunk::{ChunkBody, ChunkDraft, ChunkKind, CoveragePeriod, SignerLookup},
    ids::{ChunkId, SourceId, VaultId},
    keys::{SignerKey, VaultKeys},
    manifest::{Manifest, ManifestSubject, RetentionSettings, SignerEntry, SignerKind},
    secret::SyncSecret,
};
use vrcx_0_persistence::remote_sync::{
    self as store,
    streams::{
        export_rows, export_rows_for_compaction, export_state, import_chunk, ImportSource,
        StreamScope, DELETED_SUFFIX, ROW_STREAMS, STATE_STREAMS,
    },
    PendingChunk, SyncLogEntry, VaultRef, VaultState,
};
use vrcx_0_persistence::DatabaseService;
use zeroize::Zeroizing;

use crate::{engine, Error, RemoteSyncClient};

const CHUNK_ROW_LIMIT: usize = 2000;
const CHUNK_BYTE_LIMIT: usize = 1024 * 1024;
const PULL_BATCH: u16 = 200;
const MANIFEST_ATTEMPTS: usize = 3;

/// Number of locally recorded rows waiting to be uploaded, capped at the
/// background trigger threshold so callers do not scan more than necessary.
pub fn pending_row_count(
    db: &DatabaseService,
    vault: &VaultRef,
    vrchat_user_id: &str,
    limit: usize,
) -> Result<usize, Error> {
    let scope = StreamScope::open(db, vrchat_user_id).map_err(storage)?;
    let mut pending = 0;
    for spec in ROW_STREAMS {
        let after = store::push_cursor_get(db, vault, spec.name).map_err(storage)?;
        pending += export_rows(
            db,
            &scope,
            spec,
            after,
            limit.saturating_sub(pending) as u32,
        )
        .map_err(storage)?
        .len();
        if pending >= limit {
            return Ok(pending);
        }
    }
    Ok(pending)
}

/// The server operations a sync pass needs, already bound to one account.
pub trait SyncTransport: Send + Sync {
    fn list_vaults(&self) -> impl Future<Output = Result<Vec<VaultInfo>, Error>> + Send;
    fn create_vault(
        &self,
        request: CreateVaultRequest,
    ) -> impl Future<Output = Result<VaultInfo, Error>> + Send;
    fn get_manifest(
        &self,
        vault_id: VaultId,
    ) -> impl Future<Output = Result<(u64, Vec<u8>), Error>> + Send;
    fn put_manifest(
        &self,
        vault_id: VaultId,
        manifest_seq: u64,
        body: Vec<u8>,
    ) -> impl Future<Output = Result<(), Error>> + Send;
    fn upload_chunk(
        &self,
        vault_id: VaultId,
        chunk_id: ChunkId,
        body: Vec<u8>,
    ) -> impl Future<Output = Result<ChunkStored, Error>> + Send;
    fn download_batch(
        &self,
        vault_id: VaultId,
        after: u64,
        limit: u16,
    ) -> impl Future<Output = Result<(u64, bool, Vec<u8>), Error>> + Send;
    fn compact_vault(
        &self,
        vault_id: VaultId,
        request: CompactRequest,
    ) -> impl Future<Output = Result<(), Error>> + Send;
    fn account_usage_and_quota(
        &self,
    ) -> impl Future<Output = Result<Option<(u64, u64)>, Error>> + Send;
}

pub struct AuthorizedClient {
    client: RemoteSyncClient,
    token: Zeroizing<String>,
}

impl AuthorizedClient {
    pub fn new(client: RemoteSyncClient, token: Zeroizing<String>) -> Self {
        Self { client, token }
    }
}

impl SyncTransport for AuthorizedClient {
    async fn list_vaults(&self) -> Result<Vec<VaultInfo>, Error> {
        self.client.vaults(&self.token).await
    }

    async fn create_vault(&self, request: CreateVaultRequest) -> Result<VaultInfo, Error> {
        self.client.create_vault(&self.token, &request).await
    }

    async fn get_manifest(&self, vault_id: VaultId) -> Result<(u64, Vec<u8>), Error> {
        self.client.get_manifest(&self.token, vault_id).await
    }

    async fn put_manifest(
        &self,
        vault_id: VaultId,
        manifest_seq: u64,
        body: Vec<u8>,
    ) -> Result<(), Error> {
        self.client
            .put_manifest(&self.token, vault_id, manifest_seq, manifest_seq - 1, body)
            .await
    }

    async fn upload_chunk(
        &self,
        vault_id: VaultId,
        chunk_id: ChunkId,
        body: Vec<u8>,
    ) -> Result<ChunkStored, Error> {
        self.client
            .upload_chunk(&self.token, vault_id, chunk_id, body)
            .await
    }

    async fn download_batch(
        &self,
        vault_id: VaultId,
        after: u64,
        limit: u16,
    ) -> Result<(u64, bool, Vec<u8>), Error> {
        self.client
            .download_chunk_batch(&self.token, vault_id, after, limit)
            .await
    }

    async fn compact_vault(&self, vault_id: VaultId, request: CompactRequest) -> Result<(), Error> {
        self.client
            .compact_vault(&self.token, vault_id, &request)
            .await
    }

    async fn account_usage_and_quota(&self) -> Result<Option<(u64, u64)>, Error> {
        let account = self.client.account(&self.token).await?;
        Ok(account
            .quota_bytes
            .map(|quota| (account.usage_bytes, quota)))
    }
}

#[derive(Clone, Debug)]
pub struct SyncIdentity {
    pub api_origin: String,
    pub account_id: String,
    pub vrchat_user_id: String,
    pub display_name: String,
    pub device_label: String,
    pub app_version: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SyncReport {
    pub vault_id: String,
    pub created_vault: bool,
    pub pushed_chunks: u64,
    pub pushed_rows: u64,
    pub pulled_chunks: u64,
    pub imported_rows: u64,
    pub imported_streams: Vec<String>,
    pub matched_rows: u64,
    pub gaps: u64,
    pub unknown_streams: Vec<String>,
    pub invalid_rows: u64,
    /// The pass stopped early because the app asked it to.
    pub cancelled: bool,
}

fn storage(error: vrcx_0_persistence::Error) -> Error {
    Error::Storage(error.to_string())
}

fn integrity(error: impl std::fmt::Display) -> Error {
    Error::Integrity(error.to_string())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, vrcx_0_persistence::Error> + Send + 'static,
) -> Result<T, Error> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| Error::Storage(error.to_string()))?
        .map_err(storage)
}

fn is_api_error(error: &Error, expected: &str) -> bool {
    matches!(error, Error::Api { code, .. } if code == expected)
}

struct Vault {
    reference: VaultRef,
    id: VaultId,
    keys: VaultKeys,
    source_id: SourceId,
    created: bool,
}

async fn resolve_vault<T: SyncTransport>(
    transport: &T,
    db: &Arc<DatabaseService>,
    secret: &SyncSecret,
    identity: &SyncIdentity,
) -> Result<Vault, Error> {
    let remote = transport.list_vaults().await?;
    let known = store::vault_state_for_user(
        db,
        &identity.api_origin,
        &identity.account_id,
        &identity.vrchat_user_id,
    )
    .map_err(storage)?;
    if let Some(state) = known {
        let id: VaultId = state.vault.vault_id.parse().map_err(integrity)?;
        if remote.iter().any(|info| info.vault_id == id) {
            return Ok(Vault {
                keys: VaultKeys::derive(secret, id),
                source_id: state.source_id.parse().map_err(integrity)?,
                reference: state.vault,
                id,
                created: false,
            });
        }
        // The vault was deleted on the server. Local history stays; the
        // sync state restarts so everything is uploaded again.
        store::clear_vault_state(db, &state.vault).map_err(storage)?;
    }

    let source_id = SourceId::random().map_err(integrity)?;
    let reference = |id: VaultId| VaultRef {
        api_origin: identity.api_origin.clone(),
        account_id: identity.account_id.clone(),
        vault_id: id.to_string(),
    };
    for info in &remote {
        let keys = VaultKeys::derive(secret, info.vault_id);
        if b64::encode(keys.public().vault_pk.as_bytes()) != info.vault_pk {
            continue;
        }
        let Ok((seq, blob)) = transport.get_manifest(info.vault_id).await else {
            continue;
        };
        let Ok(manifest) = engine::open_manifest(&blob, seq, &keys, None) else {
            continue;
        };
        if manifest
            .subject
            .is_some_and(|subject| subject.vrchat_user_id == identity.vrchat_user_id)
        {
            return Ok(Vault {
                reference: reference(info.vault_id),
                id: info.vault_id,
                keys,
                source_id,
                created: false,
            });
        }
    }

    let id = VaultId::random().map_err(integrity)?;
    let keys = VaultKeys::derive(secret, id);
    let public = keys.public();
    transport
        .create_vault(CreateVaultRequest {
            vault_id: id,
            vault_pk: b64::encode(public.vault_pk.as_bytes()),
            manifest_pk: b64::encode(public.manifest_pk.as_bytes()),
        })
        .await?;
    Ok(Vault {
        reference: reference(id),
        id,
        keys,
        source_id,
        created: true,
    })
}

/// Fetches and verifies the manifest, and adds this PC as a signer when it
/// is missing. Another device may write the manifest at the same moment, so
/// a sequence conflict fetches again and retries.
async fn ensure_manifest<T: SyncTransport>(
    transport: &T,
    db: &Arc<DatabaseService>,
    vault: &Vault,
    signer: &SignerKey,
    identity: &SyncIdentity,
) -> Result<Manifest, Error> {
    for _ in 0..MANIFEST_ATTEMPTS {
        let highest = store::vault_state_get(db, &vault.reference)
            .map_err(storage)?
            .map(|state| state.highest_manifest_seq);
        let current = match transport.get_manifest(vault.id).await {
            Ok((seq, blob)) => Some(engine::open_manifest(&blob, seq, &vault.keys, highest)?),
            Err(error) if is_api_error(&error, codes::MANIFEST_NOT_FOUND) => None,
            Err(error) => return Err(error),
        };
        if let Some(manifest) = &current {
            store::manifest_seq_advance(db, &vault.reference, manifest.manifest_seq)
                .map_err(storage)?;
            if manifest.signer(&signer.key_id(), now_ms()).is_some() {
                return Ok(manifest.clone());
            }
        }
        let mut next = match &current {
            Some(manifest) => manifest.next(),
            None => Manifest::new(
                vault.id,
                Some(ManifestSubject {
                    vrchat_user_id: identity.vrchat_user_id.clone(),
                    display_name: identity.display_name.clone(),
                }),
            ),
        };
        next.add_signer(SignerEntry::new(
            &signer.public(),
            SignerKind::Device,
            identity.device_label.clone(),
            now_ms(),
        ));
        let sealed = engine::seal_manifest(&next, &vault.keys)?;
        match transport
            .put_manifest(vault.id, next.manifest_seq, sealed)
            .await
        {
            Ok(()) => {
                store::manifest_seq_advance(db, &vault.reference, next.manifest_seq)
                    .map_err(storage)?;
                return Ok(next);
            }
            Err(error) if is_api_error(&error, codes::MANIFEST_SEQ_CONFLICT) => continue,
            Err(error) => return Err(error),
        }
    }
    Err(Error::Transport(
        "the vault manifest kept changing; try again".into(),
    ))
}

fn row_time_ms(row: &serde_json::Value, column: &str) -> Option<i64> {
    row.get(column)
        .and_then(serde_json::Value::as_str)
        .and_then(|text| chrono::DateTime::parse_from_rfc3339(text).ok())
        .map(|time| time.timestamp_millis())
}

struct BuiltChunk {
    kind: ChunkKind,
    body: ChunkBody,
    cursors: Vec<(String, i64)>,
    first_ms: Option<i64>,
    last_ms: Option<i64>,
}

/// Collects the next rows to upload, oldest first within each stream, up to
/// the chunk row and size limits.
fn build_chunk(
    db: &DatabaseService,
    scope: &StreamScope,
    vault: &VaultRef,
) -> Result<BuiltChunk, vrcx_0_persistence::Error> {
    let mut built = BuiltChunk {
        kind: ChunkKind::Rows,
        body: ChunkBody::default(),
        cursors: Vec::new(),
        first_ms: None,
        last_ms: None,
    };
    let mut rows_left = CHUNK_ROW_LIMIT;
    let mut bytes = 0;
    for spec in ROW_STREAMS {
        if rows_left == 0 || bytes >= CHUNK_BYTE_LIMIT {
            break;
        }
        let after = store::push_cursor_get(db, vault, spec.name)?;
        let mut taken = Vec::new();
        let mut cursor = after;
        for (rowid, row) in export_rows(db, scope, spec, after, rows_left as u32)? {
            let size = serde_json::to_vec(&row).map(|json| json.len()).unwrap_or(0);
            if !taken.is_empty() && bytes + size > CHUNK_BYTE_LIMIT {
                break;
            }
            bytes += size;
            cursor = rowid;
            if let Some(at) = row_time_ms(&row, spec.time) {
                built.first_ms = Some(built.first_ms.map_or(at, |first| first.min(at)));
                built.last_ms = Some(built.last_ms.map_or(at, |last| last.max(at)));
            }
            taken.push(row);
        }
        if !taken.is_empty() {
            rows_left -= taken.len();
            built.cursors.push((spec.name.to_owned(), cursor));
            built.body.streams.insert(spec.name.to_owned(), taken);
        }
    }
    if built.body.row_count() == 0 {
        if let Some(state) = build_state_chunk(db, scope, vault)? {
            return Ok(state);
        }
    }
    Ok(built)
}

/// Current-state tables (memos, notes, favorites and the like) are sent
/// whole whenever their content changed since the last upload. A table too
/// large for one chunk continues from where the previous chunk stopped.
fn build_state_chunk(
    db: &DatabaseService,
    scope: &StreamScope,
    vault: &VaultRef,
) -> Result<Option<BuiltChunk>, vrcx_0_persistence::Error> {
    for spec in STATE_STREAMS {
        let sent_key = format!("state:{}", spec.name);
        let offset_key = format!("stateoff:{}", spec.name);
        let exported = export_state(db, scope, spec)?;
        let (rows, fingerprint) = (exported.rows, exported.fingerprint);
        if fingerprint == 0 || fingerprint == store::push_cursor_get(db, vault, &sent_key)? {
            continue;
        }
        let offset =
            (store::push_cursor_get(db, vault, &offset_key)?.max(0) as usize).min(rows.len());
        let mut taken = Vec::new();
        let mut bytes = 0;
        for row in rows.iter().skip(offset).take(CHUNK_ROW_LIMIT) {
            let size = serde_json::to_vec(row).map(|json| json.len()).unwrap_or(0);
            if !taken.is_empty() && bytes + size > CHUNK_BYTE_LIMIT {
                break;
            }
            bytes += size;
            taken.push(row.clone());
        }
        let next = offset + taken.len();
        let cursors = if next >= rows.len() {
            vec![(sent_key, fingerprint), (offset_key, 0)]
        } else {
            vec![(offset_key, next as i64)]
        };
        let mut body = ChunkBody::default();
        body.streams.insert(spec.name.to_owned(), taken);
        if offset == 0 && !exported.deleted.is_empty() {
            body.streams
                .insert(format!("{}{DELETED_SUFFIX}", spec.name), exported.deleted);
        }
        return Ok(Some(BuiltChunk {
            kind: ChunkKind::Snapshot,
            body,
            cursors,
            first_ms: None,
            last_ms: None,
        }));
    }
    Ok(None)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct CompactionJournal {
    replaces_up_to_seq: u64,
    chunks: Vec<PendingChunk>,
    dropped_rows: u64,
    retention: RetentionSettings,
}

struct CompactionJournalContext<'a> {
    db: &'a DatabaseService,
    scope: &'a StreamScope,
    vault: &'a Vault,
    signer: &'a SignerKey,
    identity: &'a SyncIdentity,
    replaces_up_to_seq: u64,
    retention: RetentionSettings,
    size_target: Option<u64>,
}

fn build_compaction_journal(
    context: CompactionJournalContext<'_>,
) -> Result<CompactionJournal, Error> {
    let CompactionJournalContext {
        db,
        scope,
        vault,
        signer,
        identity,
        replaces_up_to_seq,
        retention,
        size_target,
    } = context;
    let vault_ref = &vault.reference;
    let vault_id = vault.id;
    let source_id = vault.source_id;
    let keys = &vault.keys;
    let cutoff_ms = retention
        .max_age_days
        .map(|days| now_ms().saturating_sub(i64::from(days).saturating_mul(86_400_000)));
    let mut streams = Vec::<(String, Vec<serde_json::Value>)>::new();
    let mut history = Vec::<(i64, usize, serde_json::Value)>::new();
    let mut estimated_bytes = 0u64;
    let mut age_dropped_rows = 0u64;
    for spec in ROW_STREAMS {
        let rows = export_rows_for_compaction(db, scope, spec).map_err(storage)?;
        for row in rows {
            let bytes = serde_json::to_vec(&row).map_or(0, |json| json.len());
            let at = row_time_ms(&row, spec.time).unwrap_or(i64::MAX);
            if cutoff_ms.is_some_and(|cutoff| at != i64::MAX && at < cutoff) {
                age_dropped_rows += 1;
                continue;
            }
            estimated_bytes = estimated_bytes.saturating_add(bytes as u64);
            history.push((
                at,
                streams.len(),
                serde_json::json!({"stream": spec.name, "row": row, "bytes": bytes}),
            ));
        }
    }
    for spec in STATE_STREAMS {
        let exported = export_state(db, scope, spec).map_err(storage)?;
        estimated_bytes = estimated_bytes.saturating_add(
            exported
                .rows
                .iter()
                .chain(exported.deleted.iter())
                .map(|row| serde_json::to_vec(row).map_or(0, |json| json.len()) as u64)
                .sum::<u64>(),
        );
        streams.push((spec.name.to_owned(), exported.rows));
        if !exported.deleted.is_empty() {
            streams.push((format!("{}{DELETED_SUFFIX}", spec.name), exported.deleted));
        }
    }

    let mut kept_history = BTreeMap::<String, Vec<serde_json::Value>>::new();
    for spec in ROW_STREAMS {
        kept_history.insert(spec.name.to_owned(), Vec::new());
    }
    // The byte target is an estimate of the replacement payload. Remove the
    // oldest history first; mutable state is always retained.
    history.sort_by_key(|(at, _, _)| *at);
    let mut dropped_bytes = 0u64;
    let mut dropped_rows = age_dropped_rows;
    let mut remove = vec![false; history.len()];
    if let Some(target) = size_target {
        for (index, (at, _, item)) in history.iter().enumerate() {
            if *at == i64::MAX {
                continue;
            }
            if estimated_bytes.saturating_sub(dropped_bytes) <= target {
                break;
            }
            dropped_bytes = dropped_bytes.saturating_add(item["bytes"].as_u64().unwrap_or(0));
            dropped_rows += 1;
            remove[index] = true;
        }
    }
    for (index, (_, _, item)) in history.into_iter().enumerate() {
        if remove[index] {
            continue;
        }
        if let (Some(name), Some(row)) = (item["stream"].as_str(), item.get("row")) {
            kept_history
                .entry(name.to_owned())
                .or_default()
                .push(row.clone());
        }
    }
    for (name, rows) in kept_history {
        if !rows.is_empty() {
            streams.push((name, rows));
        }
    }
    if streams.is_empty() {
        streams.push((ROW_STREAMS[0].name.to_owned(), Vec::new()));
    }
    // A tiny known-stream chunk lets a full vault compact its old payload
    // before the larger replacement snapshots are uploaded.
    streams.insert(0, (ROW_STREAMS[0].name.to_owned(), Vec::new()));

    let state = store::vault_state_get(db, vault_ref)
        .map_err(storage)?
        .ok_or_else(|| Error::Storage("sync state is missing".into()))?;
    let mut next_source_seq = state.push_source_seq;
    let mut chunks = Vec::new();
    for (name, rows) in streams {
        let mut start = 0usize;
        while start < rows.len() || (start == 0 && rows.is_empty()) {
            let mut end = start;
            let mut bytes = 0usize;
            while end < rows.len() && end - start < CHUNK_ROW_LIMIT {
                let size = serde_json::to_vec(&rows[end]).map_or(0, |json| json.len());
                if end > start && bytes.saturating_add(size) > CHUNK_BYTE_LIMIT {
                    break;
                }
                bytes = bytes.saturating_add(size);
                end += 1;
            }
            let mut body = ChunkBody::default();
            body.streams.insert(name.clone(), rows[start..end].to_vec());
            next_source_seq += 1;
            let draft = ChunkDraft {
                vault_id,
                source_id,
                source_seq: next_source_seq,
                kind: ChunkKind::Snapshot,
                created_at_ms: now_ms(),
                app_version: identity.app_version.clone(),
                coverage: Vec::new(),
                dropped_rows: if chunks.is_empty() { dropped_rows } else { 0 },
                body,
            };
            let (chunk_id, blob) = engine::seal_chunk(&draft, signer, keys)?;
            chunks.push(PendingChunk {
                chunk_id: chunk_id.to_string(),
                source_seq: next_source_seq,
                blob_base64: STANDARD.encode(blob),
                cursors: Vec::new(),
            });
            if end == rows.len() {
                break;
            }
            start = end;
        }
    }
    if chunks.len() > 10_000 {
        return Err(Error::Storage(
            "retention would require more than 10000 replacement chunks".into(),
        ));
    }
    Ok(CompactionJournal {
        replaces_up_to_seq,
        chunks,
        dropped_rows,
        retention,
    })
}

async fn finish_compaction<T: SyncTransport>(
    transport: &T,
    db: &Arc<DatabaseService>,
    vault: &Vault,
    journal: &CompactionJournal,
) -> Result<(), Error> {
    let mut uploaded = Vec::new();
    for chunk in &journal.chunks {
        let blob = STANDARD
            .decode(&chunk.blob_base64)
            .map_err(|error| Error::Storage(error.to_string()))?;
        let chunk_id = chunk.chunk_id.parse().map_err(integrity)?;
        match transport
            .upload_chunk(vault.id, chunk_id, blob.clone())
            .await
        {
            Ok(_) => uploaded.push(chunk_id),
            Err(error) if is_api_error(&error, codes::QUOTA_EXCEEDED) && !uploaded.is_empty() => {
                update_compacted_manifest(transport, db, vault, journal.replaces_up_to_seq).await?;
                transport
                    .compact_vault(
                        vault.id,
                        CompactRequest {
                            replaces_up_to_seq: journal.replaces_up_to_seq,
                            chunk_ids: uploaded.clone(),
                        },
                    )
                    .await?;
                transport.upload_chunk(vault.id, chunk_id, blob).await?;
                uploaded.push(chunk_id);
            }
            Err(error) => return Err(error),
        }
    }

    update_compacted_manifest(transport, db, vault, journal.replaces_up_to_seq).await?;
    transport
        .compact_vault(
            vault.id,
            CompactRequest {
                replaces_up_to_seq: journal.replaces_up_to_seq,
                chunk_ids: uploaded,
            },
        )
        .await?;
    if let Some(last) = journal.chunks.last() {
        store::push_source_seq_advance(db, &vault.reference, last.source_seq).map_err(storage)?;
    }
    store::pull_cursor_advance(db, &vault.reference, journal.replaces_up_to_seq)
        .map_err(storage)?;
    let latest_seq = transport
        .list_vaults()
        .await?
        .into_iter()
        .find(|info| info.vault_id == vault.id)
        .map(|info| info.max_seq)
        .ok_or_else(|| Error::Transport("the synced vault disappeared".into()))?;
    store::retention_state_set(
        db,
        &vault.reference,
        &store::RetentionState {
            max_age_days: journal.retention.max_age_days,
            keep_below_limit_margin_pct: journal.retention.keep_below_limit_margin_pct,
            applied_server_seq: latest_seq,
        },
    )
    .map_err(storage)?;
    store::compaction_journal_clear(db, &vault.reference).map_err(storage)?;
    Ok(())
}

async fn update_compacted_manifest<T: SyncTransport>(
    transport: &T,
    db: &Arc<DatabaseService>,
    vault: &Vault,
    replaces_up_to_seq: u64,
) -> Result<(), Error> {
    let mut manifest_updated = false;
    for _ in 0..MANIFEST_ATTEMPTS {
        let (seq, blob) = transport.get_manifest(vault.id).await?;
        let highest = store::vault_state_get(db, &vault.reference)
            .map_err(storage)?
            .map(|state| state.highest_manifest_seq);
        let current = engine::open_manifest(&blob, seq, &vault.keys, highest)?;
        if current.compacted_through_seq >= replaces_up_to_seq {
            manifest_updated = true;
            break;
        }
        let mut next = current.next();
        next.compacted_through_seq = replaces_up_to_seq;
        let sealed = engine::seal_manifest(&next, &vault.keys)?;
        match transport
            .put_manifest(vault.id, next.manifest_seq, sealed)
            .await
        {
            Ok(()) => {
                store::manifest_seq_advance(db, &vault.reference, next.manifest_seq)
                    .map_err(storage)?;
                manifest_updated = true;
                break;
            }
            Err(error) if is_api_error(&error, codes::MANIFEST_SEQ_CONFLICT) => continue,
            Err(error) => return Err(error),
        }
    }
    if !manifest_updated {
        return Err(Error::Transport(
            "the vault manifest kept changing during compaction; try again".into(),
        ));
    }
    Ok(())
}

async fn resume_compaction<T: SyncTransport>(
    transport: &T,
    db: &Arc<DatabaseService>,
    vault: &Vault,
    _signer: &SignerKey,
) -> Result<bool, Error> {
    let Some(serialized) = store::compaction_journal_get(db, &vault.reference).map_err(storage)?
    else {
        return Ok(false);
    };
    let journal: CompactionJournal = serde_json::from_str(&serialized)
        .map_err(|error| Error::Storage(format!("Compaction journal is unreadable: {error}")))?;
    finish_compaction(transport, db, vault, &journal).await?;
    Ok(true)
}

/// What both halves of a pass share.
struct Pass<'a, T> {
    transport: &'a T,
    db: &'a Arc<DatabaseService>,
    vault: &'a Vault,
    scope: &'a StreamScope,
    cancel: &'a AtomicBool,
}

async fn push<T: SyncTransport>(
    pass: &Pass<'_, T>,
    signer: &SignerKey,
    identity: &SyncIdentity,
    report: &mut SyncReport,
) -> Result<(), Error> {
    let Pass {
        transport,
        db,
        vault,
        scope,
        cancel,
    } = *pass;
    loop {
        if cancel.load(Ordering::Acquire) {
            report.cancelled = true;
            return Ok(());
        }
        let pending = match store::pending_chunk_get(db, &vault.reference).map_err(storage)? {
            Some(pending) => pending,
            None => {
                let (worker_db, worker_scope, worker_vault) =
                    (Arc::clone(db), scope.clone(), vault.reference.clone());
                let built =
                    blocking(move || build_chunk(&worker_db, &worker_scope, &worker_vault)).await?;
                if built.body.row_count() == 0 {
                    return Ok(());
                }
                let state = store::vault_state_get(db, &vault.reference)
                    .map_err(storage)?
                    .ok_or_else(|| Error::Storage("sync state is missing".into()))?;
                let coverage = match (built.first_ms, built.last_ms) {
                    (Some(first), Some(last)) => {
                        store::coverage_between(db, &identity.vrchat_user_id, first, last)
                            .map_err(storage)?
                            .into_iter()
                            .map(|(start_ms, end_ms)| CoveragePeriod { start_ms, end_ms })
                            .collect()
                    }
                    _ => Vec::new(),
                };
                let source_seq = state.push_source_seq + 1;
                let draft = ChunkDraft {
                    vault_id: vault.id,
                    source_id: vault.source_id,
                    source_seq,
                    kind: built.kind,
                    created_at_ms: now_ms(),
                    app_version: identity.app_version.clone(),
                    coverage,
                    dropped_rows: 0,
                    body: built.body,
                };
                let (chunk_id, blob) = engine::seal_chunk(&draft, signer, &vault.keys)?;
                let pending = PendingChunk {
                    chunk_id: chunk_id.to_string(),
                    source_seq,
                    blob_base64: STANDARD.encode(blob),
                    cursors: built.cursors,
                };
                store::pending_chunk_put(db, &vault.reference, &pending).map_err(storage)?;
                report.pushed_rows += draft.body.row_count() as u64;
                pending
            }
        };
        let blob = STANDARD
            .decode(&pending.blob_base64)
            .map_err(|error| Error::Storage(error.to_string()))?;
        let chunk_id = pending.chunk_id.parse().map_err(integrity)?;
        transport.upload_chunk(vault.id, chunk_id, blob).await?;
        store::pending_chunk_commit(db, &vault.reference, &pending).map_err(storage)?;
        report.pushed_chunks += 1;
    }
}

fn log(
    db: &DatabaseService,
    vault: &VaultRef,
    kind: &str,
    message: String,
    range: Option<(u64, u64)>,
) -> Result<(), Error> {
    store::sync_log_record(
        db,
        vault,
        &SyncLogEntry {
            kind: kind.into(),
            message,
            first_seq: range.map(|(first, _)| first),
            last_seq: range.map(|(_, last)| last),
            created_at_ms: now_ms(),
        },
    )
    .map_err(storage)
}

async fn pull<T: SyncTransport>(
    pass: &Pass<'_, T>,
    manifest: &Manifest,
    report: &mut SyncReport,
) -> Result<(), Error> {
    let Pass {
        transport,
        db,
        vault,
        scope,
        cancel,
    } = *pass;
    let mut sequences = store::seen_source_sequences(db, &vault.reference).map_err(storage)?;
    loop {
        if cancel.load(Ordering::Acquire) {
            report.cancelled = true;
            return Ok(());
        }
        let cursor = store::vault_state_get(db, &vault.reference)
            .map_err(storage)?
            .map(|state| state.pull_cursor)
            .unwrap_or(0);
        let (max_seq, has_more, bytes) = transport
            .download_batch(vault.id, cursor, PULL_BATCH)
            .await?;
        if max_seq < cursor {
            return Err(Error::Integrity(
                "the server returned an older history than this PC already synced".into(),
            ));
        }
        let verified = engine::verify_batch(
            &bytes,
            cursor,
            manifest.compacted_through_seq,
            &vault.keys,
            manifest,
            vault.source_id,
            &mut sequences,
        )?;
        for (first, last) in &verified.server_gaps {
            report.gaps += 1;
            log(
                db,
                &vault.reference,
                "gap",
                format!("Chunks {first} to {last} are missing on the server."),
                Some((*first, *last)),
            )?;
        }
        for (source, first, last) in &verified.source_gaps {
            report.gaps += 1;
            log(
                db,
                &vault.reference,
                "gap",
                format!("Source {source} is missing its chunks {first} to {last}."),
                Some((*first, *last)),
            )?;
        }
        for (server_seq, opened) in verified.chunks {
            let (worker_db, worker_scope, worker_vault) =
                (Arc::clone(db), scope.clone(), vault.reference.clone());
            let source_id = opened.header.source_id.to_string();
            let source_seq = opened.header.source_seq;
            let streams: BTreeMap<_, _> = opened.body.streams;
            let stream_names: Vec<String> = streams.keys().cloned().collect();
            let imported = blocking(move || {
                import_chunk(
                    &worker_db,
                    &worker_scope,
                    ImportSource {
                        vault: &worker_vault,
                        source_id: &source_id,
                        source_seq,
                        server_seq,
                    },
                    &streams,
                )
            })
            .await?;
            report.pulled_chunks += 1;
            report.imported_rows += imported.inserted;
            if imported.inserted > 0 {
                for stream in stream_names {
                    if !report.imported_streams.contains(&stream) {
                        report.imported_streams.push(stream);
                    }
                }
            }
            report.matched_rows += imported.matched;
            for stream in imported.unknown_streams {
                if !report.unknown_streams.contains(&stream) {
                    log(db, &vault.reference, "unknown_stream", format!("Skipped data of an unknown kind: {stream}. A newer app version may be needed."), None)?;
                    report.unknown_streams.push(stream);
                }
            }
            if imported.invalid_rows > 0 {
                report.invalid_rows += imported.invalid_rows as u64;
                log(
                    db,
                    &vault.reference,
                    "invalid_rows",
                    format!(
                        "Skipped {} unreadable rows in chunk {server_seq}.",
                        imported.invalid_rows
                    ),
                    Some((server_seq, server_seq)),
                )?;
            }
        }
        store::pull_cursor_advance(db, &vault.reference, verified.next_cursor).map_err(storage)?;
        if !has_more || verified.next_cursor <= cursor {
            return Ok(());
        }
    }
}

async fn apply_retention<T: SyncTransport>(
    transport: &T,
    db: &Arc<DatabaseService>,
    vault: &Vault,
    signer: &SignerKey,
    identity: &SyncIdentity,
    manifest: &Manifest,
    report: &SyncReport,
) -> Result<(), Error> {
    if report.gaps > 0 || report.invalid_rows > 0 || !report.unknown_streams.is_empty() {
        return Ok(());
    }
    let retention = manifest.retention;
    if !retention.is_valid()
        || (retention.max_age_days.is_none() && retention.keep_below_limit_margin_pct.is_none())
    {
        return Ok(());
    }
    let info = transport
        .list_vaults()
        .await?
        .into_iter()
        .find(|info| info.vault_id == vault.id)
        .ok_or_else(|| Error::Transport("the synced vault disappeared".into()))?;
    if info.max_seq <= manifest.compacted_through_seq {
        return Ok(());
    }
    if store::retention_state_get(db, &vault.reference)
        .map_err(storage)?
        .is_some_and(|applied| {
            applied.max_age_days == retention.max_age_days
                && applied.keep_below_limit_margin_pct == retention.keep_below_limit_margin_pct
                && info.max_seq <= applied.applied_server_seq
        })
    {
        return Ok(());
    }
    let age_cutoff = retention
        .max_age_days
        .map(|days| now_ms().saturating_sub(i64::from(days).saturating_mul(86_400_000)));
    let scope = StreamScope::open(db, &identity.vrchat_user_id).map_err(storage)?;
    let mut expired = false;
    if let Some(cutoff) = age_cutoff {
        for spec in ROW_STREAMS {
            if export_rows_for_compaction(db, &scope, spec)
                .map_err(storage)?
                .iter()
                .any(|row| row_time_ms(row, spec.time).is_some_and(|at| at < cutoff))
            {
                expired = true;
                break;
            }
        }
    }
    let size_target = if retention.keep_below_limit_margin_pct.is_some() {
        transport
            .account_usage_and_quota()
            .await?
            .and_then(|(usage, quota)| retention.size_target(quota).map(|target| (usage, target)))
            .filter(|(usage, target)| usage > target)
            .map(|(_, target)| target)
    } else {
        None
    };
    if !expired && size_target.is_none() {
        return Ok(());
    }
    let journal = build_compaction_journal(CompactionJournalContext {
        db,
        scope: &scope,
        vault,
        signer,
        identity,
        replaces_up_to_seq: info.max_seq,
        retention,
        size_target,
    })?;
    if journal.dropped_rows == 0 {
        store::retention_state_set(
            db,
            &vault.reference,
            &store::RetentionState {
                max_age_days: retention.max_age_days,
                keep_below_limit_margin_pct: retention.keep_below_limit_margin_pct,
                applied_server_seq: info.max_seq,
            },
        )
        .map_err(storage)?;
        return Ok(());
    }
    let serialized =
        serde_json::to_string(&journal).map_err(|error| Error::Storage(error.to_string()))?;
    store::compaction_journal_put(db, &vault.reference, &serialized).map_err(storage)?;
    finish_compaction(transport, db, vault, &journal).await?;
    log(
        db,
        &vault.reference,
        "retention",
        format!(
            "Removed {} old history rows from the server copy.",
            journal.dropped_rows
        ),
        None,
    )?;
    Ok(())
}

pub async fn sync_account<T: SyncTransport>(
    transport: &T,
    db: Arc<DatabaseService>,
    secret: &SyncSecret,
    signer: &SignerKey,
    identity: &SyncIdentity,
    cancel: &AtomicBool,
) -> Result<SyncReport, Error> {
    let scope = StreamScope::open(&db, &identity.vrchat_user_id).map_err(storage)?;
    let vault = resolve_vault(transport, &db, secret, identity).await?;
    let mut report = SyncReport {
        vault_id: vault.reference.vault_id.clone(),
        created_vault: vault.created,
        ..SyncReport::default()
    };
    if store::vault_state_get(&db, &vault.reference)
        .map_err(storage)?
        .is_none()
    {
        store::vault_state_save(
            &db,
            &VaultState {
                vault: vault.reference.clone(),
                vrchat_user_id: identity.vrchat_user_id.clone(),
                source_id: vault.source_id.to_string(),
                pull_cursor: 0,
                highest_manifest_seq: 0,
                push_source_seq: 0,
            },
        )
        .map_err(storage)?;
    }
    ensure_manifest(transport, &db, &vault, signer, identity).await?;
    let _ = resume_compaction(transport, &db, &vault, signer).await?;
    let pass = Pass {
        transport,
        db: &db,
        vault: &vault,
        scope: &scope,
        cancel,
    };
    push(&pass, signer, identity, &mut report).await?;
    if report.cancelled {
        return Ok(report);
    }
    // Other devices add themselves to the manifest before uploading, so it
    // is read again right before their chunks are verified.
    let manifest = ensure_manifest(transport, &db, &vault, signer, identity).await?;
    pull(&pass, &manifest, &mut report).await?;
    if !report.cancelled {
        apply_retention(transport, &db, &vault, signer, identity, &manifest, &report).await?;
    }
    if !report.cancelled {
        store::last_sync_set(&db, &vault.reference, now_ms()).map_err(storage)?;
    }
    Ok(report)
}

#[cfg(test)]
mod tests;
