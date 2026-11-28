//! Fork: local favorites live in id-keyed group and item tables, but they
//! travel through sync as the flat `(entity id, group name)` rows older
//! versions sent. These views present the tables in that shape, so the
//! generic state stream code can read, insert and delete them unchanged.

use crate::database::DatabaseService;
use crate::favorites::{GROUP_TABLE, ITEM_TABLE};
use crate::Error;

const NOW: &str = "CAST(strftime('%s', 'now') AS INTEGER)";

/// `(view, kind, entity column, owned)`.
pub(crate) const FAVORITE_VIEWS: [(&str, &str, &str, bool); 3] = [
    ("remote_sync_favorite_world", "world", "world_id", false),
    ("remote_sync_favorite_avatar", "avatar", "avatar_id", false),
    ("remote_sync_favorite_friend", "friend", "user_id", true),
];

/// Tombstones written before favorites moved to the id tables used the old
/// table names as their stream.
const RENAMED_TOMBSTONE_STREAMS: [(&str, &str); 3] = [
    ("favorite_world", "remote_sync_favorite_world"),
    ("favorite_avatar", "remote_sync_favorite_avatar"),
    ("favorite_friend", "remote_sync_favorite_friend"),
];

pub(crate) fn is_favorite_view(table: &str) -> bool {
    FAVORITE_VIEWS.iter().any(|(view, ..)| *view == table)
}

pub(crate) fn ensure_favorite_views(db: &DatabaseService) -> Result<(), Error> {
    db.ensure_schema_once("remote-sync-favorite-views", || {
        for (view, kind, column, owned) in FAVORITE_VIEWS {
            for sql in view_sql(view, kind, column, owned) {
                db.execute_non_query(&sql, &Default::default())?;
            }
        }
        for sql in tombstone_trigger_sql() {
            db.execute_non_query(&sql, &Default::default())?;
        }
        crate::config::ensure_config_table(db)?;
        db.execute_non_query(RENAMED_GROUP_SETTINGS_TRIGGER, &Default::default())?;
        for (from, to) in RENAMED_TOMBSTONE_STREAMS {
            db.execute_non_query(
                &format!(
                    "UPDATE OR IGNORE remote_sync_tombstone SET stream = '{to}' WHERE stream = '{from}'"
                ),
                &Default::default(),
            )?;
        }
        Ok(())
    })
}

fn view_sql(view: &str, kind: &str, column: &str, owned: bool) -> Vec<String> {
    let owner_column = if owned {
        ", g.owner_id AS owner_id"
    } else {
        ""
    };
    // A friend row belongs to its account; a shared group of the same name
    // takes it, as when the app adds one.
    let (realm, new_owner, old_owner) = if owned {
        (
            "owner_id IN (0, NEW.owner_id)",
            "NEW.owner_id",
            "owner_id = OLD.owner_id",
        )
    } else {
        ("owner_id = 0", "0", "owner_id = 0")
    };
    let name = "trim(COALESCE(NEW.group_name, ''))";
    let entity = format!("trim(COALESCE(NEW.{column}, ''))");
    let created = format!("COALESCE(NEW.created_at, {NOW})");
    vec![
        format!(
            "CREATE VIEW IF NOT EXISTS {view} AS SELECT i.created_at AS created_at, i.entity_id AS {column}, g.name AS group_name, i.sort_order AS sort_order{owner_column} FROM {ITEM_TABLE} i JOIN {GROUP_TABLE} g ON g.id = i.group_id WHERE g.kind = '{kind}'"
        ),
        format!(
            "CREATE TRIGGER IF NOT EXISTS {view}_insert INSTEAD OF INSERT ON {view} BEGIN \
             INSERT INTO {GROUP_TABLE} (kind, owner_id, name, sort_order, created_at) \
             SELECT '{kind}', {new_owner}, {name}, COALESCE((SELECT MAX(sort_order) + 1 FROM {GROUP_TABLE} WHERE kind = '{kind}' AND owner_id = {new_owner}), 0), {created} \
             WHERE {name} <> '' AND {entity} <> '' AND NOT EXISTS (SELECT 1 FROM {GROUP_TABLE} WHERE kind = '{kind}' AND {realm} AND name = {name}); \
             INSERT OR IGNORE INTO {ITEM_TABLE} (group_id, entity_id, sort_order, created_at) \
             SELECT g.id, {entity}, NEW.sort_order, {created} FROM {GROUP_TABLE} g \
             WHERE g.kind = '{kind}' AND g.{realm} AND g.name = {name} AND {entity} <> '' \
             ORDER BY g.owner_id = {new_owner} DESC LIMIT 1; \
             END"
        ),
        format!(
            "CREATE TRIGGER IF NOT EXISTS {view}_delete INSTEAD OF DELETE ON {view} BEGIN \
             DELETE FROM {ITEM_TABLE} WHERE entity_id = OLD.{column} AND group_id IN \
             (SELECT id FROM {GROUP_TABLE} WHERE kind = '{kind}' AND {old_owner} AND name = OLD.group_name); \
             END"
        ),
    ]
}

/// Settings Sync sends local group references by name, so renaming a group
/// changes every setting that refers to it; marking them changed here lets the
/// new names win over the copies other PCs still hold.
const RENAMED_GROUP_SETTINGS_TRIGGER: &str = "CREATE TRIGGER IF NOT EXISTS remote_sync_renamed_group_settings AFTER UPDATE OF name ON vrcx0_favorite_group WHEN OLD.name <> NEW.name BEGIN \
     INSERT INTO config_local_changes (key, changed_at) \
     SELECT key, CAST(strftime('%s', 'now') AS INTEGER) FROM configs \
     WHERE substr(lower(key), 1, 12) = 'config:vrcx_' \
     AND (instr(value, '\"local:' || NEW.id || '\"') > 0 \
     OR (instr(value, '\"source\":\"local\"') > 0 AND instr(value, '\"key\":\"' || NEW.id || '\"') > 0)) \
     ON CONFLICT (key) DO UPDATE SET changed_at = excluded.changed_at; \
     END";

/// Deleting a favorite here records the old-style row key, so the deletion
/// reaches other PCs; adding it again clears it. Renaming a group is a
/// deletion of every row under the old name.
fn tombstone_trigger_sql() -> Vec<String> {
    let stream = "CASE g.kind WHEN 'world' THEN 'remote_sync_favorite_world' WHEN 'avatar' THEN 'remote_sync_favorite_avatar' ELSE 'remote_sync_favorite_friend' END";
    let owner = "CASE g.kind WHEN 'friend' THEN g.owner_id ELSE 0 END";
    vec![
        format!(
            "CREATE TRIGGER IF NOT EXISTS remote_sync_deleted_{ITEM_TABLE} AFTER DELETE ON {ITEM_TABLE} BEGIN \
             INSERT INTO remote_sync_tombstone (stream, owner_id, row_key, deleted_at) \
             SELECT {stream}, {owner}, json_array(OLD.entity_id, g.name), {NOW} FROM {GROUP_TABLE} g WHERE g.id = OLD.group_id \
             ON CONFLICT (stream, owner_id, row_key) DO UPDATE SET deleted_at = MAX(remote_sync_tombstone.deleted_at, excluded.deleted_at); \
             END"
        ),
        format!(
            "CREATE TRIGGER IF NOT EXISTS remote_sync_restored_{ITEM_TABLE} AFTER INSERT ON {ITEM_TABLE} BEGIN \
             DELETE FROM remote_sync_tombstone WHERE (stream, owner_id, row_key) IN \
             (SELECT {stream}, {owner}, json_array(NEW.entity_id, g.name) FROM {GROUP_TABLE} g WHERE g.id = NEW.group_id); \
             END"
        ),
        format!(
            "CREATE TRIGGER IF NOT EXISTS remote_sync_renamed_{GROUP_TABLE} AFTER UPDATE OF name ON {GROUP_TABLE} WHEN OLD.name <> NEW.name BEGIN \
             INSERT INTO remote_sync_tombstone (stream, owner_id, row_key, deleted_at) \
             SELECT {stream}, {owner}, json_array(i.entity_id, OLD.name), {NOW} FROM {ITEM_TABLE} i JOIN {GROUP_TABLE} g ON g.id = i.group_id WHERE g.id = NEW.id \
             ON CONFLICT (stream, owner_id, row_key) DO UPDATE SET deleted_at = MAX(remote_sync_tombstone.deleted_at, excluded.deleted_at); \
             DELETE FROM remote_sync_tombstone WHERE (stream, owner_id, row_key) IN \
             (SELECT {stream}, {owner}, json_array(i.entity_id, NEW.name) FROM {ITEM_TABLE} i JOIN {GROUP_TABLE} g ON g.id = i.group_id WHERE g.id = NEW.id); \
             END"
        ),
    ]
}
