use std::path::Path;

use rusqlite::{params, Connection, OpenFlags, OptionalExtension};

use super::{WorldDataEntry, WorldDataImportReport, WorldDataWorld};

/// Same tables, columns and triggers as VRCX's `VRCX-WorldData.db`, so a file
/// copied over from VRCX keeps working.
const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS worlds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id TEXT NOT NULL UNIQUE,
    connection_key TEXT NOT NULL,
    total_data_size INTEGER DEFAULT 0,
    allow_external_read INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    value_size INTEGER NOT NULL DEFAULT 0,
    last_accessed INTEGER DEFAULT (strftime('%s', 'now')),
    last_modified INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (world_id) REFERENCES worlds(world_id) ON DELETE CASCADE,
    UNIQUE (world_id, key)
);
CREATE TRIGGER IF NOT EXISTS data_update_trigger
AFTER UPDATE ON data
FOR EACH ROW
BEGIN
    UPDATE data SET last_modified = (strftime('%s', 'now')) WHERE id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS data_insert_trigger
AFTER INSERT ON data
FOR EACH ROW
BEGIN
    UPDATE data SET last_accessed = (strftime('%s', 'now')), last_modified = (strftime('%s', 'now')) WHERE id = NEW.id;
END;
";

/// VRCX's per-world cap on stored values.
pub(crate) const WORLD_DATA_SIZE_LIMIT: i64 = 10 * 1024 * 1024;
/// VRCX returns at most this many entries from `getall`.
const GET_ALL_LIMIT: i64 = 10_000;

pub(crate) struct WorldDataStore {
    conn: Connection,
}

pub(crate) type StoreResult<T> = Result<T, String>;

fn sql(error: rusqlite::Error) -> String {
    error.to_string()
}

impl WorldDataStore {
    pub(crate) fn open(path: &Path) -> StoreResult<Self> {
        Self::init(Connection::open(path).map_err(sql)?)
    }

    #[cfg(test)]
    pub(crate) fn open_in_memory() -> StoreResult<Self> {
        Self::init(Connection::open_in_memory().map_err(sql)?)
    }

    fn init(conn: Connection) -> StoreResult<Self> {
        conn.execute_batch(SCHEMA).map_err(sql)?;
        Ok(Self { conn })
    }

    pub(crate) fn world_by_connection_key(
        &self,
        connection_key: &str,
    ) -> StoreResult<Option<String>> {
        self.conn
            .query_row(
                "SELECT world_id FROM worlds WHERE connection_key = ?1 LIMIT 1",
                [connection_key],
                |row| row.get(0),
            )
            .optional()
            .map_err(sql)
    }

    /// Returns the world's connection key, creating the world with a new key
    /// the first time it is seen.
    pub(crate) fn ensure_world(&self, world_id: &str) -> StoreResult<String> {
        let existing: Option<String> = self
            .conn
            .query_row(
                "SELECT connection_key FROM worlds WHERE world_id = ?1",
                [world_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(sql)?;
        if let Some(key) = existing {
            return Ok(key);
        }
        let key = uuid::Uuid::new_v4().to_string();
        self.conn
            .execute(
                "INSERT INTO worlds (world_id, connection_key) VALUES (?1, ?2)",
                params![world_id, key],
            )
            .map_err(sql)?;
        Ok(key)
    }

    pub(crate) fn allow_external_read(&self, world_id: &str) -> StoreResult<bool> {
        Ok(self
            .conn
            .query_row(
                "SELECT allow_external_read FROM worlds WHERE world_id = ?1",
                [world_id],
                |row| row.get::<_, Option<i64>>(0),
            )
            .optional()
            .map_err(sql)?
            .flatten()
            .unwrap_or(0)
            != 0)
    }

    pub(crate) fn set_allow_external_read(&self, world_id: &str, allow: bool) -> StoreResult<()> {
        self.conn
            .execute(
                "UPDATE worlds SET allow_external_read = ?1 WHERE world_id = ?2",
                params![i64::from(allow), world_id],
            )
            .map_err(sql)?;
        Ok(())
    }

    pub(crate) fn get(&self, world_id: &str, key: &str) -> StoreResult<Option<String>> {
        self.conn
            .query_row(
                "SELECT value FROM data WHERE world_id = ?1 AND key = ?2",
                params![world_id, key],
                |row| row.get(0),
            )
            .optional()
            .map_err(sql)
    }

    pub(crate) fn get_all(&self, world_id: &str) -> StoreResult<Vec<(String, String)>> {
        let mut statement = self
            .conn
            .prepare("SELECT key, value FROM data WHERE world_id = ?1 ORDER BY id LIMIT ?2")
            .map_err(sql)?;
        let rows = statement
            .query_map(params![world_id, GET_ALL_LIMIT], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .map_err(sql)?;
        rows.collect::<Result<_, _>>().map_err(sql)
    }

    fn total_size(&self, world_id: &str) -> StoreResult<i64> {
        self.conn
            .query_row(
                "SELECT COALESCE(SUM(value_size), 0) FROM data WHERE world_id = ?1",
                [world_id],
                |row| row.get(0),
            )
            .map_err(sql)
    }

    fn entry_size(&self, world_id: &str, key: &str) -> StoreResult<i64> {
        Ok(self
            .conn
            .query_row(
                "SELECT value_size FROM data WHERE world_id = ?1 AND key = ?2",
                params![world_id, key],
                |row| row.get(0),
            )
            .optional()
            .map_err(sql)?
            .unwrap_or(0))
    }

    fn update_total_size(&self, world_id: &str) -> StoreResult<()> {
        let total = self.total_size(world_id)?;
        self.conn
            .execute(
                "UPDATE worlds SET total_data_size = ?1 WHERE world_id = ?2",
                params![total, world_id],
            )
            .map_err(sql)?;
        Ok(())
    }

    /// Stores a value, refusing it (with VRCX's message) when the world would
    /// go over its 10 MB cap.
    pub(crate) fn store(&self, world_id: &str, key: &str, value: &str) -> StoreResult<()> {
        let new_size = value.len() as i64;
        let old_total = self.total_size(world_id)?;
        let old_size = self.entry_size(world_id, key)?;
        let new_total = old_total - old_size + new_size;
        if new_total > WORLD_DATA_SIZE_LIMIT {
            return Err(format!(
                "You have hit the 10MB total data cap. The previous data entry was *not* stored. Your request was {new_size} bytes, your current shared byte total is {old_total} and you went over the table limit by {} bytes.",
                new_total - WORLD_DATA_SIZE_LIMIT
            ));
        }
        let updated = self
            .conn
            .execute(
                "UPDATE data SET value = ?1, value_size = ?2 WHERE world_id = ?3 AND key = ?4",
                params![value, new_size, world_id, key],
            )
            .map_err(sql)?;
        if updated == 0 {
            self.conn
                .execute(
                    "INSERT INTO data (world_id, key, value, value_size) VALUES (?1, ?2, ?3, ?4)",
                    params![world_id, key, value, new_size],
                )
                .map_err(sql)?;
        }
        self.update_total_size(world_id)
    }

    pub(crate) fn delete(&self, world_id: &str, key: &str) -> StoreResult<()> {
        self.conn
            .execute(
                "DELETE FROM data WHERE world_id = ?1 AND key = ?2",
                params![world_id, key],
            )
            .map_err(sql)?;
        self.update_total_size(world_id)
    }

    pub(crate) fn delete_all(&self, world_id: &str) -> StoreResult<()> {
        self.conn
            .execute("DELETE FROM data WHERE world_id = ?1", [world_id])
            .map_err(sql)?;
        self.update_total_size(world_id)
    }

    /// Removes the world itself, including its connection key; it gets a new
    /// key the next time it connects.
    pub(crate) fn forget_world(&self, world_id: &str) -> StoreResult<()> {
        self.conn
            .execute("DELETE FROM data WHERE world_id = ?1", [world_id])
            .map_err(sql)?;
        self.conn
            .execute("DELETE FROM worlds WHERE world_id = ?1", [world_id])
            .map_err(sql)?;
        Ok(())
    }

    /// Adds worlds and values from another world data file, such as VRCX's
    /// `VRCX-WorldData.db`, which is opened read-only. Values already here
    /// win, worlds keep their key unless another world here uses it, and the
    /// 10 MB cap per world still applies.
    pub(crate) fn import_from(&self, source: &Path) -> StoreResult<WorldDataImportReport> {
        let source = Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|_| "That file is not a database.".to_string())?;
        let has_tables: i64 = source
            .query_row(
                "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('worlds', 'data')",
                [],
                |row| row.get(0),
            )
            .map_err(|_| "That file is not a database.".to_string())?;
        if has_tables != 2 {
            return Err("That file does not contain VRCX world data.".into());
        }
        let worlds: Vec<(String, String, bool)> = {
            let mut statement = source
                .prepare(
                    "SELECT world_id, connection_key, COALESCE(allow_external_read, 0) FROM worlds",
                )
                .map_err(sql)?;
            let rows = statement
                .query_map([], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get::<_, i64>(2)? != 0))
                })
                .map_err(sql)?;
            rows.collect::<Result<_, _>>().map_err(sql)?
        };
        let entries: Vec<(String, String, String)> = {
            let mut statement = source
                .prepare("SELECT world_id, key, value FROM data ORDER BY id")
                .map_err(sql)?;
            let rows = statement
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                .map_err(sql)?;
            rows.collect::<Result<_, _>>().map_err(sql)?
        };

        self.conn.execute_batch("BEGIN IMMEDIATE").map_err(sql)?;
        let result = (|| {
            let mut report = WorldDataImportReport::default();
            for (world_id, connection_key, allow_external_read) in &worlds {
                let exists: bool = self
                    .conn
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM worlds WHERE world_id = ?1)",
                        [world_id],
                        |row| row.get(0),
                    )
                    .map_err(sql)?;
                if exists {
                    continue;
                }
                let key_taken = self.world_by_connection_key(connection_key)?.is_some();
                let key = if key_taken || uuid::Uuid::parse_str(connection_key).is_err() {
                    uuid::Uuid::new_v4().to_string()
                } else {
                    connection_key.clone()
                };
                self.conn
                    .execute(
                        "INSERT INTO worlds (world_id, connection_key, allow_external_read) VALUES (?1, ?2, ?3)",
                        params![world_id, key, i64::from(*allow_external_read)],
                    )
                    .map_err(sql)?;
                report.worlds_added += 1;
            }
            for (world_id, key, value) in &entries {
                self.ensure_world(world_id)?;
                if self.get(world_id, key)?.is_some() {
                    report.entries_skipped += 1;
                    continue;
                }
                let new_total = self.total_size(world_id)? + value.len() as i64;
                if new_total > WORLD_DATA_SIZE_LIMIT {
                    report.entries_skipped += 1;
                    continue;
                }
                self.conn
                    .execute(
                        "INSERT INTO data (world_id, key, value, value_size) VALUES (?1, ?2, ?3, ?4)",
                        params![world_id, key, value, value.len() as i64],
                    )
                    .map_err(sql)?;
                report.entries_added += 1;
            }
            let touched: std::collections::BTreeSet<&String> =
                entries.iter().map(|(world_id, _, _)| world_id).collect();
            for world_id in touched {
                self.update_total_size(world_id)?;
            }
            Ok(report)
        })();
        let end = if result.is_ok() { "COMMIT" } else { "ROLLBACK" };
        self.conn.execute_batch(end).map_err(sql)?;
        result
    }

    pub(crate) fn list_worlds(&self) -> StoreResult<Vec<WorldDataWorld>> {
        let mut statement = self
            .conn
            .prepare(
                "SELECT w.world_id, COALESCE(w.allow_external_read, 0),
                        COALESCE(SUM(d.value_size), 0), COUNT(d.id), MAX(d.last_modified)
                 FROM worlds w LEFT JOIN data d ON d.world_id = w.world_id
                 GROUP BY w.world_id
                 ORDER BY MAX(d.last_modified) IS NULL, MAX(d.last_modified) DESC, w.world_id",
            )
            .map_err(sql)?;
        let rows = statement
            .query_map([], |row| {
                Ok(WorldDataWorld {
                    world_id: row.get(0)?,
                    allow_external_read: row.get::<_, i64>(1)? != 0,
                    total_data_size: row.get(2)?,
                    entry_count: row.get(3)?,
                    last_modified: row.get(4)?,
                })
            })
            .map_err(sql)?;
        rows.collect::<Result<_, _>>().map_err(sql)
    }

    pub(crate) fn list_entries(&self, world_id: &str) -> StoreResult<Vec<WorldDataEntry>> {
        let mut statement = self
            .conn
            .prepare(
                "SELECT key, value, value_size, last_modified FROM data
                 WHERE world_id = ?1 ORDER BY key",
            )
            .map_err(sql)?;
        let rows = statement
            .query_map([world_id], |row| {
                Ok(WorldDataEntry {
                    key: row.get(0)?,
                    value: row.get(1)?,
                    value_size: row.get(2)?,
                    last_modified: row.get(3)?,
                })
            })
            .map_err(sql)?;
        rows.collect::<Result<_, _>>().map_err(sql)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worlds_keep_their_connection_key() {
        let store = WorldDataStore::open_in_memory().unwrap();
        let key = store.ensure_world("wrld_a").unwrap();
        assert!(uuid::Uuid::parse_str(&key).is_ok());
        assert_eq!(store.ensure_world("wrld_a").unwrap(), key);
        assert_ne!(store.ensure_world("wrld_b").unwrap(), key);
        assert_eq!(
            store.world_by_connection_key(&key).unwrap().as_deref(),
            Some("wrld_a")
        );
        assert_eq!(store.world_by_connection_key("missing").unwrap(), None);
    }

    #[test]
    fn store_replaces_values_and_tracks_size() {
        let store = WorldDataStore::open_in_memory().unwrap();
        store.ensure_world("wrld_a").unwrap();
        store.store("wrld_a", "score", "10").unwrap();
        store.store("wrld_a", "score", "12345").unwrap();
        store.store("wrld_a", "name", "abc").unwrap();
        assert_eq!(
            store.get("wrld_a", "score").unwrap().as_deref(),
            Some("12345")
        );
        assert_eq!(store.get_all("wrld_a").unwrap().len(), 2);
        let world = &store.list_worlds().unwrap()[0];
        assert_eq!(world.total_data_size, 8);
        assert_eq!(world.entry_count, 2);

        store.delete("wrld_a", "score").unwrap();
        assert_eq!(store.get("wrld_a", "score").unwrap(), None);
        store.delete_all("wrld_a").unwrap();
        assert!(store.get_all("wrld_a").unwrap().is_empty());
        assert_eq!(store.list_worlds().unwrap()[0].total_data_size, 0);
    }

    #[test]
    fn store_refuses_values_over_the_world_cap() {
        let store = WorldDataStore::open_in_memory().unwrap();
        store.ensure_world("wrld_a").unwrap();
        let big = "x".repeat(WORLD_DATA_SIZE_LIMIT as usize);
        store.store("wrld_a", "big", &big).unwrap();
        let error = store.store("wrld_a", "more", "y").unwrap_err();
        assert!(error.contains("10MB"));
        assert_eq!(store.get("wrld_a", "more").unwrap(), None);
        // Replacing the existing value with one of the same size still fits.
        store.store("wrld_a", "big", &big).unwrap();
    }

    #[test]
    fn external_reads_are_off_until_the_world_allows_them() {
        let store = WorldDataStore::open_in_memory().unwrap();
        store.ensure_world("wrld_a").unwrap();
        assert!(!store.allow_external_read("wrld_a").unwrap());
        store.set_allow_external_read("wrld_a", true).unwrap();
        assert!(store.allow_external_read("wrld_a").unwrap());
        assert!(!store.allow_external_read("wrld_missing").unwrap());
    }

    #[test]
    fn imports_vrcx_world_data_without_overwriting() {
        let dir = std::env::temp_dir().join(format!("vrcx-world-import-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let source_path = dir.join("VRCX-WorldData.db");
        let source = WorldDataStore::open(&source_path).unwrap();
        let old_key = source.ensure_world("wrld_old").unwrap();
        source.store("wrld_old", "score", "10").unwrap();
        source.set_allow_external_read("wrld_old", true).unwrap();
        source.ensure_world("wrld_both").unwrap();
        source.store("wrld_both", "kept", "theirs").unwrap();
        source.store("wrld_both", "added", "new").unwrap();
        drop(source);

        let store = WorldDataStore::open_in_memory().unwrap();
        let own_key = store.ensure_world("wrld_both").unwrap();
        store.store("wrld_both", "kept", "ours").unwrap();

        let report = store.import_from(&source_path).unwrap();
        assert_eq!(report.worlds_added, 1);
        assert_eq!(report.entries_added, 2);
        assert_eq!(report.entries_skipped, 1);
        assert_eq!(
            store.get("wrld_old", "score").unwrap().as_deref(),
            Some("10")
        );
        assert_eq!(store.ensure_world("wrld_old").unwrap(), old_key);
        assert!(store.allow_external_read("wrld_old").unwrap());
        assert_eq!(
            store.get("wrld_both", "kept").unwrap().as_deref(),
            Some("ours")
        );
        assert_eq!(
            store.get("wrld_both", "added").unwrap().as_deref(),
            Some("new")
        );
        assert_eq!(store.ensure_world("wrld_both").unwrap(), own_key);

        let again = store.import_from(&source_path).unwrap();
        assert_eq!(again.entries_added, 0);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn import_refuses_other_databases() {
        let dir = std::env::temp_dir().join(format!("vrcx-world-import-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("other.db");
        Connection::open(&path)
            .unwrap()
            .execute_batch("CREATE TABLE configs (key TEXT)")
            .unwrap();
        let store = WorldDataStore::open_in_memory().unwrap();
        assert!(store.import_from(&path).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn forgetting_a_world_removes_its_key_and_data() {
        let store = WorldDataStore::open_in_memory().unwrap();
        let key = store.ensure_world("wrld_a").unwrap();
        store.store("wrld_a", "k", "v").unwrap();
        store.forget_world("wrld_a").unwrap();
        assert_eq!(store.world_by_connection_key(&key).unwrap(), None);
        assert!(store.list_worlds().unwrap().is_empty());
    }
}
