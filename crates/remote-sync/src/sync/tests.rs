use std::collections::HashMap;
use std::sync::Mutex;

use vrcx_0_nanashi_website_protocol::api::batch;
use vrcx_0_persistence::feed::test_support::seed_feed_bio_row;
use vrcx_0_persistence::remote_sync::streams::stream_spec;

use super::*;

const USER: &str = "usr_12345678-1234-1234-1234-1234567890ab";

#[derive(Default)]
struct FakeVault {
    info: Option<VaultInfo>,
    manifest: Option<(u64, Vec<u8>)>,
    chunks: Vec<(u64, ChunkId, Vec<u8>)>,
    next_seq: u64,
}

/// An in-memory server with the same rules as the real one: manifests only
/// move forward by one, and a repeated chunk id returns its first sequence.
#[derive(Default)]
struct FakeServer {
    vaults: Mutex<HashMap<VaultId, FakeVault>>,
    uploads: Mutex<u64>,
    fail_next_upload_response: Mutex<bool>,
}

fn api_error(status: u16, code: &str) -> Error {
    Error::Api {
        status,
        code: code.into(),
        message: String::new(),
    }
}

impl FakeServer {
    fn chunk_count(&self) -> usize {
        self.vaults
            .lock()
            .unwrap()
            .values()
            .map(|vault| vault.chunks.len())
            .sum()
    }

    fn vault_count(&self) -> usize {
        self.vaults.lock().unwrap().len()
    }

    fn tamper_with_first_chunk(&self) {
        let mut vaults = self.vaults.lock().unwrap();
        let chunk = &mut vaults.values_mut().next().unwrap().chunks[0];
        let last = chunk.2.len() - 1;
        chunk.2[last] ^= 1;
    }

    fn delete_everything(&self) {
        self.vaults.lock().unwrap().clear();
    }
}

impl SyncTransport for FakeServer {
    async fn list_vaults(&self) -> Result<Vec<VaultInfo>, Error> {
        Ok(self
            .vaults
            .lock()
            .unwrap()
            .values()
            .filter_map(|vault| vault.info.clone())
            .collect())
    }

    async fn create_vault(&self, request: CreateVaultRequest) -> Result<VaultInfo, Error> {
        let info = VaultInfo {
            vault_id: request.vault_id,
            vault_pk: request.vault_pk,
            manifest_pk: request.manifest_pk,
            created_at_ms: 0,
            max_seq: 0,
            manifest_seq: 0,
            usage_bytes: 0,
        };
        self.vaults.lock().unwrap().insert(
            request.vault_id,
            FakeVault {
                info: Some(info.clone()),
                ..FakeVault::default()
            },
        );
        Ok(info)
    }

    async fn get_manifest(&self, vault_id: VaultId) -> Result<(u64, Vec<u8>), Error> {
        let vaults = self.vaults.lock().unwrap();
        let vault = vaults
            .get(&vault_id)
            .ok_or_else(|| api_error(404, codes::VAULT_NOT_FOUND))?;
        vault
            .manifest
            .clone()
            .ok_or_else(|| api_error(404, codes::MANIFEST_NOT_FOUND))
    }

    async fn put_manifest(
        &self,
        vault_id: VaultId,
        manifest_seq: u64,
        body: Vec<u8>,
    ) -> Result<(), Error> {
        let mut vaults = self.vaults.lock().unwrap();
        let vault = vaults
            .get_mut(&vault_id)
            .ok_or_else(|| api_error(404, codes::VAULT_NOT_FOUND))?;
        let stored = vault.manifest.as_ref().map_or(0, |(seq, _)| *seq);
        if stored + 1 != manifest_seq {
            return Err(api_error(409, codes::MANIFEST_SEQ_CONFLICT));
        }
        vault.manifest = Some((manifest_seq, body));
        Ok(())
    }

    async fn upload_chunk(
        &self,
        vault_id: VaultId,
        chunk_id: ChunkId,
        body: Vec<u8>,
    ) -> Result<ChunkStored, Error> {
        *self.uploads.lock().unwrap() += 1;
        let mut vaults = self.vaults.lock().unwrap();
        let vault = vaults
            .get_mut(&vault_id)
            .ok_or_else(|| api_error(404, codes::VAULT_NOT_FOUND))?;
        let seq = match vault.chunks.iter().find(|(_, id, _)| *id == chunk_id) {
            Some((_, _, stored)) if *stored != body => {
                return Err(api_error(409, codes::CHUNK_ID_EXISTS))
            }
            Some((seq, _, _)) => *seq,
            None => {
                vault.next_seq += 1;
                vault.chunks.push((vault.next_seq, chunk_id, body));
                if let Some(info) = vault.info.as_mut() {
                    info.max_seq = vault.next_seq;
                    info.usage_bytes = vault
                        .chunks
                        .iter()
                        .map(|(_, _, blob)| blob.len() as u64)
                        .sum();
                }
                vault.next_seq
            }
        };
        if std::mem::take(&mut *self.fail_next_upload_response.lock().unwrap()) {
            return Err(Error::Transport("connection lost".into()));
        }
        Ok(ChunkStored { seq })
    }

    async fn download_batch(
        &self,
        vault_id: VaultId,
        after: u64,
        limit: u16,
    ) -> Result<(u64, bool, Vec<u8>), Error> {
        let vaults = self.vaults.lock().unwrap();
        let vault = vaults
            .get(&vault_id)
            .ok_or_else(|| api_error(404, codes::VAULT_NOT_FOUND))?;
        let matching = vault
            .chunks
            .iter()
            .filter(|(seq, _, _)| *seq > after)
            .collect::<Vec<_>>();
        let mut body = Vec::new();
        for (seq, chunk_id, blob) in matching.iter().take(limit as usize) {
            batch::encode_frame(&mut body, *seq, chunk_id, blob).unwrap();
        }
        Ok((vault.next_seq, matching.len() > limit as usize, body))
    }

    async fn compact_vault(
        &self,
        vault_id: VaultId,
        request: vrcx_0_nanashi_website_protocol::api::CompactRequest,
    ) -> Result<(), Error> {
        let mut vaults = self.vaults.lock().unwrap();
        let vault = vaults
            .get_mut(&vault_id)
            .ok_or_else(|| api_error(404, codes::VAULT_NOT_FOUND))?;
        for replacement in &request.chunk_ids {
            if !vault
                .chunks
                .iter()
                .any(|(seq, id, _)| *id == *replacement && *seq > request.replaces_up_to_seq)
            {
                return Err(api_error(400, "invalid_replacement"));
            }
        }
        vault
            .chunks
            .retain(|(seq, _, _)| *seq > request.replaces_up_to_seq);
        if let Some(info) = vault.info.as_mut() {
            info.usage_bytes = vault
                .chunks
                .iter()
                .map(|(_, _, blob)| blob.len() as u64)
                .sum();
        }
        Ok(())
    }

    async fn account_usage_and_quota(&self) -> Result<Option<(u64, u64)>, Error> {
        Ok(None)
    }
}

struct Pc {
    _dir: TestDir,
    db: Arc<DatabaseService>,
    signer: SignerKey,
    identity: SyncIdentity,
}

struct TestDir(std::path::PathBuf);

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn pc(name: &str) -> Pc {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path =
        std::env::temp_dir().join(format!("vrcx-0-sync-{name}-{}-{nonce}", std::process::id()));
    std::fs::create_dir_all(&path).unwrap();
    Pc {
        db: Arc::new(DatabaseService::new(&path.join("VRCX-0.sqlite3")).unwrap()),
        _dir: TestDir(path),
        signer: SignerKey::generate().unwrap(),
        identity: SyncIdentity {
            api_origin: "https://sync.example".into(),
            account_id: "acc_test".into(),
            vrchat_user_id: USER.into(),
            display_name: "Tester".into(),
            device_label: name.into(),
            app_version: "test".into(),
        },
    }
}

impl Pc {
    fn record(&self, created_at: &str, bio: &str) {
        seed_feed_bio_row(
            &self.db,
            USER,
            (created_at, "usr_friend", "Friend", bio, ""),
        )
        .unwrap();
    }

    async fn sync(&self, server: &FakeServer, secret: &SyncSecret) -> Result<SyncReport, Error> {
        sync_account(
            server,
            Arc::clone(&self.db),
            secret,
            &self.signer,
            &self.identity,
            &AtomicBool::new(false),
        )
        .await
    }

    fn unsent(&self) -> usize {
        let scope = StreamScope::open(&self.db, USER).unwrap();
        let state = store::vault_state_for_user(&self.db, "https://sync.example", "acc_test", USER)
            .unwrap();
        let after = state.map_or(0, |state| {
            store::push_cursor_get(&self.db, &state.vault, "feed_bio").unwrap()
        });
        export_rows(
            &self.db,
            &scope,
            stream_spec("feed_bio").unwrap(),
            after,
            100,
        )
        .unwrap()
        .len()
    }
}

#[tokio::test]
async fn two_pcs_exchange_history_without_echoing_it_back() {
    let server = FakeServer::default();
    let secret = SyncSecret::generate().unwrap();
    let (a, b) = (pc("a"), pc("b"));
    a.record("2026-10-10T10:00:00.000Z", "first");
    a.record("2026-10-10T11:00:00.000Z", "second");

    let first = a.sync(&server, &secret).await.unwrap();
    assert!(first.created_vault);
    assert_eq!((first.pushed_chunks, first.pushed_rows), (1, 2));

    let joined = b.sync(&server, &secret).await.unwrap();
    assert!(!joined.created_vault);
    assert_eq!(joined.vault_id, first.vault_id);
    assert_eq!((joined.imported_rows, joined.pushed_rows), (2, 0));
    assert_eq!(server.vault_count(), 1);

    b.record("2026-10-10T12:00:00.000Z", "third");
    let from_b = b.sync(&server, &secret).await.unwrap();
    assert_eq!((from_b.pushed_rows, from_b.imported_rows), (1, 0));
    let to_a = a.sync(&server, &secret).await.unwrap();
    assert_eq!((to_a.pushed_rows, to_a.imported_rows), (0, 1));

    // Nothing is left to send or receive, and nothing was uploaded twice.
    for pc in [&a, &b] {
        let idle = pc.sync(&server, &secret).await.unwrap();
        assert_eq!(
            (idle.pushed_chunks, idle.pulled_chunks, idle.gaps),
            (0, 0, 0)
        );
        assert_eq!(pc.unsent(), 0);
    }
    assert_eq!(server.chunk_count(), 2);
}

#[tokio::test]
async fn both_pcs_recording_the_same_event_keep_one_copy() {
    let server = FakeServer::default();
    let secret = SyncSecret::generate().unwrap();
    let (a, b) = (pc("a"), pc("b"));
    a.record("2026-10-10T10:00:00.000Z", "same");
    b.record("2026-10-10T10:00:03.500Z", "same");

    a.sync(&server, &secret).await.unwrap();
    let report = b.sync(&server, &secret).await.unwrap();
    assert_eq!((report.imported_rows, report.matched_rows), (0, 1));
    // B uploads before it pulls, so its own copy is sent too; every PC
    // still ends up with a single row.
    assert_eq!(report.pushed_rows, 1);
    let back = a.sync(&server, &secret).await.unwrap();
    assert_eq!((back.imported_rows, back.matched_rows), (0, 1));
}

#[tokio::test]
async fn an_upload_whose_reply_was_lost_is_not_stored_twice() {
    let server = FakeServer::default();
    let secret = SyncSecret::generate().unwrap();
    let a = pc("a");
    a.record("2026-10-10T10:00:00.000Z", "once");
    *server.fail_next_upload_response.lock().unwrap() = true;

    assert!(matches!(
        a.sync(&server, &secret).await,
        Err(Error::Transport(_))
    ));
    assert_eq!(server.chunk_count(), 1);
    let retry = a.sync(&server, &secret).await.unwrap();
    assert_eq!(retry.pushed_chunks, 1);
    assert_eq!(server.chunk_count(), 1);
    assert_eq!(*server.uploads.lock().unwrap(), 2);
    assert_eq!(a.unsent(), 0);
}

#[tokio::test]
async fn a_tampered_chunk_stops_the_import() {
    let server = FakeServer::default();
    let secret = SyncSecret::generate().unwrap();
    let (a, b) = (pc("a"), pc("b"));
    a.record("2026-10-10T10:00:00.000Z", "first");
    a.sync(&server, &secret).await.unwrap();
    server.tamper_with_first_chunk();

    assert!(matches!(
        b.sync(&server, &secret).await,
        Err(Error::Integrity(_))
    ));
    let state = store::vault_state_for_user(&b.db, "https://sync.example", "acc_test", USER)
        .unwrap()
        .unwrap();
    assert_eq!(state.pull_cursor, 0);
}

#[tokio::test]
async fn a_chunk_signed_by_an_unlisted_key_is_rejected() {
    let server = FakeServer::default();
    let secret = SyncSecret::generate().unwrap();
    let (a, b) = (pc("a"), pc("b"));
    a.record("2026-10-10T10:00:00.000Z", "first");
    a.sync(&server, &secret).await.unwrap();

    // Someone holding the vault key but no listed signing key adds a chunk.
    let vault_id = *server.vaults.lock().unwrap().keys().next().unwrap();
    let keys = VaultKeys::derive(&secret, vault_id);
    let draft = ChunkDraft {
        vault_id,
        source_id: SourceId::random().unwrap(),
        source_seq: 1,
        kind: ChunkKind::Rows,
        created_at_ms: now_ms(),
        app_version: "forged".into(),
        coverage: Vec::new(),
        dropped_rows: 0,
        body: ChunkBody::default(),
    };
    let (chunk_id, blob) =
        engine::seal_chunk(&draft, &SignerKey::generate().unwrap(), &keys).unwrap();
    server.upload_chunk(vault_id, chunk_id, blob).await.unwrap();

    assert!(matches!(
        b.sync(&server, &secret).await,
        Err(Error::Integrity(_))
    ));
}

#[tokio::test]
async fn a_different_key_does_not_adopt_someone_elses_vault() {
    let server = FakeServer::default();
    let (a, b) = (pc("a"), pc("b"));
    a.record("2026-10-10T10:00:00.000Z", "first");
    a.sync(&server, &SyncSecret::generate().unwrap())
        .await
        .unwrap();

    let other = b
        .sync(&server, &SyncSecret::generate().unwrap())
        .await
        .unwrap();
    assert!(other.created_vault);
    assert_eq!(other.imported_rows, 0);
    assert_eq!(server.vault_count(), 2);
}

#[tokio::test]
async fn deleting_server_data_keeps_local_history_and_uploads_it_again() {
    let server = FakeServer::default();
    let secret = SyncSecret::generate().unwrap();
    let a = pc("a");
    a.record("2026-10-10T10:00:00.000Z", "kept");
    a.sync(&server, &secret).await.unwrap();
    server.delete_everything();

    let again = a.sync(&server, &secret).await.unwrap();
    assert!(again.created_vault);
    assert_eq!(again.pushed_rows, 1);
    assert_eq!(server.chunk_count(), 1);
}

#[tokio::test]
async fn a_manifest_older_than_one_already_seen_is_refused() {
    let server = FakeServer::default();
    let secret = SyncSecret::generate().unwrap();
    let (a, b) = (pc("a"), pc("b"));
    a.sync(&server, &secret).await.unwrap();
    let old = server
        .vaults
        .lock()
        .unwrap()
        .values()
        .next()
        .unwrap()
        .manifest
        .clone();
    b.sync(&server, &secret).await.unwrap();
    a.sync(&server, &secret).await.unwrap();

    server
        .vaults
        .lock()
        .unwrap()
        .values_mut()
        .next()
        .unwrap()
        .manifest = old;
    assert!(matches!(
        a.sync(&server, &secret).await,
        Err(Error::Integrity(_))
    ));
}

#[tokio::test]
async fn a_cancelled_pass_stops_before_touching_the_server_history() {
    let server = FakeServer::default();
    let secret = SyncSecret::generate().unwrap();
    let a = pc("a");
    a.record("2026-10-10T10:00:00.000Z", "later");
    let report = sync_account(
        &server,
        Arc::clone(&a.db),
        &secret,
        &a.signer,
        &a.identity,
        &AtomicBool::new(true),
    )
    .await
    .unwrap();
    assert!(report.cancelled);
    assert_eq!(server.chunk_count(), 0);
    assert_eq!(a.unsent(), 1);
}

#[tokio::test]
async fn memos_reach_the_other_pc_and_a_later_edit_replaces_the_older_one() {
    use vrcx_0_persistence::remote_sync::streams::state_spec;
    let server = FakeServer::default();
    let secret = SyncSecret::generate().unwrap();
    let (a, b) = (pc("a"), pc("b"));
    let memo = |pc: &Pc| {
        let scope = StreamScope::open(&pc.db, USER).unwrap();
        export_state(&pc.db, &scope, state_spec("memos").unwrap())
            .unwrap()
            .rows
    };
    let write = |pc: &Pc, edited_at: &str, text: &str| {
        let scope = StreamScope::open(&pc.db, USER).unwrap();
        let state = store::vault_state_for_user(&pc.db, "https://sync.example", "acc_test", USER)
            .unwrap()
            .unwrap();
        import_chunk(
            &pc.db,
            &scope,
            ImportSource {
                vault: &state.vault,
                source_id: "local-edit",
                source_seq: edited_at.len() as u64 + text.len() as u64,
                server_seq: 0,
            },
            &[(
                "memos".to_owned(),
                vec![serde_json::json!({ "user_id": "usr_friend", "edited_at": edited_at, "memo": text })],
            )]
            .into_iter()
            .collect(),
        )
        .unwrap();
    };
    a.sync(&server, &secret).await.unwrap();
    b.sync(&server, &secret).await.unwrap();

    write(&a, "2026-10-01T00:00:00.000Z", "first");
    assert_eq!(a.sync(&server, &secret).await.unwrap().pushed_chunks, 1);
    b.sync(&server, &secret).await.unwrap();
    assert_eq!(memo(&b)[0]["memo"], "first");

    write(&b, "2026-10-02T00:00:00.000Z", "edited on b");
    b.sync(&server, &secret).await.unwrap();
    a.sync(&server, &secret).await.unwrap();
    assert_eq!(memo(&a)[0]["memo"], "edited on b");

    // Each PC re-sends a table after importing into it, then both settle.
    for _ in 0..2 {
        a.sync(&server, &secret).await.unwrap();
        b.sync(&server, &secret).await.unwrap();
    }
    let chunks = server.chunk_count();
    for pc in [&a, &b] {
        assert_eq!(pc.sync(&server, &secret).await.unwrap().pushed_chunks, 0);
    }
    assert_eq!(server.chunk_count(), chunks);
}
