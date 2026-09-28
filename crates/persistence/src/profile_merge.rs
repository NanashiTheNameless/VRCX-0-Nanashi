//! Fork: non-destructive merge of another profile database (VRCX-0, or VRCX
//! after it was upgraded to the current schema) into this fork's database.
//!
//! Rules:
//! - Existing rows are never updated or deleted. Keyed rows (text/composite
//!   primary keys, unique indexes) use `INSERT OR IGNORE`, so ours win.
//! - Tables keyed only by an autoincrement row id get fresh ids; rows whose
//!   other columns already exist verbatim are skipped (`EXCEPT`).
//! - `owner_id` integers are remapped through the `owners` table.
//! - Regenerable caches, cookies (login sessions) and internal meta rows are
//!   not copied. Settings are only added when the key is not set here.
//! - Tables that exist only in the source (e.g. another account's per-user
//!   tables) are created from the source definition.

use std::collections::BTreeMap;
use std::path::Path;
use std::time::Duration;

use rusqlite::{Connection, OptionalExtension};

use crate::Error;

const SOURCE_SCHEMA: &str = "merge_src";

/// Rows added per table, for the result summary.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileMergeReport {
    pub tables_merged: u32,
    pub tables_created: u32,
    pub rows_added: u64,
    pub per_table: BTreeMap<String, u64>,
    pub skipped_tables: Vec<String>,
    /// Keys added from the other app's JSON settings file (existing keys kept).
    pub settings_file_keys_added: u32,
}

fn is_skipped_table(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.starts_with("sqlite_")
        || lower.contains("cache")
        || lower == "cookies"
        || lower == "migration_test"
        || lower == "owners"
        || lower.contains("_activity_")
        || lower.starts_with("activity_")
}

/// Config keys that describe this database/app instance rather than user
/// preferences, so they must never be copied from another profile.
fn is_skipped_config_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    lower.contains("databaseversion")
        || lower.contains("databaseupgrade")
        || lower.contains("schema")
        || lower.contains("migrat")
        || lower.contains("telemetry")
        || lower.contains("repairv")
        || lower == "id"
}

fn quote(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

struct ColumnInfo {
    name: String,
    declared_type: String,
    pk_position: i64,
}

fn table_columns(conn: &Connection, schema: &str, table: &str) -> Result<Vec<ColumnInfo>, Error> {
    let mut statement = conn
        .prepare(&format!("PRAGMA {schema}.table_info({})", quote(table)))
        .map_err(Error::sqlite)?;
    let rows = statement
        .query_map([], |row| {
            Ok(ColumnInfo {
                name: row.get(1)?,
                declared_type: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                pk_position: row.get(5)?,
            })
        })
        .map_err(Error::sqlite)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Error::sqlite)
}

fn source_tables(conn: &Connection) -> Result<Vec<(String, String)>, Error> {
    let mut statement = conn
        .prepare(&format!(
            "SELECT name, sql FROM {SOURCE_SCHEMA}.sqlite_master WHERE type = 'table' AND sql IS NOT NULL ORDER BY name"
        ))
        .map_err(Error::sqlite)?;
    let rows = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(Error::sqlite)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Error::sqlite)
}

fn main_table_exists(conn: &Connection, table: &str) -> Result<bool, Error> {
    conn.query_row(
        "SELECT 1 FROM main.sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |_| Ok(()),
    )
    .optional()
    .map(|found| found.is_some())
    .map_err(Error::sqlite)
}

fn table_exists_in(conn: &Connection, schema: &str, table: &str) -> Result<bool, Error> {
    conn.query_row(
        &format!("SELECT 1 FROM {schema}.sqlite_master WHERE type = 'table' AND name = ?1"),
        [table],
        |_| Ok(()),
    )
    .optional()
    .map(|found| found.is_some())
    .map_err(Error::sqlite)
}

/// Source owner id -> main owner id, creating missing owners here.
fn build_owner_map(conn: &Connection) -> Result<bool, Error> {
    if !table_exists_in(conn, SOURCE_SCHEMA, "owners")? || !main_table_exists(conn, "owners")? {
        return Ok(false);
    }
    conn.execute_batch(&format!(
        "INSERT OR IGNORE INTO main.owners (user_id) SELECT user_id FROM {SOURCE_SCHEMA}.owners;
         DROP TABLE IF EXISTS temp.merge_owner_map;
         CREATE TEMP TABLE merge_owner_map (src_id INTEGER PRIMARY KEY, main_id INTEGER NOT NULL);
         INSERT INTO temp.merge_owner_map (src_id, main_id)
             SELECT s.id, m.id FROM {SOURCE_SCHEMA}.owners s JOIN main.owners m ON m.user_id = s.user_id;"
    ))
    .map_err(Error::sqlite)?;
    Ok(true)
}

fn select_expression(column: &str, owner_map: bool) -> String {
    let quoted = quote(column);
    if owner_map && column.eq_ignore_ascii_case("owner_id") {
        format!(
            "COALESCE((SELECT main_id FROM temp.merge_owner_map WHERE src_id = s.{quoted}), s.{quoted})"
        )
    } else {
        format!("s.{quoted}")
    }
}

fn merge_configs(conn: &Connection) -> Result<u64, Error> {
    let mut statement = conn
        .prepare(&format!("SELECT key, value FROM {SOURCE_SCHEMA}.configs"))
        .map_err(Error::sqlite)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, rusqlite::types::Value>(1)?,
            ))
        })
        .map_err(Error::sqlite)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(Error::sqlite)?;
    let mut added = 0;
    for (key, value) in rows {
        if is_skipped_config_key(&key) {
            continue;
        }
        added += conn
            .execute(
                "INSERT OR IGNORE INTO main.configs (key, value) VALUES (?1, ?2)",
                rusqlite::params![key, value],
            )
            .map_err(Error::sqlite)? as u64;
    }
    Ok(added)
}

fn merge_table(conn: &Connection, table: &str, owner_map: bool) -> Result<u64, Error> {
    let main_columns = table_columns(conn, "main", table)?;
    let source_columns = table_columns(conn, SOURCE_SCHEMA, table)?;
    let pk_columns = main_columns
        .iter()
        .filter(|column| column.pk_position > 0)
        .collect::<Vec<_>>();
    // `id INTEGER PRIMARY KEY` is a row id alias: let this database assign it.
    let rowid_alias = match pk_columns.as_slice() {
        [only] if only.declared_type.eq_ignore_ascii_case("INTEGER") => Some(only.name.clone()),
        _ => None,
    };
    let columns = main_columns
        .iter()
        .filter(|column| Some(&column.name) != rowid_alias.as_ref())
        .filter(|column| {
            source_columns
                .iter()
                .any(|source| source.name == column.name)
        })
        .map(|column| column.name.clone())
        .collect::<Vec<_>>();
    if columns.is_empty() {
        return Ok(0);
    }
    let column_list = columns
        .iter()
        .map(|name| quote(name))
        .collect::<Vec<_>>()
        .join(", ");
    let select_list = columns
        .iter()
        .map(|name| select_expression(name, owner_map))
        .collect::<Vec<_>>()
        .join(", ");
    let from = format!("{SOURCE_SCHEMA}.{} AS s", quote(table));
    let sql = if rowid_alias.is_some() {
        format!(
            "INSERT OR IGNORE INTO main.{table} ({column_list})
             SELECT {select_list} FROM {from}
             EXCEPT SELECT {column_list} FROM main.{table}",
            table = quote(table)
        )
    } else {
        format!(
            "INSERT OR IGNORE INTO main.{table} ({column_list}) SELECT {select_list} FROM {from}",
            table = quote(table)
        )
    };
    conn.execute(&sql, [])
        .map(|rows| rows as u64)
        .map_err(Error::sqlite)
}

/// Merge another app's JSON settings file (a flat key -> value map, as used by
/// VRCX and VRCX-0) into the live settings store. Only keys that are not set
/// here are added; instance/meta keys are skipped. Returns the number added.
pub fn merge_settings_file(
    storage: &crate::storage::StorageService,
    source_path: &Path,
) -> Result<u32, Error> {
    let text = match std::fs::read_to_string(source_path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(error.into()),
    };
    let values: serde_json::Map<String, serde_json::Value> = match serde_json::from_str(&text) {
        Ok(values) => values,
        // Not a flat JSON object: nothing we can merge safely.
        Err(_) => return Ok(0),
    };
    let existing = storage.get_all();
    let mut added = 0;
    for (key, value) in values {
        if is_skipped_config_key(&key) || existing.contains_key(&key) {
            continue;
        }
        let value = match value {
            serde_json::Value::String(text) => text,
            serde_json::Value::Null => continue,
            other => other.to_string(),
        };
        storage.set(key, value);
        added += 1;
    }
    Ok(added)
}

/// Open the live profile database at `main_path` and merge `source_path` into it.
pub fn merge_profile_database_file(
    main_path: &Path,
    source_path: &Path,
) -> Result<ProfileMergeReport, Error> {
    let conn = Connection::open(main_path).map_err(Error::sqlite)?;
    merge_profile_database(&conn, source_path)
}

/// Merge the database at `source_path` into `conn` (the live profile database).
/// The source must already be at this app's schema version.
pub fn merge_profile_database(
    conn: &Connection,
    source_path: &Path,
) -> Result<ProfileMergeReport, Error> {
    conn.busy_timeout(Duration::from_secs(30))
        .map_err(Error::sqlite)?;
    conn.execute(
        &format!("ATTACH DATABASE ?1 AS {SOURCE_SCHEMA}"),
        [source_path.to_string_lossy().as_ref()],
    )
    .map_err(Error::sqlite)?;
    let result = (|| {
        conn.execute_batch("BEGIN IMMEDIATE")
            .map_err(Error::sqlite)?;
        let merged = (|| {
            let mut report = ProfileMergeReport::default();
            let owner_map = build_owner_map(conn)?;
            for (table, sql) in source_tables(conn)? {
                if is_skipped_table(&table) {
                    report.skipped_tables.push(table);
                    continue;
                }
                if sql
                    .trim_start()
                    .to_ascii_uppercase()
                    .starts_with("CREATE VIRTUAL")
                {
                    report.skipped_tables.push(table);
                    continue;
                }
                let added = if table == "configs" {
                    if !main_table_exists(conn, "configs")? {
                        continue;
                    }
                    merge_configs(conn)?
                } else {
                    if !main_table_exists(conn, &table)? {
                        conn.execute_batch(&sql).map_err(Error::sqlite)?;
                        report.tables_created += 1;
                    }
                    merge_table(conn, &table, owner_map)?
                };
                report.tables_merged += 1;
                report.rows_added += added;
                if added > 0 {
                    report.per_table.insert(table, added);
                }
            }
            Ok::<_, Error>(report)
        })();
        match merged {
            Ok(report) => {
                conn.execute_batch("COMMIT").map_err(Error::sqlite)?;
                Ok(report)
            }
            Err(error) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    })();
    let _ = conn.execute_batch("DROP TABLE IF EXISTS temp.merge_owner_map");
    let _ = conn.execute(&format!("DETACH DATABASE {SOURCE_SCHEMA}"), []);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-nanashi-merge-{name}-{}.sqlite3",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        path
    }

    const SCHEMA: &str = "
        CREATE TABLE configs (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE owners (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL UNIQUE);
        CREATE TABLE memos (user_id TEXT PRIMARY KEY, edited_at TEXT, memo TEXT);
        CREATE TABLE favorite_friend (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, group_name TEXT, owner_id INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE cache_world (id TEXT PRIMARY KEY, name TEXT);
        CREATE TABLE cookies (key TEXT PRIMARY KEY, value TEXT);
    ";

    #[test]
    fn merges_without_overwriting_and_remaps_owners() {
        let main_path = temp_path("main");
        let source_path = temp_path("source");
        let main = Connection::open(&main_path).unwrap();
        main.execute_batch(SCHEMA).unwrap();
        main.execute_batch(
            "INSERT INTO owners (user_id) VALUES ('usr_me');
             INSERT INTO configs VALUES ('theme', 'dark');
             INSERT INTO configs VALUES ('VRCX_0_databaseVersion', '40');
             INSERT INTO memos VALUES ('usr_a', '1', 'mine');
             INSERT INTO favorite_friend (created_at, user_id, group_name, owner_id) VALUES ('t1', 'usr_a', 'G', 1);",
        )
        .unwrap();

        let source = Connection::open(&source_path).unwrap();
        source.execute_batch(SCHEMA).unwrap();
        source
            .execute_batch(
                "INSERT INTO owners (user_id) VALUES ('usr_other');
                 INSERT INTO owners (user_id) VALUES ('usr_me');
                 INSERT INTO configs VALUES ('theme', 'light');
                 INSERT INTO configs VALUES ('zoom', '110');
                 INSERT INTO configs VALUES ('VRCX_0_databaseVersion', '12');
                 INSERT INTO memos VALUES ('usr_a', '2', 'theirs');
                 INSERT INTO memos VALUES ('usr_b', '2', 'new memo');
                 INSERT INTO favorite_friend (created_at, user_id, group_name, owner_id) VALUES ('t1', 'usr_a', 'G', 2);
                 INSERT INTO favorite_friend (created_at, user_id, group_name, owner_id) VALUES ('t2', 'usr_b', 'G', 2);
                 INSERT INTO cache_world VALUES ('wrld_1', 'cached');
                 INSERT INTO cookies VALUES ('auth', 'secret');
                 CREATE TABLE usrother_feed_gps (id INTEGER PRIMARY KEY, created_at TEXT, location TEXT);
                 INSERT INTO usrother_feed_gps (created_at, location) VALUES ('t', 'wrld_1:1');",
            )
            .unwrap();
        drop(source);

        let report = merge_profile_database(&main, &source_path).unwrap();

        let value = |sql: &str| -> String { main.query_row(sql, [], |row| row.get(0)).unwrap() };
        let count = |sql: &str| -> i64 { main.query_row(sql, [], |row| row.get(0)).unwrap() };
        assert_eq!(
            value("SELECT value FROM configs WHERE key = 'theme'"),
            "dark"
        );
        assert_eq!(value("SELECT value FROM configs WHERE key = 'zoom'"), "110");
        assert_eq!(
            value("SELECT value FROM configs WHERE key = 'VRCX_0_databaseVersion'"),
            "40"
        );
        assert_eq!(
            value("SELECT memo FROM memos WHERE user_id = 'usr_a'"),
            "mine"
        );
        assert_eq!(
            value("SELECT memo FROM memos WHERE user_id = 'usr_b'"),
            "new memo"
        );
        // usr_me is owner 1 here and 2 in the source: duplicate skipped, new row remapped.
        assert_eq!(count("SELECT COUNT(*) FROM favorite_friend"), 2);
        assert_eq!(
            count("SELECT owner_id FROM favorite_friend WHERE user_id = 'usr_b'"),
            1
        );
        assert_eq!(count("SELECT COUNT(*) FROM owners"), 2);
        assert_eq!(count("SELECT COUNT(*) FROM cache_world"), 0);
        assert_eq!(count("SELECT COUNT(*) FROM cookies"), 0);
        assert_eq!(count("SELECT COUNT(*) FROM usrother_feed_gps"), 1);
        assert_eq!(report.tables_created, 1);
        assert!(report.skipped_tables.contains(&"cookies".to_string()));

        // Merging again adds nothing.
        let again = merge_profile_database(&main, &source_path).unwrap();
        assert_eq!(again.rows_added, 0);

        drop(main);
        let _ = std::fs::remove_file(main_path);
        let _ = std::fs::remove_file(source_path);
    }

    #[test]
    fn settings_file_merge_adds_only_missing_keys() {
        let dir = std::env::temp_dir().join(format!(
            "vrcx-0-nanashi-settings-merge-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let storage = crate::storage::StorageService::new(&dir.join("mine.json")).unwrap();
        storage.set("theme".into(), "dark".into());
        let source = dir.join("theirs.json");
        std::fs::write(
            &source,
            r#"{"theme":"light","zoom":"110","count":3,"VRCX_0_databaseVersion":"12","gone":null}"#,
        )
        .unwrap();

        assert_eq!(merge_settings_file(&storage, &source).unwrap(), 2);
        assert_eq!(storage.get("theme").as_deref(), Some("dark"));
        assert_eq!(storage.get("zoom").as_deref(), Some("110"));
        assert_eq!(storage.get("count").as_deref(), Some("3"));
        assert_eq!(storage.get("VRCX_0_databaseVersion"), None);
        assert_eq!(
            merge_settings_file(&storage, &dir.join("missing.json")).unwrap(),
            0
        );
        drop(storage);
        let _ = std::fs::remove_dir_all(dir);
    }
}
