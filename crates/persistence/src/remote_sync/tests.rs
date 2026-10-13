use std::collections::BTreeMap;

use serde_json::{json, Value};

use crate::realtime::normalize_user_table_prefix;

use super::streams::{
    export_rows, export_state, import_chunk, state_spec, stream_spec, synced_columns, ImportSource,
    StreamScope, ROW_STREAMS, STATE_STREAMS,
};
use super::*;

const USER: &str = "usr_12345678-1234-1234-1234-1234567890ab";

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
    let path = std::env::temp_dir().join(format!(
        "vrcx-0-remote-sync-{name}-{}-{nonce}",
        std::process::id()
    ));
    std::fs::create_dir_all(&path).unwrap();
    let db = DatabaseService::new(&path.join("VRCX-0.sqlite3")).unwrap();
    (TestDir { path }, db)
}

fn vault() -> VaultRef {
    VaultRef {
        api_origin: "https://sync.example".into(),
        account_id: "acc_test".into(),
        vault_id: "vault".into(),
    }
}

fn setup(name: &str) -> (TestDir, DatabaseService, StreamScope) {
    let (dir, db) = test_db(name);
    let scope = StreamScope::open(&db, USER).unwrap();
    vault_state_save(
        &db,
        &VaultState {
            vault: vault(),
            vrchat_user_id: USER.into(),
            source_id: "this-pc".into(),
            pull_cursor: 0,
            highest_manifest_seq: 1,
            push_source_seq: 0,
        },
    )
    .unwrap();
    (dir, db, scope)
}

fn status_row(created_at: &str, status: &str) -> Value {
    json!({
        "created_at": created_at,
        "user_id": "usr_friend",
        "display_name": "Friend",
        "status": status,
        "status_description": "",
        "previous_status": "",
        "previous_status_description": "",
    })
}

fn chunk(stream: &str, rows: Vec<Value>) -> BTreeMap<String, Vec<Value>> {
    BTreeMap::from([(stream.to_owned(), rows)])
}

fn source<'a>(
    vault: &'a VaultRef,
    source_id: &'a str,
    source_seq: u64,
    server_seq: u64,
) -> ImportSource<'a> {
    ImportSource {
        vault,
        source_id,
        source_seq,
        server_seq,
        snapshot_from: None,
    }
}

fn snapshot<'a>(
    vault: &'a VaultRef,
    source_id: &'a str,
    source_seq: u64,
    snapshot_from: u64,
) -> ImportSource<'a> {
    ImportSource {
        snapshot_from: Some(snapshot_from),
        ..source(vault, source_id, source_seq, source_seq)
    }
}

fn count(db: &DatabaseService, table: &str) -> i64 {
    db.execute(
        &format!("SELECT COUNT(*) FROM {table}"),
        &Default::default(),
    )
    .unwrap()
    .first()
    .map(|row| row_i64(row, 0))
    .unwrap()
}

fn export(db: &DatabaseService, scope: &StreamScope, stream: &str) -> Vec<(i64, Value)> {
    export_rows(db, scope, stream_spec(stream).unwrap(), 0, 100).unwrap()
}

#[test]
fn every_stream_maps_to_a_table_with_its_key_and_time_columns() {
    let (_dir, db, scope) = setup("mapping");
    for spec in ROW_STREAMS {
        let table = scope.table_name(spec);
        let columns = synced_columns(&db, &table, spec).unwrap();
        assert!(!columns.is_empty(), "{table} has no synced columns");
        for column in spec.key.iter().chain([&spec.time]) {
            assert!(
                columns.iter().any(|name| name == column),
                "{table} is missing {column}"
            );
        }
        assert!(
            !columns.iter().any(|name| name == "id"),
            "{table} syncs its row id"
        );
    }
    // feed_avatar.owner_id is the avatar author and must travel; the game log
    // owner_id is a local dictionary id and must not.
    let avatar = stream_spec("feed_avatar").unwrap();
    assert!(synced_columns(&db, &scope.table_name(avatar), avatar)
        .unwrap()
        .contains(&"owner_id".to_owned()));
    let location = stream_spec("gamelog_location").unwrap();
    assert!(!synced_columns(&db, "gamelog_location", location)
        .unwrap()
        .contains(&"owner_id".to_owned()));
}

#[test]
fn the_same_event_from_two_recorders_is_kept_once() {
    let (_dir, db, scope) = setup("dedupe");
    let vault = vault();
    let table = scope.table_name(stream_spec("feed_status").unwrap());

    let first = import_chunk(
        &db,
        &scope,
        source(&vault, "pc-a", 1, 1),
        &chunk(
            "feed_status",
            vec![status_row("2026-10-10T12:00:00.000Z", "busy")],
        ),
    )
    .unwrap();
    assert_eq!((first.inserted, first.matched), (1, 0));

    // Another recorder saw it four seconds later.
    let second = import_chunk(
        &db,
        &scope,
        source(&vault, "collector", 1, 2),
        &chunk(
            "feed_status",
            vec![status_row("2026-10-10T12:00:04.250Z", "busy")],
        ),
    )
    .unwrap();
    assert_eq!((second.inserted, second.matched), (0, 1));

    // Outside the slack, or with a different status, it is a new event.
    let third = import_chunk(
        &db,
        &scope,
        source(&vault, "collector", 2, 3),
        &chunk(
            "feed_status",
            vec![
                status_row("2026-10-10T12:00:30.000Z", "busy"),
                status_row("2026-10-10T12:00:01.000Z", "active"),
            ],
        ),
    )
    .unwrap();
    assert_eq!((third.inserted, third.matched), (2, 0));
    assert_eq!(count(&db, &table), 3);
    assert_eq!(
        vault_state_get(&db, &vault).unwrap().unwrap().pull_cursor,
        3
    );
}

fn friend_log_row(created_at: &str, kind: &str, from: &str, to: &str) -> Value {
    let (display, previous_display, trust, previous_trust) = match kind {
        "DisplayName" => (to, from, "Known User", ""),
        "TrustLevel" => ("Friend", "", to, from),
        _ => ("Friend", "", "Known User", ""),
    };
    json!({
        "created_at": created_at,
        "type": kind,
        "user_id": "usr_friend",
        "display_name": display,
        "previous_display_name": previous_display,
        "trust_level": trust,
        "previous_trust_level": previous_trust,
        "friend_number": 0,
    })
}

fn record_friend_log(db: &DatabaseService, row: &Value) {
    // The row uses the column names, the input their camelCase form.
    let entry = json!({
        "createdAt": row["created_at"],
        "type": row["type"],
        "userId": row["user_id"],
        "displayName": row["display_name"],
        "previousDisplayName": row["previous_display_name"],
        "trustLevel": row["trust_level"],
        "previousTrustLevel": row["previous_trust_level"],
    });
    let written = crate::friends::friend_log_history_add(
        db,
        USER.into(),
        vec![serde_json::from_value(entry).unwrap()],
    )
    .unwrap();
    assert_eq!(written, 1);
}

fn friend_log_times(db: &DatabaseService, scope: &StreamScope) -> Vec<(String, String)> {
    let table = scope.table_name(stream_spec("friend_log_history").unwrap());
    db.execute(
        &format!("SELECT created_at, type FROM {table} ORDER BY created_at"),
        &Default::default(),
    )
    .unwrap()
    .iter()
    .map(|row| (row_string(row, 0), row_string(row, 1)))
    .collect()
}

#[test]
fn a_friend_log_change_noticed_later_by_the_collector_keeps_only_this_pcs_row() {
    let (_dir, db, scope) = setup("friend-log-local-first");
    let vault = vault();
    record_friend_log(
        &db,
        &friend_log_row(
            "2026-10-10T08:21:03.000Z",
            "TrustLevel",
            "Known User",
            "Trusted User",
        ),
    );
    record_friend_log(
        &db,
        &friend_log_row("2026-10-10T01:45:00.000Z", "DisplayName", "Cosmo", "Ash"),
    );
    record_friend_log(
        &db,
        &friend_log_row("2026-10-10T11:42:54.000Z", "Friend", "", ""),
    );

    // The collector noticed each of them at another time, up to hours away.
    let report = import_chunk(
        &db,
        &scope,
        source(&vault, "collector", 1, 1),
        &chunk(
            "friend_log_history",
            vec![
                friend_log_row(
                    "2026-10-10T08:16:59.000Z",
                    "TrustLevel",
                    "Known User",
                    "Trusted User",
                ),
                friend_log_row("2026-10-10T00:34:03.000Z", "DisplayName", "Cosmo", "Ash"),
                friend_log_row("2026-10-10T11:42:42.000Z", "Friend", "", ""),
            ],
        ),
    )
    .unwrap();
    assert_eq!((report.inserted, report.matched), (0, 3));
    assert_eq!(
        friend_log_times(&db, &scope),
        vec![
            (
                "2026-10-10T01:45:00.000Z".to_owned(),
                "DisplayName".to_owned()
            ),
            (
                "2026-10-10T08:21:03.000Z".to_owned(),
                "TrustLevel".to_owned()
            ),
            ("2026-10-10T11:42:54.000Z".to_owned(), "Friend".to_owned()),
        ]
    );
    // This PC's rows are still its own and are uploaded.
    assert_eq!(export(&db, &scope, "friend_log_history").len(), 3);
}

#[test]
fn this_pcs_friend_log_row_replaces_the_collectors_earlier_copy() {
    let (_dir, db, scope) = setup("friend-log-sync-first");
    let vault = vault();
    import_chunk(
        &db,
        &scope,
        source(&vault, "collector", 1, 1),
        &chunk(
            "friend_log_history",
            vec![
                friend_log_row(
                    "2026-10-10T08:16:59.000Z",
                    "TrustLevel",
                    "Known User",
                    "Trusted User",
                ),
                friend_log_row("2026-10-09T08:00:00.000Z", "DisplayName", "Old", "Cosmo"),
            ],
        ),
    )
    .unwrap();
    record_friend_log(
        &db,
        &friend_log_row(
            "2026-10-10T08:21:03.000Z",
            "TrustLevel",
            "Known User",
            "Trusted User",
        ),
    );

    // The rename this PC never recorded stays as the collector logged it.
    assert_eq!(
        friend_log_times(&db, &scope),
        vec![
            (
                "2026-10-09T08:00:00.000Z".to_owned(),
                "DisplayName".to_owned()
            ),
            (
                "2026-10-10T08:21:03.000Z".to_owned(),
                "TrustLevel".to_owned()
            ),
        ]
    );
    let exported = export(&db, &scope, "friend_log_history");
    assert_eq!(exported.len(), 1);
    assert_eq!(exported[0].1["created_at"], "2026-10-10T08:21:03.000Z");
}

#[test]
fn a_friend_log_change_that_really_happened_again_is_kept() {
    let (_dir, db, scope) = setup("friend-log-repeat");
    let vault = vault();
    record_friend_log(
        &db,
        &friend_log_row("2026-10-10T01:00:00.000Z", "DisplayName", "Cosmo", "Ash"),
    );
    record_friend_log(
        &db,
        &friend_log_row("2026-10-01T00:00:00.000Z", "Friend", "", ""),
    );
    record_friend_log(
        &db,
        &friend_log_row(
            "2026-08-01T00:00:00.000Z",
            "TrustLevel",
            "Known User",
            "Trusted User",
        ),
    );

    let report = import_chunk(
        &db,
        &scope,
        source(&vault, "collector", 1, 1),
        &chunk(
            "friend_log_history",
            vec![
                // Renamed back and then to the same name again.
                friend_log_row("2026-10-10T05:00:00.000Z", "DisplayName", "Ash", "Cosmo"),
                friend_log_row("2026-10-10T09:00:00.000Z", "DisplayName", "Cosmo", "Ash"),
                // Unfriended and added again.
                friend_log_row("2026-10-03T00:00:00.000Z", "Unfriend", "", ""),
                friend_log_row("2026-10-05T00:00:00.000Z", "Friend", "", ""),
                // The same step, but far too long ago to be the same event.
                friend_log_row(
                    "2026-10-10T00:00:00.000Z",
                    "TrustLevel",
                    "Known User",
                    "Trusted User",
                ),
                // Another change of the same kind is its own event.
                friend_log_row(
                    "2026-10-10T00:05:00.000Z",
                    "TrustLevel",
                    "Trusted User",
                    "Veteran User",
                ),
            ],
        ),
    )
    .unwrap();
    assert_eq!((report.inserted, report.matched), (6, 0));
    assert_eq!(friend_log_times(&db, &scope).len(), 9);
}

#[test]
fn friend_log_copies_stored_before_are_removed_when_the_account_is_opened() {
    let (_dir, db, scope) = setup("friend-log-cleanup");
    let table = scope.table_name(stream_spec("friend_log_history").unwrap());
    record_friend_log(
        &db,
        &friend_log_row("2026-10-10T11:42:54.000Z", "Friend", "", ""),
    );
    record_friend_log(
        &db,
        &friend_log_row(
            "2026-10-10T12:00:00.000Z",
            "TrustLevel",
            "Known User",
            "Trusted User",
        ),
    );
    // Two rows as an older build left them: one imported copy, and one
    // identical pair this PC recorded itself.
    for (created_at, kind, synced) in [
        ("2026-10-10T11:42:42.000Z", "Friend", true),
        ("2026-10-10T12:04:00.000Z", "TrustLevel", false),
    ] {
        let (previous, trust) = match kind {
            "TrustLevel" => ("Known User", "Trusted User"),
            _ => ("", "Known User"),
        };
        db.execute_non_query(
            &format!("INSERT INTO {table} (created_at, type, user_id, display_name, previous_display_name, trust_level, previous_trust_level, friend_number) VALUES (@created_at, @type, 'usr_friend', 'Friend', '', @trust, @previous, 0)"),
            &ParamsBuilder::new()
                .set("created_at", created_at)
                .set("type", kind)
                .set("trust", trust)
                .set("previous", previous)
                .build(),
        )
        .unwrap();
        if synced {
            db.execute_non_query(
                &format!("INSERT INTO remote_sync_provenance (stream, local_rowid, source_id, source_seq) SELECT @stream, MAX(rowid), 'collector', 1 FROM {table}"),
                &ParamsBuilder::new().set("stream", table.clone()).build(),
            )
            .unwrap();
        }
    }
    assert_eq!(count(&db, &table), 4);

    StreamScope::open(&db, USER).unwrap();

    // Only the imported copy goes; rows this PC recorded are never removed.
    assert_eq!(
        friend_log_times(&db, &scope),
        vec![
            ("2026-10-10T11:42:54.000Z".to_owned(), "Friend".to_owned()),
            (
                "2026-10-10T12:00:00.000Z".to_owned(),
                "TrustLevel".to_owned()
            ),
            (
                "2026-10-10T12:04:00.000Z".to_owned(),
                "TrustLevel".to_owned()
            ),
        ]
    );
    assert_eq!(count(&db, "remote_sync_provenance"), 0);
}

fn status_times(db: &DatabaseService, scope: &StreamScope) -> Vec<(String, String)> {
    let table = scope.table_name(stream_spec("feed_status").unwrap());
    db.execute(
        &format!("SELECT created_at, status FROM {table} ORDER BY created_at"),
        &Default::default(),
    )
    .unwrap()
    .iter()
    .map(|row| (row_string(row, 0), row_string(row, 1)))
    .collect()
}

fn record_status(db: &DatabaseService, scope: &StreamScope, created_at: &str, status: &str) {
    let table = scope.table_name(stream_spec("feed_status").unwrap());
    db.write_transaction(|tx| {
        tx.execute_non_query(
            &format!("INSERT INTO {table} (created_at, user_id, display_name, status, status_description, previous_status, previous_status_description) VALUES (@created_at, 'usr_friend', 'Friend', @status, '', '', '')"),
            &ParamsBuilder::new()
                .set("created_at", created_at)
                .set("status", status)
                .build(),
        )?;
        crate::realtime::drop_synced_copies_near(
            tx,
            &normalize_user_table_prefix(USER)?,
            "feed_status",
            "usr_friend",
            created_at,
        )
    })
    .unwrap();
}

#[test]
fn a_feed_change_one_recorder_noticed_minutes_late_keeps_this_pcs_row() {
    let (_dir, db, scope) = setup("feed-late");
    let vault = vault();
    let times = |rows: &[(&str, &str)]| -> Vec<(String, String)> {
        rows.iter()
            .map(|(at, status)| ((*at).to_owned(), (*status).to_owned()))
            .collect()
    };

    // This PC first, the collector's copy four minutes later.
    record_status(&db, &scope, "2026-10-10T12:00:00.000Z", "busy");
    let report = import_chunk(
        &db,
        &scope,
        source(&vault, "collector", 1, 1),
        &chunk(
            "feed_status",
            vec![
                status_row("2026-10-10T12:04:00.000Z", "busy"),
                status_row("2026-10-10T13:00:00.000Z", "ask me"),
            ],
        ),
    )
    .unwrap();
    assert_eq!((report.inserted, report.matched), (1, 1));

    // The collector first, this PC four minutes later.
    record_status(&db, &scope, "2026-10-10T13:04:00.000Z", "ask me");
    assert_eq!(
        status_times(&db, &scope),
        times(&[
            ("2026-10-10T12:00:00.000Z", "busy"),
            ("2026-10-10T13:04:00.000Z", "ask me"),
        ])
    );

    // Back to the same status after another one, or the same status much
    // later, is a new event.
    let report = import_chunk(
        &db,
        &scope,
        source(&vault, "collector", 2, 2),
        &chunk(
            "feed_status",
            vec![
                status_row("2026-10-10T13:05:00.000Z", "busy"),
                status_row("2026-10-10T13:06:00.000Z", "ask me"),
                status_row("2026-10-10T14:00:00.000Z", "ask me"),
            ],
        ),
    )
    .unwrap();
    assert_eq!((report.inserted, report.matched), (3, 0));
    assert_eq!(status_times(&db, &scope).len(), 5);
}

#[test]
fn one_source_repeating_an_event_keeps_both_rows() {
    let (_dir, db, scope) = setup("same-source");
    let vault = vault();
    let report = import_chunk(
        &db,
        &scope,
        source(&vault, "pc-a", 1, 1),
        &chunk(
            "feed_status",
            vec![
                status_row("2026-10-10T12:00:00.000Z", "busy"),
                status_row("2026-10-10T12:00:03.000Z", "busy"),
            ],
        ),
    )
    .unwrap();
    assert_eq!((report.inserted, report.matched), (2, 0));
}

#[test]
fn a_replacement_snapshot_adds_nothing_this_pc_already_has() {
    let (_dir, db, scope) = setup("snapshot-known");
    let vault = vault();
    let table = scope.table_name(stream_spec("feed_status").unwrap());
    // One source reported the same status twice, three seconds apart.
    let rows = vec![
        status_row("2026-10-10T12:00:00.000Z", "busy"),
        status_row("2026-10-10T12:00:03.000Z", "busy"),
    ];
    import_chunk(
        &db,
        &scope,
        source(&vault, "pc-a", 1, 1),
        &chunk("feed_status", rows.clone()),
    )
    .unwrap();
    assert_eq!(count(&db, &table), 2);

    // The same source then replaces its history with a snapshot holding
    // those rows, split over two chunks.
    let first = import_chunk(
        &db,
        &scope,
        snapshot(&vault, "pc-a", 9, 9),
        &chunk("feed_status", vec![rows[0].clone()]),
    )
    .unwrap();
    let second = import_chunk(
        &db,
        &scope,
        snapshot(&vault, "pc-a", 10, 9),
        &chunk("feed_status", vec![rows[1].clone()]),
    )
    .unwrap();
    assert_eq!((first.inserted, first.matched), (0, 1));
    assert_eq!((second.inserted, second.matched), (0, 1));
    assert_eq!(count(&db, &table), 2);
    // Rows the snapshot matched are still never uploaded as new.
    assert!(export(&db, &scope, "feed_status").is_empty());
}

#[test]
fn a_replacement_snapshot_keeps_repeated_events_on_a_new_pc() {
    let (_dir, db, scope) = setup("snapshot-new");
    let vault = vault();
    let table = scope.table_name(stream_spec("feed_status").unwrap());
    let first = import_chunk(
        &db,
        &scope,
        snapshot(&vault, "pc-a", 9, 9),
        &chunk(
            "feed_status",
            vec![
                status_row("2026-10-10T12:00:00.000Z", "busy"),
                status_row("2026-10-10T12:00:03.000Z", "busy"),
            ],
        ),
    )
    .unwrap();
    // The next chunk of the same snapshot repeats the status once more.
    let second = import_chunk(
        &db,
        &scope,
        snapshot(&vault, "pc-a", 10, 9),
        &chunk(
            "feed_status",
            vec![status_row("2026-10-10T12:00:06.000Z", "busy")],
        ),
    )
    .unwrap();
    assert_eq!((first.inserted, first.matched), (2, 0));
    assert_eq!((second.inserted, second.matched), (1, 0));
    assert_eq!(count(&db, &table), 3);
}

#[test]
fn a_snapshot_row_matches_a_row_this_pc_recorded_itself() {
    let (_dir, db, scope) = setup("snapshot-local");
    let vault = vault();
    let table = scope.table_name(stream_spec("feed_status").unwrap());
    db.execute_non_query(
        &format!("INSERT INTO {table} (created_at, user_id, display_name, status, status_description, previous_status, previous_status_description) VALUES ('2026-10-10T12:00:02.000Z', 'usr_friend', 'Friend', 'busy', '', '', '')"),
        &Default::default(),
    )
    .unwrap();
    let report = import_chunk(
        &db,
        &scope,
        snapshot(&vault, "pc-a", 9, 9),
        &chunk(
            "feed_status",
            vec![status_row("2026-10-10T12:00:00.000Z", "busy")],
        ),
    )
    .unwrap();
    assert_eq!((report.inserted, report.matched), (0, 1));
    assert_eq!(count(&db, &table), 1);
}

#[test]
fn replaying_a_chunk_changes_nothing() {
    let (_dir, db, scope) = setup("replay");
    let vault = vault();
    let rows = chunk(
        "feed_status",
        vec![status_row("2026-10-10T12:00:00.000Z", "busy")],
    );
    import_chunk(&db, &scope, source(&vault, "pc-a", 7, 1), &rows).unwrap();
    // The server presents the same source chunk again under a new sequence.
    let replay = import_chunk(&db, &scope, source(&vault, "pc-a", 7, 2), &rows).unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.inserted, 0);
    let table = scope.table_name(stream_spec("feed_status").unwrap());
    assert_eq!(count(&db, &table), 1);
    assert_eq!(
        vault_state_get(&db, &vault).unwrap().unwrap().pull_cursor,
        2
    );
}

#[test]
fn imported_rows_are_never_exported_and_local_rows_are() {
    let (_dir, db, scope) = setup("no-echo");
    let vault = vault();
    let table = scope.table_name(stream_spec("feed_status").unwrap());
    db.execute_non_query(
        &format!("INSERT INTO {table} (created_at, user_id, display_name, status, status_description) VALUES ('2026-10-09T08:00:00.000Z', 'usr_local', 'Local', 'active', '')"),
        &Default::default(),
    )
    .unwrap();
    import_chunk(
        &db,
        &scope,
        source(&vault, "pc-a", 1, 1),
        &chunk(
            "feed_status",
            vec![status_row("2026-10-10T12:00:00.000Z", "busy")],
        ),
    )
    .unwrap();

    let exported = export(&db, &scope, "feed_status");
    assert_eq!(exported.len(), 1);
    assert_eq!(exported[0].1["user_id"], "usr_local");
    assert!(exported[0].1.get("id").is_none());

    // What one PC exports, another imports unchanged.
    let (_other_dir, other_db, other_scope) = setup("no-echo-other");
    let rows = exported.into_iter().map(|(_, row)| row).collect();
    let report = import_chunk(
        &other_db,
        &other_scope,
        source(&vault, "this-pc", 1, 1),
        &chunk("feed_status", rows),
    )
    .unwrap();
    assert_eq!(report.inserted, 1);
    assert!(export(&other_db, &other_scope, "feed_status").is_empty());
}

#[test]
fn game_log_rows_get_the_local_owner_and_match_exactly() {
    let (_dir, db, scope) = setup("gamelog");
    let vault = vault();
    let row = json!({
        "created_at": "2026-10-10T12:00:00.000Z",
        "type": "OnPlayerJoined",
        "display_name": "Friend",
        "location": "wrld_x:1",
        "user_id": "usr_friend",
        "time": 0,
        "owner_id": 999,
    });
    let later = json!({
        "created_at": "2026-10-10T12:00:02.000Z",
        "type": "OnPlayerJoined",
        "display_name": "Friend",
        "location": "wrld_x:1",
        "user_id": "usr_friend",
        "time": 0,
    });
    let first = import_chunk(
        &db,
        &scope,
        source(&vault, "pc-a", 1, 1),
        &chunk("gamelog_join_leave", vec![row.clone()]),
    )
    .unwrap();
    assert_eq!(first.inserted, 1);
    let second = import_chunk(
        &db,
        &scope,
        source(&vault, "pc-b", 1, 2),
        &chunk("gamelog_join_leave", vec![row, later]),
    )
    .unwrap();
    assert_eq!((second.inserted, second.matched), (1, 1));

    let owners = db
        .execute(
            "SELECT DISTINCT o.user_id FROM gamelog_join_leave g JOIN owners o ON o.id = g.owner_id",
            &Default::default(),
        )
        .unwrap();
    assert_eq!(owners.len(), 1);
    assert_eq!(row_string(&owners[0], 0), USER);
    assert!(export(&db, &scope, "gamelog_join_leave").is_empty());
}

#[test]
fn unknown_streams_and_malformed_rows_are_reported_not_imported() {
    let (_dir, db, scope) = setup("unknown");
    let vault = vault();
    let mut streams = chunk(
        "feed_status",
        vec![
            json!("not an object"),
            json!({ "user_id": "usr_friend", "status": "busy" }),
            json!({ "created_at": "2026-10-10T12:00:00.000Z", "user_id": { "nested": true } }),
        ],
    );
    streams.insert("stream_from_the_future".into(), vec![json!({})]);
    let report = import_chunk(&db, &scope, source(&vault, "pc-a", 1, 1), &streams).unwrap();
    assert_eq!(
        report.unknown_streams,
        vec!["stream_from_the_future".to_owned()]
    );
    assert_eq!((report.inserted, report.invalid_rows), (0, 3));
}

#[test]
fn a_pending_chunk_commits_cursors_and_sequence_together() {
    let (_dir, db, _scope) = setup("pending");
    let vault = vault();
    let pending = PendingChunk {
        chunk_id: "chunk".into(),
        source_seq: 4,
        blob_base64: "AAAA".into(),
        cursors: vec![("feed_status".into(), 12), ("gamelog_event".into(), 3)],
    };
    pending_chunk_put(&db, &vault, &pending).unwrap();
    assert_eq!(
        pending_chunk_get(&db, &vault).unwrap(),
        Some(pending.clone())
    );
    assert_eq!(push_cursor_get(&db, &vault, "feed_status").unwrap(), 0);

    pending_chunk_commit(&db, &vault, &pending).unwrap();
    assert_eq!(pending_chunk_get(&db, &vault).unwrap(), None);
    assert_eq!(push_cursor_get(&db, &vault, "feed_status").unwrap(), 12);
    assert_eq!(push_cursor_get(&db, &vault, "gamelog_event").unwrap(), 3);
    assert_eq!(
        vault_state_get(&db, &vault)
            .unwrap()
            .unwrap()
            .push_source_seq,
        4
    );
}

#[test]
fn clearing_account_state_keeps_history_and_provenance() {
    let (_dir, db, scope) = setup("clear");
    let vault = vault();
    import_chunk(
        &db,
        &scope,
        source(&vault, "pc-a", 1, 1),
        &chunk(
            "feed_status",
            vec![status_row("2026-10-10T12:00:00.000Z", "busy")],
        ),
    )
    .unwrap();
    clear_account_state(&db, &vault.api_origin, &vault.account_id).unwrap();

    assert_eq!(vault_state_get(&db, &vault).unwrap(), None);
    let table = scope.table_name(stream_spec("feed_status").unwrap());
    assert_eq!(count(&db, &table), 1);
    assert!(export(&db, &scope, "feed_status").is_empty());
}

#[test]
fn coverage_periods_are_reported_for_the_requested_window() {
    let (_dir, db, _scope) = setup("coverage");
    let open = coverage_start(&db, USER, 1_000).unwrap();
    coverage_extend(&db, open, 5_000).unwrap();
    let closed = coverage_start(&db, USER, 10_000).unwrap();
    coverage_end(&db, closed, 12_000).unwrap();
    coverage_start(&db, "usr_other", 2_000).unwrap();

    assert_eq!(
        coverage_between(&db, USER, 0, 20_000).unwrap(),
        vec![(1_000, 5_000), (10_000, 12_000)]
    );
    assert_eq!(coverage_between(&db, USER, 6_000, 9_000).unwrap(), vec![]);
}

fn memo(db: &DatabaseService, user_id: &str) -> Option<(String, String)> {
    db.execute(
        "SELECT memo, edited_at FROM memos WHERE user_id = @user_id",
        &ParamsBuilder::new().set("user_id", user_id).build(),
    )
    .unwrap()
    .first()
    .map(|row| (row_string(row, 0), row_string(row, 1)))
}

fn memo_row(user_id: &str, edited_at: &str, memo: &str) -> Value {
    json!({ "user_id": user_id, "edited_at": edited_at, "memo": memo })
}

#[test]
fn state_rows_merge_by_key_and_the_later_edit_wins() {
    let (_dir, db, scope) = setup("state-merge");
    let vault = vault();
    db.execute_non_query(
        "INSERT INTO memos (user_id, edited_at, memo) VALUES ('usr_a', '2026-10-05T00:00:00.000Z', 'mine')",
        &Default::default(),
    )
    .unwrap();

    let report = import_chunk(
        &db,
        &scope,
        source(&vault, "pc-a", 1, 1),
        &chunk(
            "memos",
            vec![
                memo_row("usr_a", "2026-10-01T00:00:00.000Z", "older"),
                memo_row("usr_b", "2026-10-02T00:00:00.000Z", "new friend"),
                json!({ "edited_at": "2026-10-02T00:00:00.000Z", "memo": "no key" }),
            ],
        ),
    )
    .unwrap();
    assert_eq!(
        (report.inserted, report.matched, report.invalid_rows),
        (1, 1, 1)
    );
    assert_eq!(memo(&db, "usr_a").unwrap().0, "mine");
    assert_eq!(memo(&db, "usr_b").unwrap().0, "new friend");

    import_chunk(
        &db,
        &scope,
        source(&vault, "pc-a", 2, 2),
        &chunk(
            "memos",
            vec![memo_row(
                "usr_a",
                "2026-10-09T00:00:00.000Z",
                "edited elsewhere",
            )],
        ),
    )
    .unwrap();
    assert_eq!(
        memo(&db, "usr_a").unwrap(),
        (
            "edited elsewhere".to_owned(),
            "2026-10-09T00:00:00.000Z".to_owned()
        )
    );
}

#[test]
fn state_export_fingerprint_follows_the_table_content() {
    let (_dir, db, scope) = setup("state-export");
    let spec = state_spec("memos").unwrap();
    assert_eq!(export_state(&db, &scope, spec).unwrap().fingerprint, 0);

    db.execute_non_query(
        "INSERT INTO memos (user_id, edited_at, memo) VALUES ('usr_a', '2026-10-05T00:00:00.000Z', 'one')",
        &Default::default(),
    )
    .unwrap();
    let exported = export_state(&db, &scope, spec).unwrap();
    let (rows, first) = (exported.rows, exported.fingerprint);
    assert_eq!(
        rows,
        vec![memo_row("usr_a", "2026-10-05T00:00:00.000Z", "one")]
    );
    assert_ne!(first, 0);
    assert_eq!(export_state(&db, &scope, spec).unwrap().fingerprint, first);

    db.execute_non_query("UPDATE memos SET memo = 'two'", &Default::default())
        .unwrap();
    assert_ne!(export_state(&db, &scope, spec).unwrap().fingerprint, first);
}

#[test]
fn every_state_stream_maps_to_a_table_with_its_key_and_version_columns() {
    let (_dir, db, scope) = setup("state-mapping");
    for spec in STATE_STREAMS {
        assert!(
            stream_spec(spec.name).is_none(),
            "{} is both a log and state",
            spec.name
        );
        let exported = export_state(&db, &scope, spec).unwrap();
        assert_eq!((exported.rows.len(), exported.fingerprint), (0, 0));
        let table = match spec.table {
            super::streams::StreamTable::User(suffix) => {
                format!(
                    "{}_{suffix}",
                    crate::realtime::normalize_user_table_prefix(USER).unwrap()
                )
            }
            super::streams::StreamTable::Owned(table)
            | super::streams::StreamTable::Global(table) => table.to_owned(),
        };
        let columns = db
            .execute(&format!("PRAGMA table_info({table})"), &Default::default())
            .unwrap()
            .iter()
            .map(|row| row_string(row, 1))
            .collect::<Vec<_>>();
        for column in spec.key.iter().chain(spec.version.iter()) {
            assert!(
                columns.iter().any(|name| name == column),
                "{table} is missing {column}"
            );
        }
    }
}

#[test]
fn a_deletion_travels_and_does_not_undo_a_later_edit() {
    let (_dir, db, scope) = setup("state-delete");
    let vault = vault();
    let spec = state_spec("memos").unwrap();
    for (user, edited_at) in [
        ("usr_old", "2026-10-01T00:00:00.000Z"),
        ("usr_new", "2026-10-09T00:00:00.000Z"),
    ] {
        db.execute_non_query(
            "INSERT INTO memos (user_id, edited_at, memo) VALUES (@user, @edited_at, 'text')",
            &ParamsBuilder::new()
                .set("user", user)
                .set("edited_at", edited_at)
                .build(),
        )
        .unwrap();
    }
    let deleted_at = chrono::DateTime::parse_from_rfc3339("2026-10-05T00:00:00.000Z")
        .unwrap()
        .timestamp_millis();
    let deletions = vec![
        json!({ "key": ["usr_old"], "deletedAtMs": deleted_at }),
        json!({ "key": ["usr_new"], "deletedAtMs": deleted_at }),
        json!({ "key": ["usr_never_here"], "deletedAtMs": deleted_at }),
        json!({ "key": [], "deletedAtMs": deleted_at }),
    ];
    let report = import_chunk(
        &db,
        &scope,
        source(&vault, "pc-a", 1, 1),
        &chunk("memos#deleted", deletions),
    )
    .unwrap();
    assert_eq!(report.invalid_rows, 1);
    assert!(report.unknown_streams.is_empty());
    assert!(memo(&db, "usr_old").is_none());
    // Edited after the other PC deleted it, so it stays.
    assert!(memo(&db, "usr_new").is_some());

    // The deleted row does not come back from an older copy, but a copy
    // written after the deletion does.
    let old_copy = chunk(
        "memos",
        vec![memo_row("usr_old", "2026-10-02T00:00:00.000Z", "stale")],
    );
    import_chunk(&db, &scope, source(&vault, "pc-b", 1, 2), &old_copy).unwrap();
    assert!(memo(&db, "usr_old").is_none());
    let new_copy = chunk(
        "memos",
        vec![memo_row("usr_old", "2026-10-08T00:00:00.000Z", "rewritten")],
    );
    import_chunk(&db, &scope, source(&vault, "pc-b", 2, 3), &new_copy).unwrap();
    assert_eq!(memo(&db, "usr_old").unwrap().0, "rewritten");
    assert!(export_state(&db, &scope, spec)
        .unwrap()
        .deleted
        .iter()
        .all(|entry| entry["key"][0] != "usr_old"));
}

#[test]
fn deleting_a_row_locally_is_recorded_and_exported() {
    let (_dir, db, scope) = setup("state-local-delete");
    let spec = state_spec("avatar_tags").unwrap();
    db.execute_non_query(
        "INSERT INTO avatar_tags (avatar_id, tag, color) VALUES ('avtr_a', 'cute', '')",
        &Default::default(),
    )
    .unwrap();
    assert!(export_state(&db, &scope, spec).unwrap().deleted.is_empty());

    db.execute_non_query(
        "DELETE FROM avatar_tags WHERE avatar_id = 'avtr_a'",
        &Default::default(),
    )
    .unwrap();
    let exported = export_state(&db, &scope, spec).unwrap();
    assert!(exported.rows.is_empty());
    assert_eq!(exported.deleted.len(), 1);
    assert_eq!(exported.deleted[0]["key"], json!(["avtr_a", "cute"]));
    assert_ne!(exported.fingerprint, 0);

    db.execute_non_query(
        "INSERT INTO avatar_tags (avatar_id, tag, color) VALUES ('avtr_a', 'cute', '')",
        &Default::default(),
    )
    .unwrap();
    assert!(export_state(&db, &scope, spec).unwrap().deleted.is_empty());
}

#[test]
fn owned_state_rows_get_the_local_owner_and_stay_per_account() {
    let (_dir, db, scope) = setup("state-owned");
    let vault = vault();
    let other = StreamScope::open(&db, "usr_99999999-1234-1234-1234-1234567890ab").unwrap();
    let rows = chunk(
        "favorite_friend",
        vec![
            json!({ "created_at": "2026-10-01T00:00:00.000Z", "user_id": "usr_friend", "group_name": "group_0", "owner_id": 4242 }),
        ],
    );
    assert_eq!(
        import_chunk(&db, &scope, source(&vault, "pc-a", 1, 1), &rows)
            .unwrap()
            .inserted,
        1
    );
    let spec = state_spec("favorite_friend").unwrap();
    assert_eq!(export_state(&db, &scope, spec).unwrap().rows.len(), 1);
    assert!(export_state(&db, &scope, spec).unwrap().rows[0]
        .get("owner_id")
        .is_none());
    assert!(export_state(&db, &other, spec).unwrap().rows.is_empty());
}
