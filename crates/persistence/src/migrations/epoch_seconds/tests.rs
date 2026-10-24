use serde_json::{json, Value};

use super::*;
use crate::database::DatabaseService;
use crate::migration::{run, NoopProgress};

struct TestDir {
    path: std::path::PathBuf,
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn test_db(name: &str) -> (TestDir, DatabaseService) {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!("vrcx0-epoch-{name}-{nonce}"));
    std::fs::create_dir_all(&path).unwrap();
    let db = DatabaseService::new(&path.join("test.sqlite3")).unwrap();
    (TestDir { path }, db)
}

fn exec(db: &DatabaseService, sql: &str) {
    db.execute_non_query(sql, &Default::default()).unwrap();
}

fn query(db: &DatabaseService, sql: &str) -> Vec<Vec<Value>> {
    db.execute(sql, &Default::default()).unwrap()
}

fn migrate(db: &DatabaseService) {
    run(db, &[migration()], &NoopProgress).unwrap();
}

const PREFIX: &str = "usr0123abcd";

/// 2026-07-21T10:30:15Z
const SECONDS: i64 = 1_784_629_815;

#[test]
fn text_dates_in_every_stored_form_become_integer_seconds() {
    let (_dir, db) = test_db("forms");
    exec(
        &db,
        &format!("CREATE TABLE {PREFIX}_feed_gps (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, location TEXT, time INTEGER)"),
    );
    for (id, value) in [
        (1, "'2026-07-21T10:30:15.250Z'"),
        (2, "'2026-07-21T05:30:15.123456789-05:00'"),
        (3, "'2026-07-21 10:30:15'"),
        (4, "'1784629815250'"),
        (5, "1784629815"),
        (6, "'2026-07-21T10:30:15+0000'"),
        (7, "''"),
        (8, "NULL"),
        (9, "'not a date'"),
    ] {
        exec(
            &db,
            &format!("INSERT INTO {PREFIX}_feed_gps (id, created_at, user_id, location, time) VALUES ({id}, {value}, 'usr_a', 'wrld_a:1', 4200)"),
        );
    }

    migrate(&db);

    let rows = query(
        &db,
        &format!(
            "SELECT id, created_at, typeof(created_at), time FROM {PREFIX}_feed_gps ORDER BY id"
        ),
    );
    let values: Vec<(i64, Value)> = rows
        .iter()
        .map(|row| (row[0].as_i64().unwrap(), row[1].clone()))
        .collect();
    assert_eq!(
        values,
        vec![
            (1, json!(SECONDS)),
            (2, json!(SECONDS)),
            (3, json!(SECONDS)),
            (4, json!(SECONDS)),
            (5, json!(SECONDS)),
            (6, json!(SECONDS)),
            (7, Value::Null),
            (8, Value::Null),
            (9, Value::Null),
        ]
    );
    for row in &rows[..6] {
        assert_eq!(row[2], json!("integer"));
        assert_eq!(row[3], json!(4200), "durations are left alone");
    }
    let declared = query(
        &db,
        &format!(
            "SELECT type FROM pragma_table_info('{PREFIX}_feed_gps') WHERE name = 'created_at'"
        ),
    );
    assert_eq!(declared[0][0], json!("INTEGER"));
}

#[test]
fn integers_stored_later_stay_integers() {
    let (_dir, db) = test_db("affinity");
    exec(
        &db,
        "CREATE TABLE memos (user_id TEXT PRIMARY KEY, edited_at TEXT, memo TEXT)",
    );
    migrate(&db);

    exec(
        &db,
        "INSERT INTO memos (user_id, edited_at, memo) VALUES ('usr_a', '1784629815', 'x')",
    );

    assert_eq!(
        query(&db, "SELECT typeof(edited_at) FROM memos")[0][0],
        json!("integer")
    );
}

#[test]
fn not_null_columns_with_empty_defaults_get_zero() {
    let (_dir, db) = test_db("not-null");
    exec(
        &db,
        "CREATE TABLE cache_file (id TEXT PRIMARY KEY, json TEXT, fetched_at TEXT NOT NULL DEFAULT '')",
    );
    exec(
        &db,
        "INSERT INTO cache_file (id, json, fetched_at) VALUES ('file_a', '{}', '')",
    );
    exec(
        &db,
        "INSERT INTO cache_file (id, json, fetched_at) VALUES ('file_b', '{}', 'garbage')",
    );
    exec(&db, "INSERT INTO cache_file (id, json, fetched_at) VALUES ('file_c', '{}', '2026-07-21T10:30:15Z')");

    migrate(&db);

    assert_eq!(
        query(&db, "SELECT id, fetched_at FROM cache_file ORDER BY id"),
        vec![
            vec![json!("file_a"), json!(0)],
            vec![json!("file_b"), json!(0)],
            vec![json!("file_c"), json!(SECONDS)],
        ]
    );
    exec(
        &db,
        "INSERT INTO cache_file (id, json) VALUES ('file_d', '{}')",
    );
    assert_eq!(
        query(&db, "SELECT fetched_at FROM cache_file WHERE id = 'file_d'")[0][0],
        json!(0)
    );
}

#[test]
fn millisecond_columns_are_renamed_and_their_indexes_follow() {
    let (_dir, db) = test_db("millis");
    exec(
        &db,
        "CREATE TABLE remote_sync_log (id INTEGER PRIMARY KEY, api_origin TEXT NOT NULL, account_id TEXT NOT NULL, vault_id TEXT NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL, first_seq INTEGER, last_seq INTEGER, created_at_ms INTEGER NOT NULL)",
    );
    exec(
        &db,
        "CREATE INDEX remote_sync_log_recent_idx ON remote_sync_log (api_origin, account_id, vault_id, created_at_ms DESC)",
    );
    exec(
        &db,
        "INSERT INTO remote_sync_log VALUES (1, 'o', 'a', 'v', 'push', 'ok', NULL, NULL, 1784629815250)",
    );
    exec(
        &db,
        "INSERT INTO remote_sync_log VALUES (2, 'o', 'a', 'v', 'push', 'old', NULL, NULL, -1)",
    );

    migrate(&db);

    assert_eq!(
        query(
            &db,
            "SELECT id, created_at FROM remote_sync_log ORDER BY id"
        ),
        vec![vec![json!(1), json!(SECONDS)], vec![json!(2), json!(-1)]]
    );
    let columns: Vec<Value> = query(&db, "SELECT name FROM pragma_table_info('remote_sync_log')")
        .into_iter()
        .map(|row| row[0].clone())
        .collect();
    assert!(columns.contains(&json!("created_at")));
    assert!(!columns.contains(&json!("created_at_ms")));
    let index = query(
        &db,
        "SELECT sql FROM sqlite_master WHERE name = 'remote_sync_log_recent_idx'",
    );
    assert!(index[0][0].as_str().unwrap().contains("created_at DESC"));
}

#[test]
fn negative_millisecond_values_round_down() {
    let (_dir, db) = test_db("negative");
    exec(
        &db,
        "CREATE TABLE remote_sync_tombstone (stream TEXT NOT NULL, owner_id INTEGER NOT NULL DEFAULT 0, row_key TEXT NOT NULL, deleted_at_ms INTEGER NOT NULL, PRIMARY KEY (stream, owner_id, row_key))",
    );
    exec(
        &db,
        "INSERT INTO remote_sync_tombstone VALUES ('memos', 0, '[\"a\"]', -100000001500)",
    );

    migrate(&db);

    assert_eq!(
        query(&db, "SELECT deleted_at FROM remote_sync_tombstone")[0][0],
        json!(-100000002)
    );
}

#[test]
fn managed_triggers_are_dropped_and_other_triggers_survive() {
    let (_dir, db) = test_db("triggers");
    exec(
        &db,
        "CREATE TABLE memos (user_id TEXT PRIMARY KEY, edited_at TEXT, memo TEXT)",
    );
    exec(
        &db,
        "CREATE TABLE remote_sync_tombstone (stream TEXT NOT NULL, owner_id INTEGER NOT NULL DEFAULT 0, row_key TEXT NOT NULL, deleted_at_ms INTEGER NOT NULL, PRIMARY KEY (stream, owner_id, row_key))",
    );
    exec(
        &db,
        "CREATE TRIGGER \"remote_sync_deleted_memos\" AFTER DELETE ON \"memos\" BEGIN INSERT OR REPLACE INTO remote_sync_tombstone (stream, owner_id, row_key, deleted_at_ms) VALUES ('memos', 0, json_array(OLD.\"user_id\"), CAST(strftime('%s', 'now') AS INTEGER) * 1000); END",
    );
    exec(&db, "CREATE TABLE memo_audit (user_id TEXT)");
    exec(
        &db,
        "CREATE TRIGGER memo_audit_insert AFTER INSERT ON memos BEGIN INSERT INTO memo_audit VALUES (NEW.user_id); END",
    );

    migrate(&db);

    let triggers: Vec<Value> = query(
        &db,
        "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name",
    )
    .into_iter()
    .map(|row| row[0].clone())
    .collect();
    assert_eq!(triggers, vec![json!("memo_audit_insert")]);
    exec(&db, "INSERT INTO memos VALUES ('usr_a', '1784629815', 'x')");
    exec(&db, "DELETE FROM memos");
    assert_eq!(
        query(&db, "SELECT count(*) FROM memo_audit")[0][0],
        json!(1)
    );
}

#[test]
fn derived_activity_caches_are_cleared_for_a_rebuild() {
    let (_dir, db) = test_db("activity");
    exec(
        &db,
        &format!("CREATE TABLE {PREFIX}_activity_sessions_v2 (user_id TEXT NOT NULL, start_at INTEGER NOT NULL, end_at INTEGER NOT NULL, is_open_tail INTEGER NOT NULL DEFAULT 0, source_revision TEXT NOT NULL DEFAULT '', PRIMARY KEY (user_id, start_at))"),
    );
    exec(
        &db,
        &format!("INSERT INTO {PREFIX}_activity_sessions_v2 VALUES ('usr_a', 1784629815000, 1784629915000, 0, '2026-07-21T10:30:15.000Z')"),
    );

    migrate(&db);

    assert_eq!(
        query(
            &db,
            &format!("SELECT count(*) FROM {PREFIX}_activity_sessions_v2")
        )[0][0],
        json!(0)
    );
    let declared = query(
        &db,
        &format!("SELECT type FROM pragma_table_info('{PREFIX}_activity_sessions_v2') WHERE name = 'start_at'"),
    );
    assert_eq!(declared[0][0], json!("INTEGER"));
}

#[test]
fn missing_tables_and_columns_are_skipped() {
    let (_dir, db) = test_db("missing");
    exec(
        &db,
        "CREATE TABLE favorite_world (id INTEGER PRIMARY KEY, world_id TEXT)",
    );

    migrate(&db);

    assert_eq!(
        query(
            &db,
            "SELECT name FROM pragma_table_info('favorite_world') ORDER BY cid"
        ),
        vec![vec![json!("id")], vec![json!("world_id")]]
    );
}

#[test]
fn whole_identifier_replacement_leaves_longer_names_alone() {
    assert_eq!(
        replace_identifier(
            "ON t (created_at_ms, created_at_ms2, xcreated_at_ms)",
            "created_at_ms",
            "created_at"
        ),
        "ON t (created_at, created_at_ms2, xcreated_at_ms)"
    );
}

#[test]
fn staged_definitions_keep_constraints_and_quoting() {
    let sql = staged_create_sql(
        "CREATE TABLE \"x\" (id INTEGER PRIMARY KEY, \"edited_at\" DATETIME NOT NULL DEFAULT '' , note TEXT, UNIQUE (id, note))",
        "x__epoch_seconds",
        &[("edited_at", "edited_at", true)],
    )
    .unwrap();
    assert_eq!(
        sql,
        "CREATE TABLE \"x__epoch_seconds\" (id INTEGER PRIMARY KEY, \"edited_at\" INTEGER NOT NULL DEFAULT 0, note TEXT, UNIQUE (id, note))"
    );
}

#[test]
fn every_listed_table_is_registered_once() {
    let mut names: Vec<&str> = GLOBAL_TABLES
        .iter()
        .chain(PER_USER_TABLES.iter())
        .map(|(name, _)| *name)
        .collect();
    let total = names.len();
    names.sort_unstable();
    names.dedup();
    assert_eq!(names.len(), total);
}

#[test]
fn rows_that_differ_only_below_a_second_keep_their_ids_and_events() {
    let (_dir, db) = test_db("unique");
    exec(
        &db,
        "CREATE TABLE \"gamelog_join_leave\" ( \"id\" integer PRIMARY KEY, \"created_at\" text, \"type\" text, \"display_name\" text, \"location\" text, \"user_id\" text, \"time\" integer, \"owner_id\" integer NOT NULL DEFAULT 0, UNIQUE (\"created_at\", \"type\", \"display_name\") )",
    );
    for (id, at, kind) in [
        (1, "2026-07-21T10:30:15.100Z", "OnPlayerJoined"),
        (2, "2026-07-21T10:30:15.900Z", "OnPlayerJoined"),
        (3, "2026-07-21T10:30:15.900Z", "OnPlayerLeft"),
    ] {
        exec(
            &db,
            &format!("INSERT INTO gamelog_join_leave (id, created_at, type, display_name) VALUES ({id}, '{at}', '{kind}', 'Ada')"),
        );
    }

    migrate(&db);

    assert_eq!(
        query(
            &db,
            "SELECT id, created_at, type FROM gamelog_join_leave ORDER BY id"
        ),
        vec![
            vec![json!(1), json!(SECONDS), json!("OnPlayerJoined")],
            vec![json!(2), json!(SECONDS), json!("OnPlayerJoined")],
            vec![json!(3), json!(SECONDS), json!("OnPlayerLeft")],
        ]
    );
}

#[test]
fn date_settings_become_seconds_and_other_settings_stay() {
    let (_dir, db) = test_db("settings");
    exec(
        &db,
        "CREATE TABLE configs (key TEXT PRIMARY KEY, value TEXT)",
    );
    exec(
        &db,
        &format!("CREATE TABLE {PREFIX}_remote_sync_app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    );
    for (key, value) in [
        (
            "config:vrcx_vrchatregistrylastbackupdate",
            "2026-07-21T10:30:15.250Z",
        ),
        ("config:vrcx_lastgameofflineat", "1784629815250"),
        (
            "config:vrcx_lastavatarcleanupdate_usr_a",
            "2026-07-21T10:30:15Z",
        ),
        ("config:vrcx_vrchatregistrylastrestorecheck", "garbage"),
        ("config:vrcx_dtdateformat", "time-mdy"),
        ("config:vrcx_gamelogsessionsdatefrom", "2026-07-21"),
    ] {
        exec(
            &db,
            &format!("INSERT INTO configs VALUES ('{key}', '{value}')"),
        );
    }
    exec(
        &db,
        &format!("INSERT INTO {PREFIX}_remote_sync_app_settings VALUES ('config:vrcx_lastavatarcleanupdate_usr_a', '2026-07-21T10:30:15Z', '2026-07-21T10:30:15Z')"),
    );

    migrate(&db);

    assert_eq!(
        query(&db, "SELECT key, value FROM configs ORDER BY key"),
        vec![
            vec![json!("config:vrcx_dtdateformat"), json!("time-mdy")],
            vec![
                json!("config:vrcx_gamelogsessionsdatefrom"),
                json!("2026-07-21")
            ],
            vec![
                json!("config:vrcx_lastavatarcleanupdate_usr_a"),
                json!(SECONDS.to_string())
            ],
            vec![
                json!("config:vrcx_lastgameofflineat"),
                json!(SECONDS.to_string())
            ],
            vec![
                json!("config:vrcx_vrchatregistrylastbackupdate"),
                json!(SECONDS.to_string())
            ],
            vec![
                json!("config:vrcx_vrchatregistrylastrestorecheck"),
                json!("garbage")
            ],
        ]
    );
    assert_eq!(
        query(
            &db,
            &format!("SELECT value, updated_at FROM {PREFIX}_remote_sync_app_settings")
        ),
        vec![vec![json!(SECONDS.to_string()), json!(SECONDS)]]
    );
}

#[test]
fn explicitly_millisecond_columns_convert_early_and_negative_instants() {
    let (_dir, db) = test_db("early-millis");
    exec(
        &db,
        "CREATE TABLE remote_sync_log (id INTEGER PRIMARY KEY, created_at_ms INTEGER NOT NULL)",
    );
    exec(
        &db,
        "INSERT INTO remote_sync_log VALUES (1, 1000), (2, -1001), (3, -9223372036854775808)",
    );
    migrate(&db);
    assert_eq!(
        query(&db, "SELECT created_at FROM remote_sync_log ORDER BY id"),
        vec![
            vec![json!(1)],
            vec![json!(-2)],
            vec![json!(-9223372036854776_i64)]
        ]
    );
}

#[test]
fn stored_json_dates_convert_without_changing_messages_or_calendar_labels() {
    let old = json!([{"createdAt": "2026-07-21T10:30:15.250Z", "trigger": {"at": "2026-07-21T11:30:15Z", "repeatMinutes": 60}, "message": "2026-07-21T10:30:15Z", "day": "2026-07-21"}]);
    let converted: Value = serde_json::from_str(&convert_setting_text(
        "config:vrcx_assistantreminders",
        &old.to_string(),
    ))
    .unwrap();
    assert_eq!(converted[0]["createdAt"], SECONDS);
    assert_eq!(converted[0]["trigger"]["at"], SECONDS + 3600);
    assert_eq!(converted[0]["trigger"]["repeatMinutes"], 60);
    assert_eq!(converted[0]["message"], old[0]["message"]);
    assert_eq!(converted[0]["day"], old[0]["day"]);
    assert_eq!(
        convert_setting_text("unrelated", &old.to_string()),
        old.to_string()
    );
}

#[test]
fn nanosecond_text_is_truncated_without_rounding_into_the_next_second() {
    let (_dir, db) = test_db("nanosecond-floor");
    exec(&db, "CREATE TABLE gamelog_event (id INTEGER PRIMARY KEY, created_at TEXT, data TEXT, UNIQUE(created_at, data))");
    exec(&db, "INSERT INTO gamelog_event VALUES (1, '2026-07-21T10:30:15.999999999Z', 'same'), (2, '2026-07-21T10:30:15.900+0000', 'same'), (3, '2026-07-21T10:30:15.999999+0000', 'same'), (4, '1969-12-31T23:59:59.999999Z', 'before epoch')");
    migrate(&db);
    assert_eq!(
        query(&db, "SELECT id, created_at FROM gamelog_event ORDER BY id"),
        vec![
            vec![json!(1), json!(SECONDS)],
            vec![json!(2), json!(SECONDS)],
            vec![json!(3), json!(SECONDS)],
            vec![json!(4), json!(-1)]
        ]
    );
}

#[test]
fn stored_replay_checkpoint_converts_dates_and_keeps_file_identity_and_durations() {
    let old = serde_json::json!({
        "cursor": { "file_created_at": 1784629815250000000_u64, "cutoff": "2026-07-21T10:30:15.250Z", "context": { "file_created_at": 1784629815250000000_u64 } },
        "state": { "current_location_started_at": "2026-07-21T10:30:15.250Z", "current_location_started_at_ms": 1784629815250_i64, "players_by_key": { "a": { "joinTimeMs": 1784629815250_i64, "timeMs": 2500 } } }
    });
    let converted = super::convert_setting_text("gameLogReplayCheckpoint", &old.to_string());
    let value: serde_json::Value = serde_json::from_str(&converted).unwrap();
    assert_eq!(value["cursor"]["file_created_at_seconds"], 1784629815);
    assert_eq!(value["cursor"]["file_creation_fraction"], 250000000);
    assert_eq!(
        value["cursor"]["context"]["file_created_at_seconds"],
        1784629815
    );
    assert_eq!(value["cursor"]["cutoff"], 1784629815);
    assert!(value["state"]
        .get("current_location_started_at_ms")
        .is_none());
    assert_eq!(
        value["state"]["players_by_key"]["a"]["joinTime"],
        1784629815
    );
    assert_eq!(value["state"]["players_by_key"]["a"]["timeMs"], 2500);
    assert_eq!(
        super::convert_setting_text("gameLogReplayCheckpoint", &converted),
        converted
    );
}
