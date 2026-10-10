use std::collections::BTreeMap;

use chrono::{DateTime, Duration};
use serde_json::{Map, Value};

use super::{to_i64, vault_params, VaultRef, VAULT_WHERE};
use crate::common::{row_i64, row_string, ParamsBuilder};
use crate::database::{DatabaseService, DatabaseWriteTransaction};
use crate::game_log::ensure_game_log_tables;
use crate::ownership::{owner_id_get_or_insert, OwnerId, COL_OWNER_ID};
use crate::realtime::normalize_user_table_prefix;
use crate::Error;

/// Two recorders seeing the same VRChat event stamp it with their own clock.
pub const DEDUPE_SLACK_SECONDS: i64 = 10;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StreamTable {
    /// `{user_prefix}_{suffix}`, one table per VRChat account.
    User(&'static str),
    /// A shared table whose rows carry the local `owner_id` of the account.
    Owned(&'static str),
    /// A table shared by every account on this PC.
    Global(&'static str),
}

/// How one append-only history table travels through sync. `key` and `time`
/// together identify the same real-world event recorded by another source.
#[derive(Clone, Copy, Debug)]
pub struct StreamSpec {
    pub name: &'static str,
    pub table: StreamTable,
    pub key: &'static [&'static str],
    pub time: &'static str,
    /// Realtime events are stamped on arrival, so they match within
    /// `DEDUPE_SLACK_SECONDS`. Game log rows carry VRChat's own log time and
    /// must match exactly.
    pub slack: bool,
}

const fn feed(name: &'static str, key: &'static [&'static str]) -> StreamSpec {
    StreamSpec {
        name,
        table: StreamTable::User(name),
        key,
        time: "created_at",
        slack: true,
    }
}

const fn game_log(name: &'static str, key: &'static [&'static str]) -> StreamSpec {
    StreamSpec {
        name,
        table: StreamTable::Owned(name),
        key,
        time: "created_at",
        slack: false,
    }
}

pub const ROW_STREAMS: &[StreamSpec] = &[
    feed("feed_gps", &["user_id", "location"]),
    feed("feed_status", &["user_id", "status", "status_description"]),
    feed("feed_bio", &["user_id", "bio"]),
    feed("feed_avatar", &["user_id", "avatar_name"]),
    feed("feed_online_offline", &["user_id", "type"]),
    feed("friend_log_history", &["user_id", "type"]),
    feed("self_profile_log", &["field", "value"]),
    StreamSpec {
        name: "avatar_wear_log",
        table: StreamTable::User("avatar_wear_log"),
        key: &["avatar_id"],
        time: "started_at",
        slack: true,
    },
    game_log("gamelog_location", &["location"]),
    game_log("gamelog_join_leave", &["type", "display_name"]),
    game_log("gamelog_portal_spawn", &["display_name"]),
    game_log("gamelog_video_play", &["video_url"]),
    game_log("gamelog_resource_load", &["resource_url"]),
    game_log("gamelog_event", &["data"]),
    game_log("gamelog_external", &["message"]),
];

/// A table holding current state rather than a log of events. Its rows are
/// sent whole whenever the table changes, and merged by key on arrival.
#[derive(Clone, Copy, Debug)]
pub struct StateSpec {
    pub name: &'static str,
    pub table: StreamTable,
    pub key: &'static [&'static str],
    /// When present, the row with the later value wins. Without it a row
    /// that already exists locally is kept as it is.
    pub version: Option<&'static str>,
}

const fn state(
    name: &'static str,
    table: StreamTable,
    key: &'static [&'static str],
    version: Option<&'static str>,
) -> StateSpec {
    StateSpec {
        name,
        table,
        key,
        version,
    }
}

pub const STATE_STREAMS: &[StateSpec] = &[
    state(
        "memos",
        StreamTable::Global("memos"),
        &["user_id"],
        Some("edited_at"),
    ),
    state(
        "world_memos",
        StreamTable::Global("world_memos"),
        &["world_id"],
        Some("edited_at"),
    ),
    state(
        "avatar_memos",
        StreamTable::Global("avatar_memos"),
        &["avatar_id"],
        Some("edited_at"),
    ),
    state(
        "avatar_tags",
        StreamTable::Global("avatar_tags"),
        &["avatar_id", "tag"],
        None,
    ),
    state(
        "favorite_world",
        StreamTable::Global("favorite_world"),
        &["world_id", "group_name"],
        None,
    ),
    state(
        "favorite_avatar",
        StreamTable::Global("favorite_avatar"),
        &["avatar_id", "group_name"],
        None,
    ),
    state(
        "notes",
        StreamTable::User("notes"),
        &["user_id"],
        Some("created_at"),
    ),
    state(
        "moderation",
        StreamTable::User("moderation"),
        &["user_id"],
        Some("updated_at"),
    ),
    state(
        "notifications_v2",
        StreamTable::User("notifications_v2"),
        &["id"],
        Some("updated_at"),
    ),
    state(
        "avatar_history",
        StreamTable::User("avatar_history"),
        &["avatar_id"],
        Some("created_at"),
    ),
    state(
        "profile_bio",
        StreamTable::User("profile_bio"),
        &["user_id"],
        Some("checked_at"),
    ),
    state(
        "friend_log_current",
        StreamTable::User("friend_log_current"),
        &["user_id"],
        None,
    ),
    state(
        "mutual_graph_friends",
        StreamTable::User("mutual_graph_friends"),
        &["friend_id"],
        None,
    ),
    state(
        "mutual_graph_links",
        StreamTable::User("mutual_graph_links"),
        &["friend_id", "mutual_id"],
        None,
    ),
    state(
        "mutual_graph_meta",
        StreamTable::User("mutual_graph_meta"),
        &["friend_id"],
        Some("last_fetched_at"),
    ),
    state(
        "favorite_friend",
        StreamTable::Owned("favorite_friend"),
        &["user_id", "group_name"],
        None,
    ),
    state(
        "favorite_group_collection",
        StreamTable::Owned("favorite_group_collection"),
        &["id"],
        None,
    ),
];

pub fn state_spec(name: &str) -> Option<&'static StateSpec> {
    STATE_STREAMS.iter().find(|spec| spec.name == name)
}

impl StateSpec {
    fn as_stream(&self) -> StreamSpec {
        StreamSpec {
            name: self.name,
            table: self.table,
            key: self.key,
            time: "",
            slack: false,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct StateExport {
    pub rows: Vec<Value>,
    /// Rows deleted here in the last 90 days: `{ key: [...], deletedAtMs }`.
    pub deleted: Vec<Value>,
    pub fingerprint: i64,
}

/// Every row of a state table in key order, with a fingerprint that changes
/// whenever the table's content does.
pub fn export_state(
    db: &DatabaseService,
    scope: &StreamScope,
    spec: &StateSpec,
) -> Result<StateExport, Error> {
    use std::hash::{Hash, Hasher};
    let stream = spec.as_stream();
    let table = scope.table_name(&stream);
    let columns = synced_columns(db, &table, &stream)?;
    let column_list = columns
        .iter()
        .map(|name| quote(name))
        .collect::<Vec<_>>()
        .join(", ");
    let order = spec
        .key
        .iter()
        .map(|name| quote(name))
        .collect::<Vec<_>>()
        .join(", ");
    let rows = db.execute(
        &format!(
            "SELECT {column_list} FROM {} WHERE 1 = 1{} ORDER BY {order}",
            quote(&table),
            owner_filter(&stream)
        ),
        &ParamsBuilder::new()
            .set("owner_row_id", scope.owner_row_id)
            .build(),
    )?;
    let now_ms = chrono::Utc::now().timestamp_millis();
    let deleted = db
        .execute(
            "SELECT row_key, deleted_at_ms FROM remote_sync_tombstone WHERE stream = @stream AND owner_id = @owner AND deleted_at_ms >= @oldest ORDER BY row_key",
            &ParamsBuilder::new()
                .set("stream", table.clone())
                .set("owner", tombstone_owner(scope, spec))
                .set("oldest", now_ms - TOMBSTONE_MAX_AGE_MS)
                .build(),
        )?
        .iter()
        .filter_map(|row| {
            let key = serde_json::from_str::<Value>(&row_string(row, 0)).ok()?;
            Some(serde_json::json!({ "key": key, "deletedAtMs": row_i64(row, 1) }))
        })
        .collect::<Vec<_>>();
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    let rows = rows
        .into_iter()
        .map(|row| {
            let object = Value::Object(columns.iter().cloned().zip(row).collect::<Map<_, _>>());
            object.to_string().hash(&mut hasher);
            object
        })
        .collect::<Vec<_>>();
    for tombstone in &deleted {
        tombstone.to_string().hash(&mut hasher);
    }
    // Zero means "never sent", so a table with nothing to say is not uploaded.
    let fingerprint = if rows.is_empty() && deleted.is_empty() {
        0
    } else {
        (hasher.finish() >> 1) as i64 | 1
    };
    Ok(StateExport {
        rows,
        deleted,
        fingerprint,
    })
}

fn import_state_row(
    tx: &DatabaseWriteTransaction<'_>,
    scope: &StreamScope,
    table: &str,
    columns: &[String],
    spec: &StateSpec,
    row: &Value,
) -> Result<RowOutcome, Error> {
    let Some(object) = row.as_object() else {
        return Ok(RowOutcome::Invalid);
    };
    let mut values = Vec::new();
    for column in columns {
        match object.get(column).map(scalar) {
            Some(Some(value)) => values.push((column.as_str(), value)),
            Some(None) => return Ok(RowOutcome::Invalid),
            None => {}
        }
    }
    let value_of = |column: &str| {
        values
            .iter()
            .find(|(name, _)| *name == column)
            .map(|(_, value)| value.clone())
    };
    let mut key = ParamsBuilder::new();
    let mut conditions = Vec::new();
    for (index, column) in spec.key.iter().enumerate() {
        let Some(value) = value_of(column).filter(|value| !value.is_null()) else {
            return Ok(RowOutcome::Invalid);
        };
        conditions.push(format!("{} = @k{index}", quote(column)));
        key = key.set(&format!("k{index}"), value);
    }
    let stream = spec.as_stream();
    let conditions = format!("{}{}", conditions.join(" AND "), owner_filter(&stream));
    let row_key = Value::Array(
        spec.key
            .iter()
            .map(|column| value_of(column).unwrap_or(Value::Null))
            .collect(),
    )
    .to_string();
    let remote_version = spec
        .version
        .and_then(value_of)
        .map(|value| row_string(&[value], 0));
    let key = key.set("owner_row_id", scope.owner_row_id).build();
    let quoted = quote(table);
    let version = spec.version.map(quote).unwrap_or_else(|| "NULL".into());
    let existing = tx.execute(
        &format!("SELECT {version} FROM {quoted} WHERE {conditions} LIMIT 1"),
        &key,
    )?;
    let Some(found) = existing.first() else {
        // A row deleted here stays deleted unless the remote copy was
        // written after the deletion.
        let deleted_at = tx
            .execute(
                "SELECT deleted_at_ms FROM remote_sync_tombstone WHERE stream = @stream AND owner_id = @owner AND row_key = @row_key",
                &ParamsBuilder::new()
                    .set("stream", table)
                    .set("owner", tombstone_owner(scope, spec))
                    .set("row_key", row_key)
                    .build(),
            )?
            .first()
            .map(|row| row_i64(row, 0));
        if let Some(deleted_at) = deleted_at {
            if remote_version.is_none_or(|version| version <= iso_from_ms(deleted_at)) {
                return Ok(RowOutcome::Matched);
            }
        }
        let owned = matches!(spec.table, StreamTable::Owned(_));
        let names = values
            .iter()
            .map(|(name, _)| quote(name))
            .chain(owned.then(|| COL_OWNER_ID.to_owned()))
            .collect::<Vec<_>>()
            .join(", ");
        let holders = (0..values.len())
            .map(|index| format!("@v{index}"))
            .chain(owned.then(|| "@owner_row_id".to_owned()))
            .collect::<Vec<_>>()
            .join(", ");
        let mut insert = ParamsBuilder::new().set("owner_row_id", scope.owner_row_id);
        for (index, (_, value)) in values.iter().enumerate() {
            insert = insert.set(&format!("v{index}"), value.clone());
        }
        let added = tx.execute_non_query(
            &format!("INSERT OR IGNORE INTO {quoted} ({names}) VALUES ({holders})"),
            &insert.build(),
        )?;
        return Ok(if added > 0 {
            RowOutcome::Inserted
        } else {
            RowOutcome::Matched
        });
    };
    let newer = remote_version.is_some_and(|remote| remote > row_string(found, 0));
    if !newer {
        return Ok(RowOutcome::Matched);
    }
    let mut update = key;
    let mut assignments = Vec::new();
    for (index, (name, value)) in values.iter().enumerate() {
        if spec.key.contains(name) {
            continue;
        }
        assignments.push(format!("{} = @v{index}", quote(name)));
        update.insert(format!("@v{index}"), value.clone());
    }
    if !assignments.is_empty() {
        tx.execute_non_query(
            &format!(
                "UPDATE {quoted} SET {} WHERE {conditions}",
                assignments.join(", ")
            ),
            &update,
        )?;
    }
    Ok(RowOutcome::Inserted)
}

/// Applies a deletion made on another PC. The local row goes only when it
/// was not written after the deletion, and the deletion is remembered with
/// its original time so it neither comes back nor overrides a later edit.
fn import_state_deletion(
    tx: &DatabaseWriteTransaction<'_>,
    scope: &StreamScope,
    table: &str,
    spec: &StateSpec,
    entry: &Value,
) -> Result<RowOutcome, Error> {
    let (Some(key), Some(deleted_at)) = (
        entry.get("key").and_then(Value::as_array),
        entry.get("deletedAtMs").and_then(Value::as_i64),
    ) else {
        return Ok(RowOutcome::Invalid);
    };
    if key.len() != spec.key.len()
        || key
            .iter()
            .any(|value| scalar(value).is_none_or(|value| value.is_null()))
    {
        return Ok(RowOutcome::Invalid);
    }
    let stream = spec.as_stream();
    let mut params = ParamsBuilder::new()
        .set("owner_row_id", scope.owner_row_id)
        .set("deleted_iso", iso_from_ms(deleted_at));
    let mut conditions = Vec::new();
    for (index, (column, value)) in spec.key.iter().zip(key).enumerate() {
        conditions.push(format!("{} = @k{index}", quote(column)));
        params = params.set(&format!("k{index}"), value.clone());
    }
    let not_newer = match spec.version {
        Some(column) => format!(" AND ({0} IS NULL OR {0} <= @deleted_iso)", quote(column)),
        None => String::new(),
    };
    let removed = tx.execute_non_query(
        &format!(
            "DELETE FROM {} WHERE {}{}{not_newer}",
            quote(table),
            conditions.join(" AND "),
            owner_filter(&stream),
        ),
        &params.build(),
    )?;
    let still_there = !tx
        .execute(
            &format!(
                "SELECT 1 FROM {} WHERE {}{} LIMIT 1",
                quote(table),
                conditions.join(" AND "),
                owner_filter(&stream),
            ),
            &{
                let mut lookup = ParamsBuilder::new().set("owner_row_id", scope.owner_row_id);
                for (index, value) in key.iter().enumerate() {
                    lookup = lookup.set(&format!("k{index}"), value.clone());
                }
                lookup.build()
            },
        )?
        .is_empty();
    if !still_there {
        tx.execute_non_query(
            "INSERT INTO remote_sync_tombstone (stream, owner_id, row_key, deleted_at_ms) VALUES (@stream, @owner, @row_key, @deleted_at) ON CONFLICT (stream, owner_id, row_key) DO UPDATE SET deleted_at_ms = excluded.deleted_at_ms",
            &ParamsBuilder::new()
                .set("stream", table)
                .set("owner", tombstone_owner(scope, spec))
                .set("row_key", Value::Array(key.clone()).to_string())
                .set("deleted_at", deleted_at)
                .build(),
        )?;
    }
    Ok(if removed > 0 {
        RowOutcome::Inserted
    } else {
        RowOutcome::Matched
    })
}

pub fn stream_spec(name: &str) -> Option<&'static StreamSpec> {
    ROW_STREAMS.iter().find(|spec| spec.name == name)
}

/// The local tables of one VRChat account.
#[derive(Clone, Debug)]
pub struct StreamScope {
    user_prefix: String,
    owner_row_id: i64,
}

impl StreamScope {
    pub fn open(db: &DatabaseService, vrchat_user_id: &str) -> Result<Self, Error> {
        let user_prefix = normalize_user_table_prefix(vrchat_user_id)?;
        crate::database::schema::ensure_user_store_tables(db, &user_prefix)?;
        crate::database::schema::ensure_global_store_tables(db)?;
        ensure_game_log_tables(db)?;
        crate::profile_bio::ensure_profile_bio_table(db, &OwnerId::new(vrchat_user_id))?;
        super::ensure_remote_sync_tables(db)?;
        let owner_row_id = owner_id_get_or_insert(db, &OwnerId::new(vrchat_user_id))?.value();
        let scope = Self {
            user_prefix,
            owner_row_id,
        };
        ensure_tombstone_triggers(db, &scope)?;
        Ok(scope)
    }

    pub fn table_name(&self, spec: &StreamSpec) -> String {
        match spec.table {
            StreamTable::User(suffix) => format!("{}_{suffix}", self.user_prefix),
            StreamTable::Owned(table) | StreamTable::Global(table) => table.to_owned(),
        }
    }
}

/// Stream name carrying the deletions of a state stream.
pub const DELETED_SUFFIX: &str = "#deleted";
/// Deletions older than this are no longer sent.
const TOMBSTONE_MAX_AGE_MS: i64 = 90 * 24 * 60 * 60 * 1000;

fn owner_value(table: StreamTable, alias: &str) -> String {
    match table {
        StreamTable::Owned(_) => format!("{alias}.owner_id"),
        StreamTable::User(_) | StreamTable::Global(_) => "0".into(),
    }
}

/// Deleting a row of a state table records which row and when, so the
/// deletion can travel to other PCs; inserting the row again clears it.
/// SQLite keeps these triggers with the table, so every code path that
/// deletes a row is covered without having to know about sync.
fn ensure_tombstone_triggers(db: &DatabaseService, scope: &StreamScope) -> Result<(), Error> {
    db.ensure_schema_once(&format!("remote-sync-tombstones:{}", scope.user_prefix), || {
        for spec in STATE_STREAMS {
            let table = scope.table_name(&spec.as_stream());
            let literal = table.replace('\'', "''");
            let key = |alias: &str| {
                spec.key
                    .iter()
                    .map(|column| format!("{alias}.{}", quote(column)))
                    .collect::<Vec<_>>()
                    .join(", ")
            };
            for sql in [
                format!(
                    "CREATE TRIGGER IF NOT EXISTS {} AFTER DELETE ON {} BEGIN INSERT OR REPLACE INTO remote_sync_tombstone (stream, owner_id, row_key, deleted_at_ms) VALUES ('{literal}', {}, json_array({}), CAST(strftime('%s', 'now') AS INTEGER) * 1000); END",
                    quote(&format!("remote_sync_deleted_{table}")),
                    quote(&table),
                    owner_value(spec.table, "OLD"),
                    key("OLD"),
                ),
                format!(
                    "CREATE TRIGGER IF NOT EXISTS {} AFTER INSERT ON {} BEGIN DELETE FROM remote_sync_tombstone WHERE stream = '{literal}' AND owner_id = {} AND row_key = json_array({}); END",
                    quote(&format!("remote_sync_restored_{table}")),
                    quote(&table),
                    owner_value(spec.table, "NEW"),
                    key("NEW"),
                ),
            ] {
                db.execute_non_query(&sql, &Default::default())?;
            }
        }
        Ok(())
    })
}

fn tombstone_owner(scope: &StreamScope, spec: &StateSpec) -> i64 {
    match spec.table {
        StreamTable::Owned(_) => scope.owner_row_id,
        StreamTable::User(_) | StreamTable::Global(_) => 0,
    }
}

fn iso_from_ms(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|time| time.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
        .unwrap_or_default()
}

fn quote(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

/// Columns that travel: everything except the local row id alias and, for
/// shared tables, the local owner id.
pub(crate) fn synced_columns(
    db: &DatabaseService,
    table: &str,
    spec: &StreamSpec,
) -> Result<Vec<String>, Error> {
    let rows = db.execute(
        &format!("PRAGMA table_info({})", quote(table)),
        &Default::default(),
    )?;
    let primary_keys = rows.iter().filter(|row| row_i64(row, 5) > 0).count();
    Ok(rows
        .iter()
        .filter(|row| {
            let rowid_alias = primary_keys == 1
                && row_i64(row, 5) > 0
                && row_string(row, 2).eq_ignore_ascii_case("INTEGER");
            let local_owner =
                matches!(spec.table, StreamTable::Owned(_)) && row_string(row, 1) == COL_OWNER_ID;
            !rowid_alias && !local_owner
        })
        .map(|row| row_string(row, 1))
        .collect())
}

fn owner_filter(spec: &StreamSpec) -> &'static str {
    match spec.table {
        StreamTable::Owned(_) => " AND owner_id = @owner_row_id",
        StreamTable::User(_) | StreamTable::Global(_) => "",
    }
}

/// Rows recorded on this PC after `after_rowid`, oldest first. Rows that
/// were imported from sync are left out so they are never uploaded as new.
pub fn export_rows(
    db: &DatabaseService,
    scope: &StreamScope,
    spec: &StreamSpec,
    after_rowid: i64,
    limit: u32,
) -> Result<Vec<(i64, Value)>, Error> {
    let table = scope.table_name(spec);
    let columns = synced_columns(db, &table, spec)?;
    let column_list = columns
        .iter()
        .map(|name| quote(name))
        .collect::<Vec<_>>()
        .join(", ");
    let rows = db.execute(
        &format!(
            "SELECT rowid, {column_list} FROM {table} WHERE rowid > @after{owner} AND rowid NOT IN (SELECT local_rowid FROM remote_sync_provenance WHERE stream = @stream) ORDER BY rowid LIMIT @limit",
            table = quote(&table),
            owner = owner_filter(spec),
        ),
        &ParamsBuilder::new()
            .set("after", after_rowid)
            .set("owner_row_id", scope.owner_row_id)
            .set("stream", table.clone())
            .set("limit", limit)
            .build(),
    )?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let rowid = row_i64(&row, 0);
            let object = columns
                .iter()
                .cloned()
                .zip(row.into_iter().skip(1))
                .collect::<Map<_, _>>();
            (rowid, Value::Object(object))
        })
        .collect())
}

/// Exports every local row in a history stream for a replacement snapshot,
/// including rows imported from other devices. Normal incremental sync uses
/// `export_rows` so imported rows are never uploaded a second time.
pub fn export_rows_for_compaction(
    db: &DatabaseService,
    scope: &StreamScope,
    spec: &StreamSpec,
) -> Result<Vec<Value>, Error> {
    let table = scope.table_name(spec);
    let columns = synced_columns(db, &table, spec)?;
    let column_list = columns
        .iter()
        .map(|name| quote(name))
        .collect::<Vec<_>>()
        .join(", ");
    let rows = db.execute(
        &format!(
            "SELECT {column_list} FROM {} WHERE 1 = 1{} ORDER BY rowid",
            quote(&table),
            owner_filter(spec),
        ),
        &ParamsBuilder::new()
            .set("owner_row_id", scope.owner_row_id)
            .build(),
    )?;
    Ok(rows
        .into_iter()
        .map(|row| Value::Object(columns.iter().cloned().zip(row).collect::<Map<_, _>>()))
        .collect())
}

/// Deletes exported rows up to `through_rowid`. Only the collector uses
/// this, to keep its temporary database small once the server confirmed
/// those rows; the desktop app never deletes history because of sync.
#[cfg(feature = "collector")]
pub fn delete_rows_through(
    db: &DatabaseService,
    scope: &StreamScope,
    spec: &StreamSpec,
    through_rowid: i64,
) -> Result<i64, Error> {
    db.execute_non_query(
        &format!(
            "DELETE FROM {} WHERE rowid <= @through{}",
            quote(&scope.table_name(spec)),
            owner_filter(spec)
        ),
        &ParamsBuilder::new()
            .set("through", through_rowid)
            .set("owner_row_id", scope.owner_row_id)
            .build(),
    )
}

/// Where a pulled chunk came from. `server_seq` becomes the new pull cursor.
#[derive(Clone, Copy, Debug)]
pub struct ImportSource<'a> {
    pub vault: &'a VaultRef,
    pub source_id: &'a str,
    pub source_seq: u64,
    pub server_seq: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ImportReport {
    /// The chunk had been imported before; nothing was changed.
    pub replayed: bool,
    pub inserted: u64,
    /// Rows this PC already had, recorded by itself or by another source.
    pub matched: u64,
    pub invalid_rows: u64,
    pub unknown_streams: Vec<String>,
}

fn scalar(value: &Value) -> Option<Value> {
    match value {
        Value::Null | Value::Number(_) | Value::String(_) => Some(value.clone()),
        Value::Bool(flag) => Some(Value::from(i64::from(*flag))),
        Value::Array(_) | Value::Object(_) => None,
    }
}

struct PreparedStream<'a> {
    spec: &'static StreamSpec,
    table: String,
    columns: Vec<String>,
    rows: &'a [Value],
}

struct PreparedState<'a> {
    spec: &'static StateSpec,
    table: String,
    columns: Vec<String>,
    rows: &'a [Value],
    deletions: bool,
}

/// Imports one verified chunk in a single transaction, together with the
/// pull cursor, so a crash never leaves a half-imported chunk behind.
pub fn import_chunk(
    db: &DatabaseService,
    scope: &StreamScope,
    source: ImportSource<'_>,
    streams: &BTreeMap<String, Vec<Value>>,
) -> Result<ImportReport, Error> {
    let mut report = ImportReport::default();
    let mut prepared = Vec::new();
    let mut prepared_state = Vec::new();
    for (name, rows) in streams {
        let (state_name, deletions) = match name.strip_suffix(DELETED_SUFFIX) {
            Some(base) => (base, true),
            None => (name.as_str(), false),
        };
        if let Some(spec) = state_spec(state_name) {
            let stream = spec.as_stream();
            let table = scope.table_name(&stream);
            let columns = synced_columns(db, &table, &stream)?;
            prepared_state.push(PreparedState {
                spec,
                table,
                columns,
                rows,
                deletions,
            });
            continue;
        }
        let Some(spec) = stream_spec(name) else {
            report.unknown_streams.push(name.clone());
            continue;
        };
        let table = scope.table_name(spec);
        let columns = synced_columns(db, &table, spec)?;
        prepared.push(PreparedStream {
            spec,
            table,
            columns,
            rows,
        });
    }

    db.write_transaction(|tx| {
        let seen = vault_params(source.vault)
            .set("source_id", source.source_id)
            .set("source_seq", to_i64(source.source_seq))
            .build();
        report.replayed = !tx
            .execute(
                &format!("SELECT 1 FROM remote_sync_seen_chunk WHERE {VAULT_WHERE} AND source_id = @source_id AND source_seq = @source_seq"),
                &seen,
            )?
            .is_empty();
        if !report.replayed {
            for stream in &prepared {
                for row in stream.rows {
                    match import_row(tx, scope, &source, stream, row)? {
                        RowOutcome::Inserted => report.inserted += 1,
                        RowOutcome::Matched => report.matched += 1,
                        RowOutcome::Invalid => report.invalid_rows += 1,
                    }
                }
            }
            for state in &prepared_state {
                for row in state.rows {
                    let outcome = if state.deletions {
                        import_state_deletion(tx, scope, &state.table, state.spec, row)?
                    } else {
                        import_state_row(tx, scope, &state.table, &state.columns, state.spec, row)?
                    };
                    match outcome {
                        RowOutcome::Inserted => report.inserted += 1,
                        RowOutcome::Matched => report.matched += 1,
                        RowOutcome::Invalid => report.invalid_rows += 1,
                    }
                }
            }
            tx.execute_non_query(
                "INSERT OR IGNORE INTO remote_sync_seen_chunk (api_origin, account_id, vault_id, source_id, source_seq) VALUES (@api_origin, @account_id, @vault_id, @source_id, @source_seq)",
                &seen,
            )?;
        }
        tx.execute_non_query(
            &format!("UPDATE remote_sync_state SET pull_cursor = MAX(pull_cursor, @server_seq) WHERE {VAULT_WHERE}"),
            &vault_params(source.vault)
                .set("server_seq", to_i64(source.server_seq))
                .build(),
        )?;
        Ok(())
    })?;
    Ok(report)
}

enum RowOutcome {
    Inserted,
    Matched,
    Invalid,
}

fn import_row(
    tx: &DatabaseWriteTransaction<'_>,
    scope: &StreamScope,
    source: &ImportSource<'_>,
    stream: &PreparedStream<'_>,
    row: &Value,
) -> Result<RowOutcome, Error> {
    let spec = stream.spec;
    let Some(object) = row.as_object() else {
        return Ok(RowOutcome::Invalid);
    };
    let mut values = Vec::new();
    for column in &stream.columns {
        match object.get(column).map(scalar) {
            Some(Some(value)) => values.push((column.as_str(), value)),
            Some(None) => return Ok(RowOutcome::Invalid),
            None => {}
        }
    }
    let value_of = |column: &str| {
        values
            .iter()
            .find(|(name, _)| *name == column)
            .map(|(_, value)| value.clone())
    };
    let Some(Value::String(time)) = value_of(spec.time) else {
        return Ok(RowOutcome::Invalid);
    };

    let mut params = ParamsBuilder::new()
        .set("stream", stream.table.clone())
        .set("source_id", source.source_id)
        .set("owner_row_id", scope.owner_row_id)
        .set("time", time.clone());
    let mut conditions = Vec::new();
    for (index, column) in spec.key.iter().enumerate() {
        conditions.push(format!("{} IS @k{index}", quote(column)));
        params = params.set(
            &format!("k{index}"),
            value_of(column).unwrap_or(Value::Null),
        );
    }
    let time_column = quote(spec.time);
    match DateTime::parse_from_rfc3339(&time)
        .ok()
        .filter(|_| spec.slack)
    {
        Some(at) => {
            // The text range narrows the search through the time index;
            // julianday then compares the instants themselves.
            let slack = Duration::seconds(DEDUPE_SLACK_SECONDS);
            let format = "%Y-%m-%dT%H:%M:%S";
            let at = at.to_utc();
            conditions.push(format!(
                "{time_column} >= @lo AND {time_column} <= @hi AND ABS((julianday({time_column}) - julianday(@time)) * 86400.0) <= @slack"
            ));
            params = params
                .set("lo", (at - slack).format(format).to_string())
                .set("hi", format!("{}~", (at + slack).format(format)))
                .set("slack", DEDUPE_SLACK_SECONDS as f64 + 0.001);
        }
        None => conditions.push(format!("{time_column} IS @time")),
    }
    let table = quote(&stream.table);
    // Rows that came from this same source are separate events of that
    // source, so they never count as the copy of another of its rows.
    let existing = tx.execute(
        &format!(
            "SELECT rowid FROM {table} WHERE {conditions}{owner} AND rowid NOT IN (SELECT local_rowid FROM remote_sync_provenance WHERE stream = @stream AND source_id = @source_id) LIMIT 1",
            conditions = conditions.join(" AND "),
            owner = owner_filter(spec),
        ),
        &params.build(),
    )?;
    let (rowid, outcome) = match existing.first() {
        Some(found) => (row_i64(found, 0), RowOutcome::Matched),
        None => {
            let mut names = values
                .iter()
                .map(|(name, _)| quote(name))
                .collect::<Vec<_>>();
            let mut holders = (0..values.len())
                .map(|index| format!("@v{index}"))
                .collect::<Vec<_>>();
            let mut insert = ParamsBuilder::new();
            for (index, (_, value)) in values.iter().enumerate() {
                insert = insert.set(&format!("v{index}"), value.clone());
            }
            if matches!(spec.table, StreamTable::Owned(_)) {
                names.push(COL_OWNER_ID.to_owned());
                holders.push("@owner_row_id".to_owned());
                insert = insert.set("owner_row_id", scope.owner_row_id);
            }
            let added = tx.execute_non_query(
                &format!(
                    "INSERT OR IGNORE INTO {table} ({}) VALUES ({})",
                    names.join(", "),
                    holders.join(", ")
                ),
                &insert.build(),
            )?;
            if added == 0 {
                // A unique index already holds this event.
                return Ok(RowOutcome::Matched);
            }
            let inserted = tx.execute("SELECT last_insert_rowid()", &Default::default())?;
            (
                inserted.first().map(|row| row_i64(row, 0)).unwrap_or(0),
                RowOutcome::Inserted,
            )
        }
    };
    tx.execute_non_query(
        "INSERT OR IGNORE INTO remote_sync_provenance (stream, local_rowid, source_id, source_seq) VALUES (@stream, @local_rowid, @source_id, @source_seq)",
        &ParamsBuilder::new()
            .set("stream", stream.table.clone())
            .set("local_rowid", rowid)
            .set("source_id", source.source_id)
            .set("source_seq", to_i64(source.source_seq))
            .build(),
    )?;
    Ok(outcome)
}
