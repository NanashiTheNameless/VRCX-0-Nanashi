//! One sync pass for one VRChat account: find or create its vault, make sure
//! this PC may write to it, upload local history, then import what other
//! sources uploaded. Everything the server returns is verified before use.

use std::collections::{BTreeMap, HashMap};
use std::future::Future;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use vrcx_0_nanashi_website_protocol::{
    api::{
        codes, ChunkStored, CompactRequest, CreateVaultRequest, ReplaceChunksRequest, VaultInfo,
    },
    b64,
    chunk::{ChunkBody, ChunkDraft, ChunkHeader, ChunkKind, CoveragePeriod, SignerLookup},
    ids::{ChunkId, SourceId, VaultId},
    keys::{SignerKey, VaultKeys},
    manifest::{Manifest, ManifestSubject, SignerEntry, SignerKind, MAX_REPLACED_RANGES},
    secret::SyncSecret,
};
use vrcx_0_persistence::remote_sync::{
    self as store,
    streams::{
        export_rows, export_rows_for_compaction, export_state, import_chunk_deduping, newest_rowid,
        stream_spec, Dedupe, ImportSource, StreamScope, DELETED_SUFFIX, ROW_STREAMS, STATE_STREAMS,
    },
    PendingChunk, ReplacedChunk, SyncLogEntry, VaultRef, VaultState,
};
use vrcx_0_persistence::DatabaseService;
use zeroize::Zeroizing;

use crate::{engine, Error, RemoteSyncClient};

// One request per chunk, so larger chunks mean fewer round trips. A chunk is
// imported in one write transaction on every other PC, which keeps the row
// limit from going higher, and the server accepts 4 MiB at most.
const CHUNK_ROW_LIMIT: usize = 4000;
const CHUNK_BYTE_LIMIT: usize = 2 * 1024 * 1024;
// The server caps pages at 500 chunks and 16 MiB. Use the full chunk limit to
// reduce round trips when catching up after a long offline period.
const PULL_BATCH: u16 = 500;
const MANIFEST_ATTEMPTS: usize = 3;
// Rewriting a chunk uploads the rows it keeps again. That only pays off when
// a fair share of the chunk goes away: at least one row in this many.
const REPLACE_REDUNDANT_SHARE: usize = 4;

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
        let remaining = limit.saturating_sub(pending) as u32;
        pending += store::streams::pending_row_count(db, &scope, spec, after, remaining)
            .map_err(storage)? as usize;
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
    ) -> impl Future<Output = Result<(), Error>> + Send;
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
    /// Whether the server can drop single chunks instead of only everything
    /// up to a point.
    fn supports_chunk_replace(&self) -> impl Future<Output = Result<bool, Error>> + Send;
    fn replace_chunks(
        &self,
        vault_id: VaultId,
        request: ReplaceChunksRequest,
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

    async fn create_vault(&self, request: CreateVaultRequest) -> Result<(), Error> {
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

    async fn supports_chunk_replace(&self) -> Result<bool, Error> {
        Ok(self.client.capabilities().await?.chunk_replace)
    }

    async fn replace_chunks(
        &self,
        vault_id: VaultId,
        request: ReplaceChunksRequest,
    ) -> Result<(), Error> {
        self.client
            .replace_chunks(&self.token, vault_id, &request)
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

/// What a running pass is busy with.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SyncPhase {
    Connecting,
    Reading,
    Uploading,
    Deduplicating,
}

/// How far a running pass is. Sequences are server chunk sequences: the pass
/// started reading after `read_from` and has to reach `read_total`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SyncProgressSnapshot {
    pub phase: SyncPhase,
    pub read_from: u64,
    pub read_through: u64,
    pub read_total: u64,
    pub imported_rows: u64,
    pub matched_rows: u64,
    pub pushed_rows: u64,
    pub replaced_chunks: u64,
}

/// Progress of the pass that is running, readable from another thread while
/// it works. It only counts; nothing a row contains is kept here.
#[derive(Debug, Default)]
pub struct SyncProgress {
    phase: AtomicU8,
    read_from: AtomicU64,
    read_through: AtomicU64,
    read_total: AtomicU64,
    imported_rows: AtomicU64,
    matched_rows: AtomicU64,
    pushed_rows: AtomicU64,
    replaced_chunks: AtomicU64,
}

impl SyncProgress {
    const PHASES: [SyncPhase; 4] = [
        SyncPhase::Connecting,
        SyncPhase::Reading,
        SyncPhase::Uploading,
        SyncPhase::Deduplicating,
    ];

    fn begin(&self) -> RunningPass<'_> {
        for counter in [
            &self.read_from,
            &self.read_through,
            &self.read_total,
            &self.imported_rows,
            &self.matched_rows,
            &self.pushed_rows,
            &self.replaced_chunks,
        ] {
            counter.store(0, Ordering::Relaxed);
        }
        self.set_phase(SyncPhase::Connecting);
        RunningPass(self)
    }

    fn set_phase(&self, phase: SyncPhase) {
        let index = Self::PHASES.iter().position(|known| *known == phase);
        self.phase
            .store(index.map_or(0, |index| index as u8 + 1), Ordering::Release);
    }

    /// `None` while no pass is running.
    pub fn snapshot(&self) -> Option<SyncProgressSnapshot> {
        let phase = match self.phase.load(Ordering::Acquire) {
            0 => return None,
            index => *Self::PHASES.get(index as usize - 1)?,
        };
        Some(SyncProgressSnapshot {
            phase,
            read_from: self.read_from.load(Ordering::Relaxed),
            read_through: self.read_through.load(Ordering::Relaxed),
            read_total: self.read_total.load(Ordering::Relaxed),
            imported_rows: self.imported_rows.load(Ordering::Relaxed),
            matched_rows: self.matched_rows.load(Ordering::Relaxed),
            pushed_rows: self.pushed_rows.load(Ordering::Relaxed),
            replaced_chunks: self.replaced_chunks.load(Ordering::Relaxed),
        })
    }
}

/// Marks the pass as over when it ends, however it ends.
struct RunningPass<'a>(&'a SyncProgress);

impl Drop for RunningPass<'_> {
    fn drop(&mut self) {
        self.0.phase.store(0, Ordering::Release);
    }
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
    /// Rows already present locally that arrived from another paired device.
    pub dedupe_candidates: u64,
    /// Chunks of other devices taken off the server because rows in them
    /// were stored there a second time.
    pub replaced_chunks: u64,
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

fn now_epoch() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
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
            if manifest.v == vrcx_0_nanashi_website_protocol::manifest::VERSION
                && manifest.signer(&signer.key_id(), now_epoch()).is_some()
            {
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
        if current.is_none() {
            next.dedupe_device_key_id = Some(signer.key_id());
        }
        next.add_signer(SignerEntry::new(
            &signer.public(),
            SignerKind::Device,
            identity.device_label.clone(),
            now_epoch(),
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

fn row_time(row: &serde_json::Value, column: &str) -> Option<i64> {
    match row.get(column)? {
        serde_json::Value::Number(number) => number.as_i64().map(|value| {
            if value.abs() >= 100_000_000_000 {
                value.div_euclid(1000)
            } else {
                value
            }
        }),
        serde_json::Value::String(text) => chrono::DateTime::parse_from_rfc3339(text)
            .ok()
            .map(|time| time.timestamp()),
        _ => None,
    }
}

struct BuiltChunk {
    kind: ChunkKind,
    body: ChunkBody,
    cursors: Vec<(String, i64)>,
    first: Option<i64>,
    last: Option<i64>,
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
        first: None,
        last: None,
    };
    let mut rows_left = CHUNK_ROW_LIMIT;
    let mut bytes = 0;
    for spec in ROW_STREAMS {
        if rows_left == 0 || bytes >= CHUNK_BYTE_LIMIT {
            break;
        }
        let after = store::push_cursor_get(db, vault, spec.name)?;
        // Read before the rows are: every row up to here exists by then.
        let newest = newest_rowid(db, scope, spec)?;
        let exported = export_rows(db, scope, spec, after, rows_left as u32)?;
        let reached_the_end = exported.len() < rows_left;
        let offered = exported.len();
        let mut taken = Vec::new();
        let mut cursor = after;
        for (rowid, row) in exported {
            let size = serde_json::to_vec(&row).map(|json| json.len()).unwrap_or(0);
            if !taken.is_empty() && bytes + size > CHUNK_BYTE_LIMIT {
                break;
            }
            bytes += size;
            cursor = rowid;
            if let Some(at) = row_time(&row, spec.time) {
                built.first = Some(built.first.map_or(at, |first| first.min(at)));
                built.last = Some(built.last.map_or(at, |last| last.max(at)));
            }
            taken.push(row);
        }
        // Every row up to the newest one is now either in this chunk, sent
        // earlier, or imported and never to be sent. Moving the cursor there
        // keeps the next pass from walking the imported rows again.
        if reached_the_end && taken.len() == offered {
            cursor = cursor.max(newest);
        }
        if !taken.is_empty() {
            rows_left -= taken.len();
            built.cursors.push((spec.name.to_owned(), cursor));
            built.body.streams.insert(spec.name.to_owned(), taken);
        } else if cursor > after {
            store::push_cursor_advance(db, vault, spec.name, cursor)?;
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
            first: None,
            last: None,
        }));
    }
    Ok(None)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct CompactionJournal {
    replaces_up_to_seq: u64,
    chunks: Vec<PendingChunk>,
    dropped_rows: u64,
}

struct CompactionJournalContext<'a> {
    db: &'a DatabaseService,
    scope: &'a StreamScope,
    vault: &'a Vault,
    signer: &'a SignerKey,
    identity: &'a SyncIdentity,
    replaces_up_to_seq: u64,
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
    } = context;
    let vault_ref = &vault.reference;
    let vault_id = vault.id;
    let source_id = vault.source_id;
    let keys = &vault.keys;
    let mut streams = Vec::<(String, Vec<serde_json::Value>)>::new();
    for spec in ROW_STREAMS {
        let rows = export_rows_for_compaction(db, scope, spec).map_err(storage)?;
        streams.push((spec.name.to_owned(), rows));
    }
    for spec in STATE_STREAMS {
        let exported = export_state(db, scope, spec).map_err(storage)?;
        streams.push((spec.name.to_owned(), exported.rows));
        if !exported.deleted.is_empty() {
            streams.push((format!("{}{DELETED_SUFFIX}", spec.name), exported.deleted));
        }
    }

    // Keep a known stream in the replacement set even when the vault has no
    // rows, so the server can verify and atomically compact the old range.
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
                created_at: now_epoch(),
                app_version: identity.app_version.clone(),
                coverage: Vec::new(),
                dropped_rows: 0,
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
            "deduplication would require more than 10000 replacement chunks".into(),
        ));
    }
    Ok(CompactionJournal {
        replaces_up_to_seq,
        chunks,
        dropped_rows: 0,
    })
}

async fn finish_compaction<T: SyncTransport>(
    transport: &T,
    db: &Arc<DatabaseService>,
    vault: &Vault,
    signer: &SignerKey,
    journal: &CompactionJournal,
) -> Result<(), Error> {
    let (manifest_seq, manifest_blob) = transport.get_manifest(vault.id).await?;
    let highest = store::vault_state_get(db, &vault.reference)
        .map_err(storage)?
        .map(|state| state.highest_manifest_seq);
    let current = engine::open_manifest(&manifest_blob, manifest_seq, &vault.keys, highest)?;
    if current.dedupe_device_key_id.as_deref() != Some(signer.key_id().as_str()) {
        return Err(Error::Transport(
            "this device is no longer selected to deduplicate the server".into(),
        ));
    }
    let mut uploaded = Vec::with_capacity(journal.chunks.len());
    for chunk in &journal.chunks {
        let blob = STANDARD
            .decode(&chunk.blob_base64)
            .map_err(|error| Error::Storage(error.to_string()))?;
        let chunk_id = chunk.chunk_id.parse().map_err(integrity)?;
        transport.upload_chunk(vault.id, chunk_id, blob).await?;
        uploaded.push(chunk_id);
    }

    // Everything each source sent so far is now in the snapshot, which is
    // also why its sequence numbers jump for the other PCs.
    let mut source_seqs: Vec<(SourceId, u64)> = store::seen_source_sequences(db, &vault.reference)
        .map_err(storage)?
        .into_iter()
        .filter_map(|(source, seq)| Some((source.parse().ok()?, seq)))
        .collect();
    if let Some(first) = journal.chunks.first() {
        source_seqs.push((vault.source_id, first.source_seq.saturating_sub(1)));
    }
    update_compacted_manifest(
        transport,
        db,
        vault,
        signer,
        journal.replaces_up_to_seq,
        &source_seqs,
    )
    .await?;
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
    store::compaction_journal_clear(db, &vault.reference).map_err(storage)?;
    store::replaced_chunks_clear(db, &vault.reference).map_err(storage)?;
    Ok(())
}

async fn update_compacted_manifest<T: SyncTransport>(
    transport: &T,
    db: &Arc<DatabaseService>,
    vault: &Vault,
    signer: &SignerKey,
    replaces_up_to_seq: u64,
    source_seqs: &[(SourceId, u64)],
) -> Result<(), Error> {
    let mut manifest_updated = false;
    for _ in 0..MANIFEST_ATTEMPTS {
        let (seq, blob) = transport.get_manifest(vault.id).await?;
        let highest = store::vault_state_get(db, &vault.reference)
            .map_err(storage)?
            .map(|state| state.highest_manifest_seq);
        let current = engine::open_manifest(&blob, seq, &vault.keys, highest)?;
        if current.dedupe_device_key_id.as_deref() != Some(signer.key_id().as_str()) {
            return Err(Error::Transport(
                "this device is no longer selected to deduplicate the server".into(),
            ));
        }
        if current.compacted_through_seq >= replaces_up_to_seq {
            manifest_updated = true;
            break;
        }
        let mut next = current.next();
        next.compact_through(replaces_up_to_seq, source_seqs.iter().copied());
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
    signer: &SignerKey,
) -> Result<bool, Error> {
    let Some(serialized) = store::compaction_journal_get(db, &vault.reference).map_err(storage)?
    else {
        return Ok(false);
    };
    let journal: CompactionJournal = serde_json::from_str(&serialized)
        .map_err(|error| Error::Storage(format!("Compaction journal is unreadable: {error}")))?;
    let (manifest_seq, manifest_blob) = transport.get_manifest(vault.id).await?;
    let highest = store::vault_state_get(db, &vault.reference)
        .map_err(storage)?
        .map(|state| state.highest_manifest_seq);
    let manifest = engine::open_manifest(&manifest_blob, manifest_seq, &vault.keys, highest)?;
    if manifest.dedupe_device_key_id.as_deref() != Some(signer.key_id().as_str()) {
        return Ok(false);
    }
    finish_compaction(transport, db, vault, signer, &journal).await?;
    Ok(true)
}

/// What both halves of a pass share.
struct Pass<'a, T> {
    transport: &'a T,
    db: &'a Arc<DatabaseService>,
    vault: &'a Vault,
    scope: &'a StreamScope,
    cancel: &'a AtomicBool,
    progress: &'a SyncProgress,
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
        progress,
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
                let coverage = match (built.first, built.last) {
                    (Some(first), Some(last)) => {
                        store::coverage_between(db, &identity.vrchat_user_id, first, last)
                            .map_err(storage)?
                            .into_iter()
                            .map(|(start, end)| CoveragePeriod { start, end })
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
                    created_at: now_epoch(),
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
                progress
                    .pushed_rows
                    .store(report.pushed_rows, Ordering::Relaxed);
                pending
            }
        };
        upload_pending(transport, db, vault, &pending).await?;
        report.pushed_chunks += 1;
    }
}

/// Uploads a chunk that was stored as pending and commits what waited on it.
async fn upload_pending<T: SyncTransport>(
    transport: &T,
    db: &Arc<DatabaseService>,
    vault: &Vault,
    pending: &PendingChunk,
) -> Result<(), Error> {
    let blob = STANDARD
        .decode(&pending.blob_base64)
        .map_err(|error| Error::Storage(error.to_string()))?;
    let chunk_id = pending.chunk_id.parse().map_err(integrity)?;
    let stored = transport.upload_chunk(vault.id, chunk_id, blob).await?;
    store::pending_chunk_commit(db, &vault.reference, pending).map_err(storage)?;
    // A chunk stored right after the pull cursor has nothing unread before
    // it, so this PC does not download its own upload again.
    store::pull_cursor_advance_over_own(db, &vault.reference, stored.seq).map_err(storage)
}

/// Present on the deduplicating device when the server can drop single
/// chunks.
struct Deduper<'a> {
    signer: &'a SignerKey,
    identity: &'a SyncIdentity,
    view: Arc<DedupeView>,
}

struct DedupeView {
    manifest: Manifest,
    own_chunks_intact: bool,
}

/// The rows of a chunk to keep on the server, or `None` when the chunk
/// should stay as it is. A chunk is only rewritten when this PC knows every
/// stream in it and enough of its rows are stored elsewhere to be worth
/// uploading the rest again.
fn rows_to_keep(
    mut streams: BTreeMap<String, Vec<serde_json::Value>>,
    redundant: &BTreeMap<String, Vec<usize>>,
) -> Option<BTreeMap<String, Vec<serde_json::Value>>> {
    let rows: usize = streams.values().map(Vec::len).sum();
    let removed: usize = redundant.values().map(Vec::len).sum();
    if removed == 0
        || removed * REPLACE_REDUNDANT_SHARE < rows
        || streams.keys().any(|name| stream_spec(name).is_none())
    {
        return None;
    }
    for (name, positions) in redundant {
        if let Some(rows) = streams.get_mut(name) {
            let mut position = 0;
            rows.retain(|_| {
                let keep = positions.binary_search(&position).is_err();
                position += 1;
                keep
            });
        }
    }
    streams.retain(|_, rows| !rows.is_empty());
    Some(streams)
}

/// Queues a chunk of another source for removal and uploads the rows it
/// keeps as a chunk of this PC. The server drops the old chunk later, in
/// `announce_replacements`, and only once the new one is stored.
async fn replace_chunk<T: SyncTransport>(
    pass: &Pass<'_, T>,
    deduper: &Deduper<'_>,
    header: &ChunkHeader,
    server_seq: u64,
    kept: BTreeMap<String, Vec<serde_json::Value>>,
) -> Result<(), Error> {
    let Pass {
        transport,
        db,
        vault,
        ..
    } = *pass;
    let mut replaced = ReplacedChunk {
        server_seq,
        source_id: header.source_id.to_string(),
        source_seq: header.source_seq,
        replacement: None,
    };
    if kept.is_empty() {
        return store::replaced_chunk_queue(db, &vault.reference, &replaced, None).map_err(storage);
    }
    let state = store::vault_state_get(db, &vault.reference)
        .map_err(storage)?
        .ok_or_else(|| Error::Storage("sync state is missing".into()))?;
    let source_seq = state.push_source_seq + 1;
    let draft = ChunkDraft {
        vault_id: vault.id,
        source_id: vault.source_id,
        source_seq,
        kind: ChunkKind::Rows,
        created_at: now_epoch(),
        app_version: deduper.identity.app_version.clone(),
        coverage: header.coverage.clone(),
        dropped_rows: header.dropped_rows,
        body: ChunkBody { streams: kept },
    };
    let (chunk_id, blob) = engine::seal_chunk(&draft, deduper.signer, &vault.keys)?;
    let pending = PendingChunk {
        chunk_id: chunk_id.to_string(),
        source_seq,
        blob_base64: STANDARD.encode(blob),
        cursors: Vec::new(),
    };
    replaced.replacement = Some((pending.chunk_id.clone(), source_seq));
    store::replaced_chunk_queue(db, &vault.reference, &replaced, Some(&pending))
        .map_err(storage)?;
    upload_pending(transport, db, vault, &pending).await
}

/// Lists the replaced chunks in the manifest, so the other PCs do not take
/// their absence for missing history, and then has the server drop them.
/// Repeating any step after an interruption changes nothing.
async fn announce_replacements<T: SyncTransport>(
    transport: &T,
    db: &Arc<DatabaseService>,
    vault: &Vault,
    signer: &SignerKey,
    identity: &SyncIdentity,
    report: &mut SyncReport,
) -> Result<(), Error> {
    let replaced = store::replaced_chunks_unannounced(db, &vault.reference).map_err(storage)?;
    let (Some(first), Some(last)) = (replaced.first(), replaced.last()) else {
        return Ok(());
    };
    let mut listed = false;
    for _ in 0..MANIFEST_ATTEMPTS {
        let (seq, blob) = transport.get_manifest(vault.id).await?;
        let highest = store::vault_state_get(db, &vault.reference)
            .map_err(storage)?
            .map(|state| state.highest_manifest_seq);
        let current = engine::open_manifest(&blob, seq, &vault.keys, highest)?;
        if current.dedupe_device_key_id.as_deref() != Some(signer.key_id().as_str()) {
            // Another device took over. The old chunks stay, which only
            // leaves rows on the server twice.
            return Ok(());
        }
        let mut next = current.next();
        for chunk in &replaced {
            next.mark_replaced(
                chunk.server_seq,
                chunk.source_id.parse().map_err(integrity)?,
                chunk.source_seq,
            );
        }
        if next.replaced_range_count() > MAX_REPLACED_RANGES {
            // Too many separate holes to list. One snapshot of everything
            // closes them all.
            return compact_fully(transport, db, vault, signer, identity).await;
        }
        if next.replaced_seqs == current.replaced_seqs
            && next.replaced_source_seqs == current.replaced_source_seqs
        {
            listed = true;
            break;
        }
        let sealed = engine::seal_manifest(&next, &vault.keys)?;
        match transport
            .put_manifest(vault.id, next.manifest_seq, sealed)
            .await
        {
            Ok(()) => {
                store::manifest_seq_advance(db, &vault.reference, next.manifest_seq)
                    .map_err(storage)?;
                listed = true;
                break;
            }
            Err(error) if is_api_error(&error, codes::MANIFEST_SEQ_CONFLICT) => continue,
            Err(error) => return Err(error),
        }
    }
    if !listed {
        return Err(Error::Transport(
            "the vault manifest kept changing; try again".into(),
        ));
    }
    let mut chunk_ids = Vec::new();
    for chunk in &replaced {
        if let Some((chunk_id, _)) = &chunk.replacement {
            chunk_ids.push(chunk_id.parse().map_err(integrity)?);
        }
    }
    transport
        .replace_chunks(
            vault.id,
            ReplaceChunksRequest {
                remove_seqs: replaced.iter().map(|chunk| chunk.server_seq).collect(),
                chunk_ids,
            },
        )
        .await?;
    store::replaced_chunks_announced(db, &vault.reference, last.server_seq).map_err(storage)?;
    report.replaced_chunks += replaced.len() as u64;
    log(
        db,
        &vault.reference,
        "dedupe",
        format!(
            "Replaced {} server chunks that repeated rows stored elsewhere.",
            replaced.len()
        ),
        Some((first.server_seq, last.server_seq)),
    )
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
            created_at: chrono::Utc::now().timestamp(),
        },
    )
    .map_err(storage)
}

async fn pull<T: SyncTransport>(
    pass: &Pass<'_, T>,
    manifest: &Manifest,
    deduper: Option<&Deduper<'_>>,
    report: &mut SyncReport,
) -> Result<(), Error> {
    let Pass {
        transport,
        db,
        vault,
        scope,
        cancel,
        progress,
    } = *pass;
    let mut sequences = store::seen_source_sequences(db, &vault.reference).map_err(storage)?;
    let started_after = store::vault_state_get(db, &vault.reference)
        .map_err(storage)?
        .map(|state| state.pull_cursor)
        .unwrap_or(0);
    progress.read_from.store(started_after, Ordering::Relaxed);
    progress.set_phase(SyncPhase::Reading);
    // Per source, the first and latest sequence of the snapshot being read.
    let mut snapshots = HashMap::<String, (u64, u64)>::new();
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
        progress.read_through.store(cursor, Ordering::Relaxed);
        progress.read_total.store(max_seq, Ordering::Relaxed);
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
            let is_other_source = opened.header.source_id != vault.source_id;
            let source_seq = opened.header.source_seq;
            let snapshot_from = if matches!(opened.header.kind, ChunkKind::Snapshot) {
                let first = match snapshots.get(&source_id) {
                    Some((first, latest)) if latest + 1 == source_seq => *first,
                    _ => source_seq,
                };
                snapshots.insert(source_id.clone(), (first, source_seq));
                Some(first)
            } else {
                snapshots.remove(&source_id);
                None
            };
            // A snapshot is the only copy of what it replaced, so only plain
            // chunks are checked for rows stored elsewhere.
            let view = deduper
                .filter(|_| matches!(opened.header.kind, ChunkKind::Rows))
                .map(|deduper| Arc::clone(&deduper.view));
            let header = opened.header;
            let streams: BTreeMap<_, _> = opened.body.streams;
            let stream_names: Vec<String> = streams.keys().cloned().collect();
            let (imported, streams) = blocking(move || {
                let replaced = |source: &str, seq: u64| {
                    view.as_ref().is_none_or(|view| {
                        source
                            .parse::<SourceId>()
                            .map_or(true, |id| view.manifest.source_seq_is_replaced(&id, seq))
                    })
                };
                let dedupe = view.as_ref().map(|view| Dedupe {
                    own_chunks_intact: view.own_chunks_intact,
                    replaced: &replaced,
                });
                let imported = import_chunk_deduping(
                    &worker_db,
                    &worker_scope,
                    ImportSource {
                        vault: &worker_vault,
                        source_id: &source_id,
                        source_seq,
                        server_seq,
                        snapshot_from,
                    },
                    &streams,
                    dedupe.as_ref(),
                )?;
                Ok((imported, streams))
            })
            .await?;
            if let Some(deduper) = deduper {
                if imported.invalid_rows == 0 && imported.unknown_streams.is_empty() {
                    if let Some(kept) = rows_to_keep(streams, &imported.redundant) {
                        replace_chunk(pass, deduper, &header, server_seq, kept).await?;
                    }
                }
            }
            report.pulled_chunks += 1;
            report.imported_rows += imported.inserted;
            progress.read_through.store(server_seq, Ordering::Relaxed);
            progress
                .imported_rows
                .fetch_add(imported.inserted, Ordering::Relaxed);
            progress
                .matched_rows
                .fetch_add(imported.matched, Ordering::Relaxed);
            if imported.inserted > 0 {
                for stream in stream_names {
                    if !report.imported_streams.contains(&stream) {
                        report.imported_streams.push(stream);
                    }
                }
            }
            report.matched_rows += imported.matched;
            if is_other_source {
                report.dedupe_candidates += imported.matched;
            }
            for stream in imported.unknown_streams {
                if !report.unknown_streams.contains(&stream) {
                    log(db, &vault.reference, "unknown_stream", format!("Skipped data of an unknown kind: {stream}. A newer app version may be needed."), None)?;
                    report.unknown_streams.push(stream);
                }
            }
            if imported.invalid_rows > 0 {
                report.invalid_rows += imported.invalid_rows;
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

/// Replaces the whole server history with one snapshot of what this PC
/// holds. Single chunks are replaced as they come in, so this only runs when
/// those replacements left more separate holes than the manifest may list.
async fn compact_fully<T: SyncTransport>(
    transport: &T,
    db: &Arc<DatabaseService>,
    vault: &Vault,
    signer: &SignerKey,
    identity: &SyncIdentity,
) -> Result<(), Error> {
    let info = transport
        .list_vaults()
        .await?
        .into_iter()
        .find(|info| info.vault_id == vault.id)
        .ok_or_else(|| Error::Transport("the synced vault disappeared".into()))?;
    let pull_cursor = store::vault_state_get(db, &vault.reference)
        .map_err(storage)?
        .map(|state| state.pull_cursor)
        .unwrap_or(0);
    // The snapshot must hold everything it replaces. Chunks this PC has not
    // read yet would be lost, so the next pass tries again.
    if pull_cursor < info.max_seq {
        return Ok(());
    }
    let scope = StreamScope::open(db, &identity.vrchat_user_id).map_err(storage)?;
    let journal = build_compaction_journal(CompactionJournalContext {
        db,
        scope: &scope,
        vault,
        signer,
        identity,
        replaces_up_to_seq: info.max_seq,
    })?;
    let serialized =
        serde_json::to_string(&journal).map_err(|error| Error::Storage(error.to_string()))?;
    store::compaction_journal_put(db, &vault.reference, &serialized).map_err(storage)?;
    finish_compaction(transport, db, vault, signer, &journal).await?;
    log(
        db,
        &vault.reference,
        "dedupe",
        "Merged and deduplicated the server history.".into(),
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
    progress: &SyncProgress,
) -> Result<SyncReport, Error> {
    let _running = progress.begin();
    let scope = StreamScope::open(&db, &identity.vrchat_user_id).map_err(storage)?;
    let vault = resolve_vault(transport, &db, secret, identity).await?;
    // A freshly created vault has no older remote history to compact. Record
    // that baseline before uploading so an interrupted first upload cannot
    // turn its retry into an unnecessary full-history rewrite.
    if vault.created {
        store::dedupe_checked_seq_set(&db, &vault.reference, 0).map_err(storage)?;
    }
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
    // A chunk left over from an interrupted pass goes up first: nothing new
    // may be sealed under its sequence number.
    if let Some(pending) = store::pending_chunk_get(&db, &vault.reference).map_err(storage)? {
        upload_pending(transport, &db, &vault, &pending).await?;
        report.pushed_chunks += 1;
    }
    let pass = Pass {
        transport,
        db: &db,
        vault: &vault,
        scope: &scope,
        cancel,
        progress,
    };
    // Other devices add themselves to the manifest before uploading, so it
    // is read again right before their chunks are verified.
    let manifest = ensure_manifest(transport, &db, &vault, signer, identity).await?;
    let deduplicating = manifest.dedupe_device_key_id.as_deref() == Some(signer.key_id().as_str())
        && transport.supports_chunk_replace().await.unwrap_or(false);
    let deduper = deduplicating.then(|| Deduper {
        signer,
        identity,
        view: Arc::new(DedupeView {
            own_chunks_intact: !manifest.source_has_replaced_seqs(&vault.source_id),
            manifest: manifest.clone(),
        }),
    });
    // Reading first means a row another device already uploaded is matched
    // here before this PC would upload its own copy of it.
    pull(&pass, &manifest, deduper.as_ref(), &mut report).await?;
    if report.cancelled {
        return Ok(report);
    }
    progress.set_phase(SyncPhase::Uploading);
    push(&pass, signer, identity, &mut report).await?;
    if !report.cancelled && deduper.is_some() {
        progress.set_phase(SyncPhase::Deduplicating);
        announce_replacements(transport, &db, &vault, signer, identity, &mut report).await?;
        progress
            .replaced_chunks
            .store(report.replaced_chunks, Ordering::Relaxed);
    }
    if !report.cancelled {
        store::last_sync_set(&db, &vault.reference, chrono::Utc::now().timestamp())
            .map_err(storage)?;
    }
    Ok(report)
}

#[cfg(test)]
mod tests;
