use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use vrcx_0_logger_protocol::envelope::{EnvelopeError, SecretKey};
use vrcx_0_logger_protocol::wire::{FrameKind, WireFrame, MAX_FRAMES_PAGE};

use crate::runtime::lock;

pub const STORAGE_SALT: &[u8] = b"vrcx0-storage";
const DATABASE_FILE: &str = "logger.sqlite3";
const CHECK_NAME: &str = "check";
const CHECK_PLAINTEXT: &[u8] = b"vrcx0-logger-storage-check";
pub const DROPPED_AFTER_PASSWORD_CHANGE: &str = "dropped_after_password_change";
pub const CREDENTIALS: &str = "credentials";
pub const WEBHOOK: &str = "webhook";
pub const DROPPED_UNSYNCED: &str = "dropped_unsynced";
const PRUNE_BATCH: i64 = 200;
const SCHEMA_VERSION: i64 = 1;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("database: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("data directory: {0}")]
    Io(#[from] std::io::Error),
    #[error("storage encryption: {0}")]
    Envelope(#[from] EnvelopeError),
    #[error("stored value encoding: {0}")]
    Encoding(#[from] serde_json::Error),
    #[error(
        "data directory was written by a newer logger (schema {found}, supported {SCHEMA_VERSION})"
    )]
    NewerSchema { found: i64 },
}

#[derive(Default)]
pub struct FrameStats {
    pub count: u64,
    pub oldest_at: Option<i64>,
    pub newest_at: Option<i64>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum KeyCheck {
    Fresh,
    Matched,
    PasswordChanged { dropped_frames: u64 },
}

pub struct Store {
    connection: Mutex<Connection>,
    path: PathBuf,
    key: SecretKey,
}

impl Store {
    pub fn open(data_dir: &Path, key: SecretKey) -> Result<(Self, KeyCheck), StoreError> {
        std::fs::create_dir_all(data_dir)?;
        restrict_permissions(data_dir, 0o700)?;
        let path = data_dir.join(DATABASE_FILE);
        let connection = Connection::open(&path)?;
        restrict_permissions(&path, 0o600)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "NORMAL")?;
        migrate(&connection)?;
        let store = Self {
            connection: Mutex::new(connection),
            path,
            key,
        };
        let check = store.verify_key()?;
        Ok((store, check))
    }

    fn verify_key(&self) -> Result<KeyCheck, StoreError> {
        let Some(sealed) = self.raw_sealed(CHECK_NAME)? else {
            self.put_sealed(CHECK_NAME, CHECK_PLAINTEXT)?;
            return Ok(KeyCheck::Fresh);
        };
        if self.key.open(&sealed, CHECK_NAME.as_bytes()).is_ok() {
            return Ok(KeyCheck::Matched);
        }

        let dropped_frames = {
            let mut connection = self.connection();
            let transaction = connection.transaction()?;
            let dropped = transaction.execute("DELETE FROM frames", [])?;
            transaction.execute("DELETE FROM sealed", [])?;
            add_counter(&transaction, DROPPED_AFTER_PASSWORD_CHANGE, dropped)?;
            transaction.commit()?;
            u64::try_from(dropped).unwrap_or_default()
        };
        self.put_sealed(CHECK_NAME, CHECK_PLAINTEXT)?;
        Ok(KeyCheck::PasswordChanged { dropped_frames })
    }

    pub fn put_sealed(&self, name: &str, plaintext: &[u8]) -> Result<(), StoreError> {
        let sealed = self.key.seal(plaintext, name.as_bytes())?;
        self.connection().execute(
            "INSERT INTO sealed (name, value) VALUES (?1, ?2)
             ON CONFLICT(name) DO UPDATE SET value = excluded.value",
            params![name, sealed],
        )?;
        Ok(())
    }

    pub fn get_sealed(&self, name: &str) -> Result<Option<Vec<u8>>, StoreError> {
        let Some(sealed) = self.raw_sealed(name)? else {
            return Ok(None);
        };
        Ok(Some(self.key.open(&sealed, name.as_bytes())?))
    }

    pub fn delete_sealed(&self, name: &str) -> Result<(), StoreError> {
        self.connection()
            .execute("DELETE FROM sealed WHERE name = ?1", params![name])?;
        Ok(())
    }

    pub fn insert_frame(
        &self,
        kind: FrameKind,
        received_at: DateTime<Utc>,
        account_id: &str,
        payload: &str,
    ) -> Result<i64, StoreError> {
        let kind = frame_kind_name(kind);
        let received_at_text = received_at.to_rfc3339();
        let sealed = self
            .key
            .seal(payload.as_bytes(), &frame_aad(kind, &received_at_text))?;
        let connection = self.connection();
        connection.execute(
            "INSERT INTO frames (kind, received_at, received_unix, account_id, payload)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                kind,
                received_at_text,
                received_at.timestamp(),
                account_id,
                sealed
            ],
        )?;
        Ok(connection.last_insert_rowid())
    }

    pub fn last_seq(&self) -> Result<i64, StoreError> {
        Ok(self
            .connection()
            .query_row(
                "SELECT seq FROM sqlite_sequence WHERE name = 'frames'",
                [],
                |row| row.get(0),
            )
            .optional()?
            .unwrap_or_default())
    }

    pub fn frame_stats(&self, account_id: &str) -> Result<FrameStats, StoreError> {
        let (count, oldest_at, newest_at): (i64, Option<i64>, Option<i64>) =
            self.connection().query_row(
                "SELECT COUNT(*), MIN(received_unix), MAX(received_unix)
                 FROM frames WHERE account_id = ?1",
                params![account_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?;
        Ok(FrameStats {
            count: u64::try_from(count).unwrap_or_default(),
            oldest_at,
            newest_at,
        })
    }

    pub fn frames_after(
        &self,
        account_id: &str,
        after: i64,
        limit: u32,
    ) -> Result<(Vec<WireFrame>, bool), StoreError> {
        let mut cursor = after;
        loop {
            let (frames, has_more, last_seq) = self.frames_page(account_id, cursor, limit)?;
            match last_seq {
                Some(last_seq) if frames.is_empty() && has_more => cursor = last_seq,
                _ => return Ok((frames, has_more)),
            }
        }
    }

    fn frames_page(
        &self,
        account_id: &str,
        after: i64,
        limit: u32,
    ) -> Result<(Vec<WireFrame>, bool, Option<i64>), StoreError> {
        let limit = limit.clamp(1, MAX_FRAMES_PAGE);
        let rows = {
            let connection = self.connection();
            let mut statement = connection.prepare(
                "SELECT seq, kind, received_at, account_id, payload
                 FROM frames WHERE account_id = ?1 AND seq > ?2 ORDER BY seq LIMIT ?3",
            )?;
            let rows = statement
                .query_map(params![account_id, after, limit], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, Vec<u8>>(4)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        let has_more = rows.len() == limit as usize;
        let last_seq = rows.last().map(|row| row.0);
        let frames = rows
            .into_iter()
            .filter_map(|(seq, kind, received_at, account_id, payload)| {
                let frame_kind = match kind.as_str() {
                    "message" => FrameKind::Message,
                    "connect" => FrameKind::Connect,
                    "snapshot" => FrameKind::Snapshot,
                    "profile" => FrameKind::Profile,
                    _ => return None,
                };
                let Some(payload) = self
                    .key
                    .open(&payload, &frame_aad(&kind, &received_at))
                    .ok()
                    .and_then(|payload| String::from_utf8(payload).ok())
                else {
                    tracing::warn!(seq, "skipping a frame that cannot be decrypted");
                    return None;
                };
                Some(WireFrame {
                    seq,
                    kind: frame_kind,
                    received_at,
                    account_id,
                    payload,
                })
            })
            .collect();
        Ok((frames, has_more, last_seq))
    }

    pub fn ack(&self, account_id: &str, up_to: i64) -> Result<(), StoreError> {
        self.connection().execute(
            "DELETE FROM frames WHERE account_id = ?1 AND seq <= ?2",
            params![account_id, up_to],
        )?;
        Ok(())
    }

    pub fn prune(
        &self,
        older_than_unix: Option<i64>,
        max_bytes: Option<u64>,
    ) -> Result<u64, StoreError> {
        let mut dropped = 0;
        if let Some(older_than_unix) = older_than_unix {
            loop {
                let deleted = self.connection().execute(
                    "DELETE FROM frames WHERE seq IN (
                         SELECT seq FROM frames WHERE received_unix < ?1 ORDER BY seq LIMIT ?2
                     )",
                    params![older_than_unix, PRUNE_BATCH],
                )?;
                dropped += deleted;
                if deleted == 0 {
                    break;
                }
            }
        }
        if let Some(max_bytes) = max_bytes {
            while self.database_bytes()? > max_bytes {
                let deleted = self.connection().execute(
                    "DELETE FROM frames WHERE seq IN (SELECT seq FROM frames ORDER BY seq LIMIT ?1)",
                    params![PRUNE_BATCH],
                )?;
                dropped += deleted;
                if deleted == 0 {
                    break;
                }
            }
        }
        if dropped > 0 {
            dropped += self.drop_unreplayable_frames()?;
            add_counter(&self.connection(), DROPPED_UNSYNCED, dropped)?;
        }
        Ok(u64::try_from(dropped).unwrap_or_default())
    }

    pub fn frame_exists(&self, seq: i64) -> Result<bool, StoreError> {
        Ok(self.connection().query_row(
            "SELECT EXISTS(SELECT 1 FROM frames WHERE seq = ?1)",
            params![seq],
            |row| row.get(0),
        )?)
    }

    #[cfg(test)]
    pub fn corrupt_frames_for_test(&self, up_to: i64) {
        self.connection()
            .execute(
                "UPDATE frames SET payload = x'00' WHERE seq <= ?1",
                params![up_to],
            )
            .unwrap();
    }

    fn drop_unreplayable_frames(&self) -> Result<usize, StoreError> {
        Ok(self.connection().execute(
            "DELETE FROM frames
             WHERE seq < COALESCE(
                 (SELECT MIN(start.seq) FROM frames AS start
                  WHERE start.account_id = frames.account_id AND start.kind = 'connect'),
                 9223372036854775807
             )",
            [],
        )?)
    }

    pub fn counter(&self, name: &str) -> Result<u64, StoreError> {
        let value: Option<i64> = self
            .connection()
            .query_row(
                "SELECT value FROM counters WHERE name = ?1",
                params![name],
                |row| row.get(0),
            )
            .optional()?;
        Ok(value
            .and_then(|value| u64::try_from(value).ok())
            .unwrap_or_default())
    }

    pub fn set_counter(&self, name: &str, value: u64) -> Result<(), StoreError> {
        self.connection().execute(
            "INSERT INTO counters (name, value) VALUES (?1, ?2)
             ON CONFLICT(name) DO UPDATE SET value = excluded.value",
            params![name, i64::try_from(value).unwrap_or(i64::MAX)],
        )?;
        Ok(())
    }

    pub fn database_bytes(&self) -> Result<u64, StoreError> {
        let connection = self.connection();
        let page_count: i64 = connection.query_row("PRAGMA page_count", [], |row| row.get(0))?;
        let freelist_count: i64 =
            connection.query_row("PRAGMA freelist_count", [], |row| row.get(0))?;
        let page_size: i64 = connection.query_row("PRAGMA page_size", [], |row| row.get(0))?;
        Ok(
            u64::try_from((page_count - freelist_count).saturating_mul(page_size))
                .unwrap_or_default(),
        )
    }

    pub fn available_bytes(&self) -> Option<u64> {
        self.path
            .parent()
            .and_then(|dir| fs4::available_space(dir).ok())
    }

    fn raw_sealed(&self, name: &str) -> Result<Option<Vec<u8>>, StoreError> {
        Ok(self
            .connection()
            .query_row(
                "SELECT value FROM sealed WHERE name = ?1",
                params![name],
                |row| row.get(0),
            )
            .optional()?)
    }

    #[cfg(test)]
    pub fn refuse_writes_for_test(&self, refuse: bool) {
        let sql = if refuse {
            "CREATE TEMP TRIGGER refuse_frames BEFORE INSERT ON frames
             BEGIN SELECT RAISE(FAIL, 'disk is full'); END;"
        } else {
            "DROP TRIGGER temp.refuse_frames;"
        };
        self.connection().execute_batch(sql).unwrap();
    }

    fn connection(&self) -> MutexGuard<'_, Connection> {
        lock(&self.connection)
    }
}

fn add_counter(connection: &Connection, name: &str, amount: usize) -> Result<(), StoreError> {
    connection.execute(
        "INSERT INTO counters (name, value) VALUES (?1, ?2)
         ON CONFLICT(name) DO UPDATE SET value = value + excluded.value",
        params![name, i64::try_from(amount).unwrap_or(i64::MAX)],
    )?;
    Ok(())
}

fn frame_kind_name(kind: FrameKind) -> &'static str {
    match kind {
        FrameKind::Message => "message",
        FrameKind::Connect => "connect",
        FrameKind::Snapshot => "snapshot",
        FrameKind::Profile => "profile",
    }
}

fn migrate(connection: &Connection) -> Result<(), StoreError> {
    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version > SCHEMA_VERSION {
        return Err(StoreError::NewerSchema { found: version });
    }
    if version < 1 {
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS sealed (name TEXT PRIMARY KEY, value BLOB NOT NULL);
             CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS frames (
                 seq INTEGER PRIMARY KEY AUTOINCREMENT,
                 kind TEXT NOT NULL,
                 received_at TEXT NOT NULL,
                 received_unix INTEGER NOT NULL,
                 account_id TEXT NOT NULL,
                 payload BLOB NOT NULL
             );",
        )?;
    }
    connection.execute_batch(
        "CREATE INDEX IF NOT EXISTS frames_by_account ON frames (account_id, kind, seq);",
    )?;
    connection.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    Ok(())
}

fn frame_aad(kind: &str, received_at: &str) -> Vec<u8> {
    format!("frame\n{kind}\n{received_at}").into_bytes()
}

#[cfg(unix)]
fn restrict_permissions(path: &Path, mode: u32) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path, _mode: u32) -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::http::StatusCode;
    use vrcx_0_logger_protocol::wire::{OkResponse, WebhookFormat, WebhookRequest};

    use super::*;
    use crate::credentials::{CredentialVault, StoredCredentials};
    use crate::test_support::{
        at, open_store, record, start_with, temp_dir, Desktop, ACCOUNT, PASSWORD,
    };
    use crate::webhook::Notifier;

    const NEW_PASSWORD: &str = "a different long password";

    fn open_shared(dir: &Path, password: &str) -> (Arc<Store>, KeyCheck) {
        let (store, check) = open_store(dir, password);
        (Arc::new(store), check)
    }

    fn save_secrets(store: &Arc<Store>, vrchat_password: &str, webhook_url: &str) {
        CredentialVault::new(store.clone())
            .save(&StoredCredentials {
                username: "desktop user".into(),
                password: Some(vrchat_password.into()),
                account_id: ACCOUNT.into(),
                cookies: String::new(),
            })
            .unwrap();
        Notifier::new(store.clone())
            .unwrap()
            .configure(WebhookRequest {
                url: Some(webhook_url.into()),
                format: WebhookFormat::Discord,
            })
            .unwrap();
    }

    fn files_contain(dir: &Path, needle: &str) -> bool {
        std::fs::read_dir(dir).unwrap().any(|entry| {
            let bytes = std::fs::read(entry.unwrap().path()).unwrap();
            bytes
                .windows(needle.len())
                .any(|window| window == needle.as_bytes())
        })
    }

    #[test]
    fn unreadable_records_do_not_block_the_records_after_them() {
        let (store, _) = open_store(&temp_dir(), PASSWORD);
        record(&store, at(1), "unreadable");
        record(&store, at(2), "unreadable too");
        let readable = record(&store, at(3), "readable");
        store.corrupt_frames_for_test(readable - 1);

        let (frames, _) = store.frames_after(ACCOUNT, 0, 2).unwrap();

        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].seq, readable);
        assert_eq!(frames[0].payload, "readable");
    }

    #[test]
    fn a_data_directory_from_a_newer_recorder_is_refused() {
        let dir = temp_dir();
        drop(open_store(&dir, PASSWORD));
        Connection::open(dir.join(DATABASE_FILE))
            .unwrap()
            .pragma_update(None, "user_version", SCHEMA_VERSION + 1)
            .unwrap();

        assert!(matches!(
            Store::open(&dir, SecretKey::derive(PASSWORD, STORAGE_SALT).unwrap()),
            Err(StoreError::NewerSchema { .. })
        ));
    }

    #[test]
    fn records_and_saved_secrets_never_reach_the_disk_in_plain_text() {
        let dir = temp_dir();
        let (store, _) = open_shared(&dir, PASSWORD);
        record(&store, at(100), "recorded-frame-marker");
        save_secrets(
            &store,
            "vrchat-password-marker",
            "https://hook.test/webhook-secret-marker",
        );
        drop(store);

        for marker in [
            "recorded-frame-marker",
            "vrchat-password-marker",
            "webhook-secret-marker",
        ] {
            assert!(!files_contain(&dir, marker), "{marker}");
        }
    }

    #[test]
    fn reopening_with_the_same_password_keeps_records_and_saved_secrets() {
        let dir = temp_dir();
        let (store, check) = open_shared(&dir, PASSWORD);
        assert_eq!(check, KeyCheck::Fresh);
        record(&store, at(100), "kept");
        save_secrets(&store, "vrchat password", "https://hook.test/secret");
        drop(store);

        let (store, check) = open_shared(&dir, PASSWORD);

        assert_eq!(check, KeyCheck::Matched);
        assert_eq!(
            store.frames_after(ACCOUNT, 0, 10).unwrap().0[0].payload,
            "kept"
        );
        assert!(CredentialVault::new(store.clone())
            .load()
            .unwrap()
            .is_some());
        assert!(Notifier::new(store).unwrap().status().configured);
    }

    #[tokio::test]
    async fn changing_the_password_discards_unpulled_records_and_saved_secrets_and_counts_the_loss()
    {
        let dir = temp_dir();
        let (store, _) = open_shared(&dir, PASSWORD);
        record(&store, at(100), "a");
        record(&store, at(101), "b");
        save_secrets(&store, "vrchat password", "https://hook.test/secret");
        drop(store);

        let (store, check) = open_store(&dir, NEW_PASSWORD);
        assert_eq!(check, KeyCheck::PasswordChanged { dropped_frames: 2 });
        let app = start_with(store, NEW_PASSWORD, None, None);

        let status = Desktop::with_password(&app, NEW_PASSWORD).status().await;
        assert_eq!(status.unsynced_frames, 0);
        assert_eq!(status.dropped_after_password_change, 2);
        assert!(!status.webhook_configured);
        assert!(CredentialVault::new(app.store.clone())
            .load()
            .unwrap()
            .is_none());
        let old_desktop = Desktop::with_password(&app, PASSWORD);
        let sealed = old_desktop.seal("/status", &OkResponse {});
        assert_eq!(
            old_desktop.send(&sealed).await.status,
            StatusCode::UNAUTHORIZED
        );

        let (store, check) = open_store(&dir, NEW_PASSWORD);
        assert_eq!(check, KeyCheck::Matched);
        assert_eq!(store.counter(DROPPED_AFTER_PASSWORD_CHANGE).unwrap(), 2);
    }
}
