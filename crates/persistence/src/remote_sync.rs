use serde::{Deserialize, Serialize};

use crate::common::{row_i64, row_string, DbWriteTarget, ParamsBuilder};
use crate::database::DatabaseService;
use crate::Error;

pub mod streams;
#[cfg(test)]
mod tests;

const SCHEMA_KEY: &str = "remote-sync";

/// Identifies one vault on one server for one account. Every local sync
/// table is keyed by it, so switching servers or accounts never mixes state.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VaultRef {
    pub api_origin: String,
    pub account_id: String,
    pub vault_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VaultState {
    pub vault: VaultRef,
    pub vrchat_user_id: String,
    pub source_id: String,
    pub pull_cursor: u64,
    pub highest_manifest_seq: u64,
    pub push_source_seq: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RetentionState {
    pub max_age_days: Option<u32>,
    pub keep_below_limit_margin_pct: Option<u32>,
    pub applied_server_seq: u64,
}

/// A sealed chunk that was built but not yet confirmed by the server. It is
/// stored before upload so a retry sends the same chunk id and bytes, which
/// the server treats as the same chunk instead of a duplicate.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PendingChunk {
    pub chunk_id: String,
    pub source_seq: u64,
    pub blob_base64: String,
    pub cursors: Vec<(String, i64)>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncLogEntry {
    pub kind: String,
    pub message: String,
    pub first_seq: Option<u64>,
    pub last_seq: Option<u64>,
    pub created_at_ms: i64,
}

pub fn ensure_remote_sync_tables(db: &DatabaseService) -> Result<(), Error> {
    db.ensure_schema_until_stable(SCHEMA_KEY, || {
        for sql in [
            "CREATE TABLE IF NOT EXISTS remote_sync_state (api_origin TEXT NOT NULL, account_id TEXT NOT NULL, vault_id TEXT NOT NULL, vrchat_user_id TEXT NOT NULL DEFAULT '', source_id TEXT NOT NULL, pull_cursor INTEGER NOT NULL DEFAULT 0, highest_manifest_seq INTEGER NOT NULL DEFAULT 0, push_source_seq INTEGER NOT NULL DEFAULT 0, last_sync_at_ms INTEGER, PRIMARY KEY (api_origin, account_id, vault_id))",
            "CREATE TABLE IF NOT EXISTS remote_sync_push_state (api_origin TEXT NOT NULL, account_id TEXT NOT NULL, vault_id TEXT NOT NULL, stream TEXT NOT NULL, row_cursor INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (api_origin, account_id, vault_id, stream))",
            "CREATE TABLE IF NOT EXISTS remote_sync_pending_chunk (api_origin TEXT NOT NULL, account_id TEXT NOT NULL, vault_id TEXT NOT NULL, chunk_id TEXT NOT NULL, source_seq INTEGER NOT NULL, blob TEXT NOT NULL, cursors TEXT NOT NULL, PRIMARY KEY (api_origin, account_id, vault_id))",
            "CREATE TABLE IF NOT EXISTS remote_sync_compaction (api_origin TEXT NOT NULL, account_id TEXT NOT NULL, vault_id TEXT NOT NULL, journal TEXT NOT NULL, PRIMARY KEY (api_origin, account_id, vault_id))",
            "CREATE TABLE IF NOT EXISTS remote_sync_retention_state (api_origin TEXT NOT NULL, account_id TEXT NOT NULL, vault_id TEXT NOT NULL, max_age_days INTEGER, keep_below_limit_margin_pct INTEGER, applied_server_seq INTEGER NOT NULL, PRIMARY KEY (api_origin, account_id, vault_id))",
            "CREATE TABLE IF NOT EXISTS remote_sync_seen_chunk (api_origin TEXT NOT NULL, account_id TEXT NOT NULL, vault_id TEXT NOT NULL, source_id TEXT NOT NULL, source_seq INTEGER NOT NULL, PRIMARY KEY (api_origin, account_id, vault_id, source_id, source_seq))",
            "CREATE TABLE IF NOT EXISTS remote_sync_coverage (id INTEGER PRIMARY KEY, vrchat_user_id TEXT NOT NULL, started_at_ms INTEGER NOT NULL, extended_at_ms INTEGER NOT NULL, ended_at_ms INTEGER)",
            "CREATE INDEX IF NOT EXISTS remote_sync_coverage_user_idx ON remote_sync_coverage (vrchat_user_id, started_at_ms)",
            "CREATE TABLE IF NOT EXISTS remote_sync_provenance (stream TEXT NOT NULL, local_rowid INTEGER NOT NULL, source_id TEXT NOT NULL, source_seq INTEGER NOT NULL, PRIMARY KEY (stream, local_rowid))",
            "CREATE INDEX IF NOT EXISTS remote_sync_provenance_source_idx ON remote_sync_provenance (stream, source_id, local_rowid)",
            "CREATE TABLE IF NOT EXISTS remote_sync_tombstone (stream TEXT NOT NULL, owner_id INTEGER NOT NULL DEFAULT 0, row_key TEXT NOT NULL, deleted_at_ms INTEGER NOT NULL, PRIMARY KEY (stream, owner_id, row_key))",
            "CREATE TABLE IF NOT EXISTS remote_sync_log (id INTEGER PRIMARY KEY, api_origin TEXT NOT NULL, account_id TEXT NOT NULL, vault_id TEXT NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL, first_seq INTEGER, last_seq INTEGER, created_at_ms INTEGER NOT NULL)",
            "CREATE INDEX IF NOT EXISTS remote_sync_log_recent_idx ON remote_sync_log (api_origin, account_id, vault_id, created_at_ms DESC)",
        ] {
            db.execute_non_query(sql, &Default::default())?;
        }
        Ok(true)
    })
}

pub(crate) fn vault_params(vault: &VaultRef) -> ParamsBuilder {
    ParamsBuilder::new()
        .set("api_origin", vault.api_origin.clone())
        .set("account_id", vault.account_id.clone())
        .set("vault_id", vault.vault_id.clone())
}

pub(crate) const VAULT_WHERE: &str =
    "api_origin = @api_origin AND account_id = @account_id AND vault_id = @vault_id";

pub(crate) fn to_i64(value: u64) -> i64 {
    value.min(i64::MAX as u64) as i64
}

fn state_from_row(row: &[serde_json::Value]) -> VaultState {
    VaultState {
        vault: VaultRef {
            api_origin: row_string(row, 0),
            account_id: row_string(row, 1),
            vault_id: row_string(row, 2),
        },
        vrchat_user_id: row_string(row, 3),
        source_id: row_string(row, 4),
        pull_cursor: row_i64(row, 5).max(0) as u64,
        highest_manifest_seq: row_i64(row, 6).max(0) as u64,
        push_source_seq: row_i64(row, 7).max(0) as u64,
    }
}

const STATE_COLUMNS: &str = "api_origin, account_id, vault_id, vrchat_user_id, source_id, pull_cursor, highest_manifest_seq, push_source_seq";

pub fn vault_state_get(
    db: &DatabaseService,
    vault: &VaultRef,
) -> Result<Option<VaultState>, Error> {
    ensure_remote_sync_tables(db)?;
    Ok(db
        .execute(
            &format!("SELECT {STATE_COLUMNS} FROM remote_sync_state WHERE {VAULT_WHERE}"),
            &vault_params(vault).build(),
        )?
        .first()
        .map(|row| state_from_row(row)))
}

/// The vault this PC already uses for a VRChat account on this server.
pub fn vault_state_for_user(
    db: &DatabaseService,
    api_origin: &str,
    account_id: &str,
    vrchat_user_id: &str,
) -> Result<Option<VaultState>, Error> {
    ensure_remote_sync_tables(db)?;
    Ok(db
        .execute(
            &format!("SELECT {STATE_COLUMNS} FROM remote_sync_state WHERE api_origin = @api_origin AND account_id = @account_id AND vrchat_user_id = @vrchat_user_id"),
            &ParamsBuilder::new()
                .set("api_origin", api_origin)
                .set("account_id", account_id)
                .set("vrchat_user_id", vrchat_user_id)
                .build(),
        )?
        .first()
        .map(|row| state_from_row(row)))
}

/// Records which vault belongs to a VRChat account. Cursors only move
/// forward, so a stale task cannot undo verified progress.
pub fn vault_state_save(db: &DatabaseService, state: &VaultState) -> Result<(), Error> {
    ensure_remote_sync_tables(db)?;
    db.execute_non_query(
        "INSERT INTO remote_sync_state (api_origin, account_id, vault_id, vrchat_user_id, source_id, pull_cursor, highest_manifest_seq, push_source_seq) VALUES (@api_origin, @account_id, @vault_id, @vrchat_user_id, @source_id, @pull_cursor, @manifest_seq, @push_source_seq) ON CONFLICT (api_origin, account_id, vault_id) DO UPDATE SET vrchat_user_id = excluded.vrchat_user_id, pull_cursor = MAX(pull_cursor, excluded.pull_cursor), highest_manifest_seq = MAX(highest_manifest_seq, excluded.highest_manifest_seq), push_source_seq = MAX(push_source_seq, excluded.push_source_seq)",
        &vault_params(&state.vault)
            .set("vrchat_user_id", state.vrchat_user_id.clone())
            .set("source_id", state.source_id.clone())
            .set("pull_cursor", to_i64(state.pull_cursor))
            .set("manifest_seq", to_i64(state.highest_manifest_seq))
            .set("push_source_seq", to_i64(state.push_source_seq))
            .build(),
    )?;
    Ok(())
}

pub fn manifest_seq_advance(db: &DatabaseService, vault: &VaultRef, seq: u64) -> Result<(), Error> {
    db.execute_non_query(
        &format!("UPDATE remote_sync_state SET highest_manifest_seq = MAX(highest_manifest_seq, @seq) WHERE {VAULT_WHERE}"),
        &vault_params(vault).set("seq", to_i64(seq)).build(),
    )?;
    Ok(())
}

pub fn last_sync_set(db: &DatabaseService, vault: &VaultRef, at_ms: i64) -> Result<(), Error> {
    db.execute_non_query(
        &format!("UPDATE remote_sync_state SET last_sync_at_ms = @at_ms WHERE {VAULT_WHERE}"),
        &vault_params(vault).set("at_ms", at_ms).build(),
    )?;
    Ok(())
}

pub fn last_sync_get(db: &DatabaseService, vault: &VaultRef) -> Result<Option<i64>, Error> {
    ensure_remote_sync_tables(db)?;
    Ok(db
        .execute(
            &format!("SELECT last_sync_at_ms FROM remote_sync_state WHERE {VAULT_WHERE}"),
            &vault_params(vault).build(),
        )?
        .first()
        .and_then(|row| row.first().and_then(serde_json::Value::as_i64)))
}

pub fn pending_chunk_get(
    db: &DatabaseService,
    vault: &VaultRef,
) -> Result<Option<PendingChunk>, Error> {
    ensure_remote_sync_tables(db)?;
    let rows = db.execute(
        &format!("SELECT chunk_id, source_seq, blob, cursors FROM remote_sync_pending_chunk WHERE {VAULT_WHERE}"),
        &vault_params(vault).build(),
    )?;
    let Some(row) = rows.first() else {
        return Ok(None);
    };
    let cursors = serde_json::from_str(&row_string(row, 3))
        .map_err(|error| Error::Database(format!("Pending sync chunk is unreadable: {error}")))?;
    Ok(Some(PendingChunk {
        chunk_id: row_string(row, 0),
        source_seq: row_i64(row, 1).max(0) as u64,
        blob_base64: row_string(row, 2),
        cursors,
    }))
}

pub fn pending_chunk_put(
    db: &DatabaseService,
    vault: &VaultRef,
    chunk: &PendingChunk,
) -> Result<(), Error> {
    ensure_remote_sync_tables(db)?;
    let cursors = serde_json::to_string(&chunk.cursors)
        .map_err(|error| Error::Database(error.to_string()))?;
    db.execute_non_query(
        "INSERT OR REPLACE INTO remote_sync_pending_chunk (api_origin, account_id, vault_id, chunk_id, source_seq, blob, cursors) VALUES (@api_origin, @account_id, @vault_id, @chunk_id, @source_seq, @blob, @cursors)",
        &vault_params(vault)
            .set("chunk_id", chunk.chunk_id.clone())
            .set("source_seq", to_i64(chunk.source_seq))
            .set("blob", chunk.blob_base64.clone())
            .set("cursors", cursors)
            .build(),
    )?;
    Ok(())
}

/// Called after the server confirmed the pending chunk: the stream cursors,
/// the source sequence, and the removal of the pending record commit together.
pub fn pending_chunk_commit(
    db: &DatabaseService,
    vault: &VaultRef,
    chunk: &PendingChunk,
) -> Result<(), Error> {
    db.write_transaction(|tx| {
        for (stream, row_cursor) in &chunk.cursors {
            tx.execute_non_query(
                "INSERT INTO remote_sync_push_state (api_origin, account_id, vault_id, stream, row_cursor) VALUES (@api_origin, @account_id, @vault_id, @stream, @row_cursor) ON CONFLICT (api_origin, account_id, vault_id, stream) DO UPDATE SET row_cursor = CASE WHEN excluded.stream LIKE 'state%' THEN excluded.row_cursor ELSE MAX(row_cursor, excluded.row_cursor) END",
                &vault_params(vault)
                    .set("stream", stream.clone())
                    .set("row_cursor", *row_cursor)
                    .build(),
            )?;
        }
        tx.execute_non_query(
            &format!("UPDATE remote_sync_state SET push_source_seq = MAX(push_source_seq, @source_seq) WHERE {VAULT_WHERE}"),
            &vault_params(vault)
                .set("source_seq", to_i64(chunk.source_seq))
                .build(),
        )?;
        tx.execute_non_query(
            &format!("DELETE FROM remote_sync_pending_chunk WHERE {VAULT_WHERE} AND chunk_id = @chunk_id"),
            &vault_params(vault)
                .set("chunk_id", chunk.chunk_id.clone())
                .build(),
        )?;
        Ok(())
    })
}

/// Durable state for a replacement snapshot. The journal contains the sealed
/// chunks, so retrying after a crash reuses the same chunk ids and bytes.
pub fn compaction_journal_get(
    db: &DatabaseService,
    vault: &VaultRef,
) -> Result<Option<String>, Error> {
    ensure_remote_sync_tables(db)?;
    Ok(db
        .execute(
            &format!("SELECT journal FROM remote_sync_compaction WHERE {VAULT_WHERE}"),
            &vault_params(vault).build(),
        )?
        .first()
        .map(|row| row_string(row, 0)))
}

pub fn compaction_journal_put(
    db: &DatabaseService,
    vault: &VaultRef,
    journal: &str,
) -> Result<(), Error> {
    ensure_remote_sync_tables(db)?;
    db.execute_non_query(
        "INSERT OR REPLACE INTO remote_sync_compaction (api_origin, account_id, vault_id, journal) VALUES (@api_origin, @account_id, @vault_id, @journal)",
        &vault_params(vault).set("journal", journal).build(),
    )?;
    Ok(())
}

pub fn compaction_journal_clear(db: &DatabaseService, vault: &VaultRef) -> Result<(), Error> {
    ensure_remote_sync_tables(db)?;
    db.execute_non_query(
        &format!("DELETE FROM remote_sync_compaction WHERE {VAULT_WHERE}"),
        &vault_params(vault).build(),
    )?;
    Ok(())
}

pub fn push_source_seq_advance(
    db: &DatabaseService,
    vault: &VaultRef,
    source_seq: u64,
) -> Result<(), Error> {
    db.execute_non_query(
        &format!("UPDATE remote_sync_state SET push_source_seq = MAX(push_source_seq, @source_seq) WHERE {VAULT_WHERE}"),
        &vault_params(vault).set("source_seq", to_i64(source_seq)).build(),
    )?;
    Ok(())
}

pub fn retention_state_get(
    db: &DatabaseService,
    vault: &VaultRef,
) -> Result<Option<RetentionState>, Error> {
    ensure_remote_sync_tables(db)?;
    Ok(db
        .execute(
            &format!("SELECT max_age_days, keep_below_limit_margin_pct, applied_server_seq FROM remote_sync_retention_state WHERE {VAULT_WHERE}"),
            &vault_params(vault).build(),
        )?
        .first()
        .map(|row| RetentionState {
            max_age_days: row.first().and_then(serde_json::Value::as_i64).map(|value| value.max(0) as u32),
            keep_below_limit_margin_pct: row.get(1).and_then(serde_json::Value::as_i64).map(|value| value.max(0) as u32),
            applied_server_seq: row_i64(row, 2).max(0) as u64,
        }))
}

pub fn retention_state_set(
    db: &DatabaseService,
    vault: &VaultRef,
    state: &RetentionState,
) -> Result<(), Error> {
    ensure_remote_sync_tables(db)?;
    db.execute_non_query(
        "INSERT OR REPLACE INTO remote_sync_retention_state (api_origin, account_id, vault_id, max_age_days, keep_below_limit_margin_pct, applied_server_seq) VALUES (@api_origin, @account_id, @vault_id, @max_age_days, @margin_pct, @applied_seq)",
        &vault_params(vault)
            .set("max_age_days", state.max_age_days.map(i64::from))
            .set("margin_pct", state.keep_below_limit_margin_pct.map(i64::from))
            .set("applied_seq", to_i64(state.applied_server_seq))
            .build(),
    )?;
    Ok(())
}

pub fn push_cursor_get(db: &DatabaseService, vault: &VaultRef, stream: &str) -> Result<i64, Error> {
    ensure_remote_sync_tables(db)?;
    Ok(db
        .execute(
            &format!("SELECT row_cursor FROM remote_sync_push_state WHERE {VAULT_WHERE} AND stream = @stream"),
            &vault_params(vault).set("stream", stream).build(),
        )?
        .first()
        .map(|row| row_i64(row, 0))
        .unwrap_or(0))
}

pub fn coverage_start(
    db: &DatabaseService,
    vrchat_user_id: &str,
    started_at_ms: i64,
) -> Result<i64, Error> {
    ensure_remote_sync_tables(db)?;
    db.write_transaction(|tx| {
        tx.execute_non_query(
            "INSERT INTO remote_sync_coverage (vrchat_user_id, started_at_ms, extended_at_ms) VALUES (@vrchat_user_id, @started_at_ms, @started_at_ms)",
            &ParamsBuilder::new()
                .set("vrchat_user_id", vrchat_user_id)
                .set("started_at_ms", started_at_ms)
                .build(),
        )?;
        Ok(tx
            .execute("SELECT last_insert_rowid()", &Default::default())?
            .first()
            .map(|row| row_i64(row, 0))
            .unwrap_or(0))
    })
}

pub fn coverage_extend(
    db: &DatabaseService,
    coverage_id: i64,
    extended_at_ms: i64,
) -> Result<(), Error> {
    db.execute_non_query(
        "UPDATE remote_sync_coverage SET extended_at_ms = MAX(extended_at_ms, @extended_at_ms) WHERE id = @coverage_id AND ended_at_ms IS NULL",
        &ParamsBuilder::new()
            .set("extended_at_ms", extended_at_ms)
            .set("coverage_id", coverage_id)
            .build(),
    )?;
    Ok(())
}

pub fn coverage_end(db: &DatabaseService, coverage_id: i64, ended_at_ms: i64) -> Result<(), Error> {
    db.execute_non_query(
        "UPDATE remote_sync_coverage SET ended_at_ms = @ended_at_ms WHERE id = @coverage_id AND ended_at_ms IS NULL",
        &ParamsBuilder::new()
            .set("ended_at_ms", ended_at_ms)
            .set("coverage_id", coverage_id)
            .build(),
    )?;
    Ok(())
}

/// Recording periods of this PC that overlap `[from_ms, to_ms]`.
pub fn coverage_between(
    db: &DatabaseService,
    vrchat_user_id: &str,
    from_ms: i64,
    to_ms: i64,
) -> Result<Vec<(i64, i64)>, Error> {
    ensure_remote_sync_tables(db)?;
    Ok(db
        .execute(
            "SELECT started_at_ms, COALESCE(ended_at_ms, extended_at_ms) FROM remote_sync_coverage WHERE vrchat_user_id = @vrchat_user_id AND started_at_ms <= @to_ms AND COALESCE(ended_at_ms, extended_at_ms) >= @from_ms ORDER BY started_at_ms",
            &ParamsBuilder::new()
                .set("vrchat_user_id", vrchat_user_id)
                .set("from_ms", from_ms)
                .set("to_ms", to_ms)
                .build(),
        )?
        .iter()
        .map(|row| (row_i64(row, 0), row_i64(row, 1)))
        .collect())
}

pub fn sync_log_record(
    target: &impl DbWriteTarget,
    vault: &VaultRef,
    entry: &SyncLogEntry,
) -> Result<(), Error> {
    target.execute_non_query(
        "INSERT INTO remote_sync_log (api_origin, account_id, vault_id, kind, message, first_seq, last_seq, created_at_ms) VALUES (@api_origin, @account_id, @vault_id, @kind, @message, @first_seq, @last_seq, @created_at_ms)",
        &vault_params(vault)
            .set("kind", entry.kind.clone())
            .set("message", entry.message.clone())
            .set("first_seq", entry.first_seq.map(to_i64))
            .set("last_seq", entry.last_seq.map(to_i64))
            .set("created_at_ms", entry.created_at_ms)
            .build(),
    )?;
    Ok(())
}

pub fn sync_log_recent(
    db: &DatabaseService,
    vault: &VaultRef,
    limit: u32,
) -> Result<Vec<SyncLogEntry>, Error> {
    ensure_remote_sync_tables(db)?;
    Ok(db
        .execute(
            &format!("SELECT kind, message, first_seq, last_seq, created_at_ms FROM remote_sync_log WHERE {VAULT_WHERE} ORDER BY created_at_ms DESC, id DESC LIMIT @limit"),
            &vault_params(vault).set("limit", limit).build(),
        )?
        .iter()
        .map(|row| SyncLogEntry {
            kind: row_string(row, 0),
            message: row_string(row, 1),
            first_seq: row.get(2).and_then(serde_json::Value::as_u64),
            last_seq: row.get(3).and_then(serde_json::Value::as_u64),
            created_at_ms: row_i64(row, 4),
        })
        .collect())
}

/// Forgets everything this PC knows about a server account. Local history
/// and the record of which rows were imported are kept, so a later sync with
/// the same or another server still does not upload imported rows as new.
pub fn clear_account_state(
    db: &DatabaseService,
    api_origin: &str,
    account_id: &str,
) -> Result<(), Error> {
    ensure_remote_sync_tables(db)?;
    let params = ParamsBuilder::new()
        .set("api_origin", api_origin)
        .set("account_id", account_id)
        .build();
    db.write_transaction(|tx| {
        for table in [
            "remote_sync_state",
            "remote_sync_push_state",
            "remote_sync_pending_chunk",
            "remote_sync_compaction",
            "remote_sync_retention_state",
            "remote_sync_seen_chunk",
            "remote_sync_log",
        ] {
            tx.execute_non_query(
                &format!("DELETE FROM {table} WHERE api_origin = @api_origin AND account_id = @account_id"),
                &params,
            )?;
        }
        Ok(())
    })
}

/// Forgets one vault, for when it no longer exists on the server.
pub fn clear_vault_state(db: &DatabaseService, vault: &VaultRef) -> Result<(), Error> {
    ensure_remote_sync_tables(db)?;
    let params = vault_params(vault).build();
    db.write_transaction(|tx| {
        for table in [
            "remote_sync_state",
            "remote_sync_push_state",
            "remote_sync_pending_chunk",
            "remote_sync_compaction",
            "remote_sync_retention_state",
            "remote_sync_seen_chunk",
        ] {
            tx.execute_non_query(&format!("DELETE FROM {table} WHERE {VAULT_WHERE}"), &params)?;
        }
        Ok(())
    })
}

pub fn pull_cursor_advance(db: &DatabaseService, vault: &VaultRef, seq: u64) -> Result<(), Error> {
    db.execute_non_query(
        &format!(
            "UPDATE remote_sync_state SET pull_cursor = MAX(pull_cursor, @seq) WHERE {VAULT_WHERE}"
        ),
        &vault_params(vault).set("seq", to_i64(seq)).build(),
    )?;
    Ok(())
}

/// Highest chunk sequence imported from each other source, used to notice
/// chunks the server withheld.
pub fn seen_source_sequences(
    db: &DatabaseService,
    vault: &VaultRef,
) -> Result<std::collections::HashMap<String, u64>, Error> {
    ensure_remote_sync_tables(db)?;
    Ok(db
        .execute(
            &format!("SELECT source_id, MAX(source_seq) FROM remote_sync_seen_chunk WHERE {VAULT_WHERE} GROUP BY source_id"),
            &vault_params(vault).build(),
        )?
        .iter()
        .map(|row| (row_string(row, 0), row_i64(row, 1).max(0) as u64))
        .collect())
}
