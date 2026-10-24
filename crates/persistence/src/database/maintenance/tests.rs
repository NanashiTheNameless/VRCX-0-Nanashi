use chrono::{TimeZone, Utc};

use crate::realtime::ensure_realtime_tables;

use super::*;

struct TestDir {
    path: std::path::PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn insert_join_leave(
    db: &DatabaseService,
    created_at: i64,
    event_type: &str,
    display_name: &str,
    location: &str,
    user_id: &str,
    time: i64,
) {
    db.execute_non_query(
        "INSERT INTO gamelog_join_leave (created_at, type, display_name, location, user_id, time)
         VALUES (@created_at, @type, @name, @location, @user_id, @time)",
        &ParamsBuilder::new()
            .set("created_at", created_at)
            .set("type", event_type)
            .set("name", display_name)
            .set("location", location)
            .set("user_id", user_id)
            .set("time", time)
            .build(),
    )
    .unwrap();
}

fn leave_time(db: &DatabaseService, user_id: &str) -> i64 {
    db.execute(
        "SELECT time FROM gamelog_join_leave WHERE user_id = @user_id AND type = 'OnPlayerLeft'",
        &ParamsBuilder::new().set("user_id", user_id).build(),
    )
    .unwrap()
    .first()
    .map(|row| row_i64(row, 0))
    .unwrap()
}

fn leave_time_at(db: &DatabaseService, created_at: i64) -> i64 {
    db.execute(
        "SELECT time FROM gamelog_join_leave WHERE created_at = @created_at AND type = 'OnPlayerLeft'",
        &ParamsBuilder::new().set("created_at", created_at).build(),
    )
    .unwrap()
    .first()
    .map(|row| row_i64(row, 0))
    .unwrap()
}

fn cleanup_test_db(name: &str) -> Result<(TestDir, DatabaseService), Error> {
    let dir = TestDir::new(name);
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    Ok((dir, db))
}

#[test]
fn avatar_auto_cleanup_disables_off_and_invalid_retention() -> Result<(), Error> {
    let (_dir, db) = cleanup_test_db("avatar-cleanup-disabled")?;
    let now = Utc.timestamp_opt(1784289600, 0).unwrap();

    avatar_auto_cleanup_run(&db, "usr_self", now)?;
    assert_eq!(
        crate::config::get_string(&db, "lastAvatarCleanupDate_usr_self", "")?,
        ""
    );

    for value in ["invalid", "1", "31", "9223372036854775807"] {
        crate::config::set_string(&db, "VRCX_avatarAutoCleanup", value)?;
        avatar_auto_cleanup_run(&db, "usr_self", now)?;
        assert_eq!(
            crate::config::get_string(&db, "lastAvatarCleanupDate_usr_self", "")?,
            ""
        );
    }
    Ok(())
}

#[test]
fn avatar_auto_cleanup_skips_when_last_run_is_less_than_seven_days_old() -> Result<(), Error> {
    let (_dir, db) = cleanup_test_db("avatar-cleanup-not-due")?;
    crate::config::set_string(&db, "VRCX_avatarAutoCleanup", "30")?;
    crate::config::set_string(
        &db,
        "lastAvatarCleanupDate_usr_self",
        "2026-07-12T12:00:00.000Z",
    )?;
    let now = Utc.timestamp_opt(1784289600, 0).unwrap();
    let prefix = normalize_user_table_prefix("usr_self")?;
    ensure_realtime_tables(&db, &prefix)?;
    db.execute_non_query(
        &format!("INSERT INTO {prefix}_feed_avatar (created_at) VALUES (@created_at)"),
        &ParamsBuilder::new().set("created_at", 1777593600).build(),
    )?;

    avatar_auto_cleanup_run(&db, "usr_self", now)?;

    let remaining = db.execute(
        &format!("SELECT COUNT(*) FROM {prefix}_feed_avatar"),
        &Default::default(),
    )?;
    assert_eq!(remaining.first().map(|row| row_i64(row, 0)), Some(1));
    assert_eq!(
        crate::config::get_string(&db, "lastAvatarCleanupDate_usr_self", "")?,
        "1783857600"
    );
    Ok(())
}

#[test]
fn avatar_auto_cleanup_treats_invalid_last_date_as_due_and_commits_delete_with_flag(
) -> Result<(), Error> {
    let (_dir, db) = cleanup_test_db("avatar-cleanup-runs")?;
    crate::config::set_string(&db, "VRCX_avatarAutoCleanup", "30")?;
    crate::config::set_string(&db, "lastAvatarCleanupDate_usr_self", "not-a-date")?;
    let prefix = normalize_user_table_prefix("usr_self")?;
    ensure_realtime_tables(&db, &prefix)?;
    db.execute_non_query(
        &format!("INSERT INTO {prefix}_feed_avatar (created_at) VALUES (@created_at)"),
        &ParamsBuilder::new().set("created_at", 1777593600).build(),
    )?;
    let now = Utc.timestamp_opt(1784289600, 0).unwrap();

    avatar_auto_cleanup_run(&db, "usr_self", now)?;

    let remaining = db.execute(
        &format!("SELECT COUNT(*) FROM {prefix}_feed_avatar"),
        &Default::default(),
    )?;
    assert_eq!(remaining.first().map(|row| row_i64(row, 0)), Some(0));
    assert_eq!(
        crate::config::get_string(&db, "lastAvatarCleanupDate_usr_self", "")?,
        "1784289600"
    );
    Ok(())
}

#[test]
fn avatar_auto_cleanup_runs_when_last_completion_is_in_the_future() -> Result<(), Error> {
    let (_dir, db) = cleanup_test_db("avatar-cleanup-future-completion")?;
    crate::config::set_string(&db, "VRCX_avatarAutoCleanup", "30")?;
    crate::config::set_string(&db, "lastAvatarCleanupDate_usr_self", "1815825600")?;
    let prefix = normalize_user_table_prefix("usr_self")?;
    ensure_realtime_tables(&db, &prefix)?;
    db.execute_non_query(
        &format!("INSERT INTO {prefix}_feed_avatar (created_at) VALUES (@created_at)"),
        &ParamsBuilder::new().set("created_at", 1777593600).build(),
    )?;
    let now = Utc.timestamp_opt(1784289600, 0).unwrap();

    avatar_auto_cleanup_run(&db, "usr_self", now)?;
    assert_eq!(
        crate::config::get_string(&db, "lastAvatarCleanupDate_usr_self", "")?,
        "1784289600"
    );
    Ok(())
}

#[test]
fn avatar_cleanup_deletes_only_rows_before_the_cutoff() -> Result<(), Error> {
    let (_dir, db) = cleanup_test_db("avatar-cleanup-timestamps")?;
    crate::config::set_string(&db, "VRCX_avatarAutoCleanup", "30")?;
    let prefix = normalize_user_table_prefix("usr_self")?;
    ensure_realtime_tables(&db, &prefix)?;
    for (user_id, created_at) in [
        ("old", Some(1781697599)),
        ("equal", Some(1781697600)),
        ("new", Some(1781697601)),
        ("undated", None),
    ] {
        db.execute_non_query(
            &format!(
                "INSERT INTO {prefix}_feed_avatar (user_id, created_at) VALUES (@user_id, @created_at)"
            ),
            &ParamsBuilder::new()
                .set("user_id", user_id)
                .set("created_at", created_at)
                .build(),
        )?;
    }
    let now = Utc.timestamp_opt(1784289600, 0).unwrap();

    avatar_auto_cleanup_run(&db, "usr_self", now)?;
    let rows = db.execute(
        &format!("SELECT user_id FROM {prefix}_feed_avatar ORDER BY user_id"),
        &Default::default(),
    )?;
    let remaining_ids = rows
        .iter()
        .map(|row| row_string(row, 0))
        .collect::<Vec<_>>();
    assert_eq!(remaining_ids, vec!["equal", "new", "undated"]);
    Ok(())
}

#[test]
fn avatar_cleanup_uses_the_created_at_index() -> Result<(), Error> {
    let (_dir, db) = cleanup_test_db("avatar-cleanup-query-plan")?;
    let prefix = normalize_user_table_prefix("usr_self")?;
    ensure_realtime_tables(&db, &prefix)?;

    let plan = db.execute(
        &format!(
            "EXPLAIN QUERY PLAN {}",
            crate::feed::feed_avatar_delete_before_sql(&prefix)
        ),
        &ParamsBuilder::new().set("cutoff", 1781697600).build(),
    )?;
    let expected_index = format!("USING INDEX {prefix}_feed_avatar_created_id_idx");

    assert!(plan
        .iter()
        .any(|row| row_string(row, 3).contains(&expected_index)));
    Ok(())
}

#[test]
fn avatar_auto_cleanup_rolls_back_delete_when_completion_flag_fails() -> Result<(), Error> {
    let (_dir, db) = cleanup_test_db("avatar-cleanup-rolls-back")?;
    crate::config::set_string(&db, "VRCX_avatarAutoCleanup", "30")?;
    crate::config::set_string(&db, "lastAvatarCleanupDate_usr_self", "not-a-date")?;
    let prefix = normalize_user_table_prefix("usr_self")?;
    ensure_realtime_tables(&db, &prefix)?;
    db.execute_non_query(
        &format!("INSERT INTO {prefix}_feed_avatar (created_at) VALUES (@created_at)"),
        &ParamsBuilder::new().set("created_at", 1777593600).build(),
    )?;
    db.execute_non_query(
        "CREATE TRIGGER fail_avatar_cleanup_flag BEFORE UPDATE ON configs
         BEGIN SELECT RAISE(ABORT, 'forced completion flag failure'); END",
        &Default::default(),
    )?;
    let now = Utc.timestamp_opt(1784289600, 0).unwrap();

    assert!(avatar_auto_cleanup_run(&db, "usr_self", now).is_err());
    let remaining = db.execute(
        &format!("SELECT COUNT(*) FROM {prefix}_feed_avatar"),
        &Default::default(),
    )?;
    assert_eq!(remaining.first().map(|row| row_i64(row, 0)), Some(1));
    Ok(())
}

#[test]
fn repair_zero_copresence_durations_pairs_leave_with_join() -> Result<(), Error> {
    let dir = TestDir::new("gamelog-repair-durations");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    ensure_game_log_tables(&db)?;

    // Alice: real 40-minute session whose leave was written as time=0.
    insert_join_leave(
        &db,
        1782835210,
        "OnPlayerJoined",
        "Alice",
        "wrld_x:1",
        "usr_alice",
        0,
    );
    insert_join_leave(
        &db,
        1782837610,
        "OnPlayerLeft",
        "Alice",
        "wrld_x:1",
        "usr_alice",
        0,
    );
    // Bob: leave with no matching join stays 0.
    insert_join_leave(
        &db,
        1782837610,
        "OnPlayerLeft",
        "Bob",
        "wrld_x:1",
        "usr_bob",
        0,
    );
    // Carol: a 'traveling' leave carries no world, so it is not repaired.
    insert_join_leave(
        &db,
        1782835500,
        "OnPlayerJoined",
        "Carol",
        "wrld_x:1",
        "usr_carol",
        0,
    );
    insert_join_leave(
        &db,
        1782836400,
        "OnPlayerLeft",
        "Carol",
        "traveling",
        "usr_carol",
        0,
    );

    database_maintenance_run(&db, DatabaseMaintenanceTask::RepairZeroCopresenceDurations)?;

    assert_eq!(leave_time(&db, "usr_alice"), 2_400_000);
    assert_eq!(leave_time(&db, "usr_bob"), 0);
    assert_eq!(leave_time(&db, "usr_carol"), 0);
    Ok(())
}

#[test]
fn empty_leave_location_repair_restores_the_instance_the_session_started_in() -> Result<(), Error> {
    let dir = TestDir::new("gamelog-repair-empty-leave-location");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    ensure_game_log_tables(&db)?;
    for (created_at, location) in [
        (1786615200, "wrld_a:1~friends(usr_x)"),
        (1786622400, "wrld_b:2~hidden(usr_x)"),
    ] {
        db.execute_non_query(
            "INSERT INTO gamelog_location (created_at, location, world_id, world_name, time, group_name)
             VALUES (@created_at, @location, '', '', 0, '')",
            &ParamsBuilder::new()
                .set("created_at", created_at)
                .set("location", location)
                .build(),
        )?;
    }
    let minutes = |value: i64| value * 60 * 1000;
    for (created_at, location, user_id, time) in [
        (1786620600, "", "usr_inside", minutes(85)),
        (1786626000, "", "usr_boundary", minutes(60)),
        (1786624200, "", "usr_crossed", minutes(150)),
        (1786613400, "", "usr_before", minutes(10)),
        (1786618800, "", "usr_zero", 0),
        (1786618800, "wrld_c:3", "usr_known", minutes(30)),
    ] {
        insert_join_leave(
            &db,
            created_at,
            "OnPlayerLeft",
            user_id,
            location,
            user_id,
            time,
        );
    }

    database_maintenance_run(&db, DatabaseMaintenanceTask::RepairEmptyLeaveLocations)?;

    let leave_location = |user_id: &str| {
        db.execute(
            "SELECT location FROM gamelog_join_leave WHERE user_id = @user_id",
            &ParamsBuilder::new().set("user_id", user_id).build(),
        )
        .unwrap()
        .first()
        .map(|row| row_string(row, 0))
        .unwrap()
    };
    assert_eq!(leave_location("usr_inside"), "wrld_a:1~friends(usr_x)");
    assert_eq!(leave_location("usr_boundary"), "wrld_b:2~hidden(usr_x)");
    assert_eq!(leave_location("usr_crossed"), "");
    assert_eq!(leave_location("usr_before"), "");
    assert_eq!(leave_location("usr_zero"), "");
    assert_eq!(leave_location("usr_known"), "wrld_c:3");
    Ok(())
}

#[test]
fn empty_leave_location_repair_skips_a_previous_location_stay_that_ended_before_the_join(
) -> Result<(), Error> {
    let dir = TestDir::new("gamelog-repair-empty-leave-location-stale");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    ensure_game_log_tables(&db)?;
    for (created_at, location, time) in [
        (1786392000, "wrld_old:1", 60 * 60 * 1000),
        (1786615200, "wrld_open:2", 0),
    ] {
        db.execute_non_query(
            "INSERT INTO gamelog_location (created_at, location, world_id, world_name, time, group_name)
             VALUES (@created_at, @location, '', '', @time, '')",
            &ParamsBuilder::new()
                .set("created_at", created_at)
                .set("location", location)
                .set("time", time)
                .build(),
        )?;
    }
    for (created_at, user_id) in [
        (1786536000, "usr_missing_session"),
        (1786618800, "usr_open_session"),
    ] {
        insert_join_leave(
            &db,
            created_at,
            "OnPlayerLeft",
            user_id,
            "",
            user_id,
            30 * 60 * 1000,
        );
    }

    database_maintenance_run(&db, DatabaseMaintenanceTask::RepairEmptyLeaveLocations)?;

    let rows = db.execute(
        "SELECT user_id, location FROM gamelog_join_leave ORDER BY user_id",
        &Default::default(),
    )?;
    let locations = rows
        .iter()
        .map(|row| (row_string(row, 0), row_string(row, 1)))
        .collect::<Vec<_>>();
    assert_eq!(
        locations,
        [
            ("usr_missing_session".to_string(), String::new()),
            ("usr_open_session".to_string(), "wrld_open:2".to_string()),
        ]
    );
    Ok(())
}

#[test]
fn empty_leave_location_repair_skips_when_the_matching_join_recorded_another_instance(
) -> Result<(), Error> {
    let dir = TestDir::new("gamelog-repair-empty-leave-location-join-conflict");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    ensure_game_log_tables(&db)?;
    db.execute_non_query(
        "INSERT INTO gamelog_location (created_at, location, world_id, world_name, time, group_name)
         VALUES (1786615200, 'wrld_prev:1', '', '', 0, '')",
        &Default::default(),
    )?;
    let joined_at = 1786618800;
    let left_at = 1786620600;
    for (display_name, user_id, join_location) in [
        ("Moved", "usr_moved", "wrld_missing:9"),
        ("Stayed", "usr_stayed", "wrld_prev:1"),
        ("Untracked", "usr_untracked", ""),
        ("Nameless", "", "wrld_missing:9"),
    ] {
        insert_join_leave(
            &db,
            joined_at,
            "OnPlayerJoined",
            display_name,
            join_location,
            user_id,
            0,
        );
        insert_join_leave(
            &db,
            left_at,
            "OnPlayerLeft",
            display_name,
            "",
            user_id,
            30 * 60 * 1000,
        );
    }

    database_maintenance_run(&db, DatabaseMaintenanceTask::RepairEmptyLeaveLocations)?;

    let rows = db.execute(
        "SELECT display_name, location FROM gamelog_join_leave WHERE type = 'OnPlayerLeft' ORDER BY display_name",
        &Default::default(),
    )?;
    let locations = rows
        .iter()
        .map(|row| (row_string(row, 0), row_string(row, 1)))
        .collect::<Vec<_>>();
    assert_eq!(
        locations,
        [
            ("Moved".to_string(), String::new()),
            ("Nameless".to_string(), String::new()),
            ("Stayed".to_string(), "wrld_prev:1".to_string()),
            ("Untracked".to_string(), "wrld_prev:1".to_string()),
        ]
    );
    Ok(())
}

#[test]
fn copresence_repair_uses_the_latest_matching_join_in_the_same_instance() -> Result<(), Error> {
    let dir = TestDir::new("gamelog-repair-latest-matching-join");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    ensure_game_log_tables(&db)?;

    for (created_at, location, user_id) in [
        (1786615200, "wrld_a:1", "usr_alice"),
        (1786615800, "wrld_a:1", "usr_alice"),
        (1786616400, "wrld_a:1", "usr_other"),
        (1786616700, "wrld_b:1", "usr_alice"),
    ] {
        insert_join_leave(
            &db,
            created_at,
            "OnPlayerJoined",
            "Alice",
            location,
            user_id,
            0,
        );
    }
    insert_join_leave(
        &db,
        1786617000,
        "OnPlayerLeft",
        "Alice",
        "wrld_a:1",
        "usr_alice",
        0,
    );

    database_maintenance_run(&db, DatabaseMaintenanceTask::RepairZeroCopresenceDurations)?;

    assert_eq!(leave_time(&db, "usr_alice"), 20 * 60 * 1000);
    Ok(())
}

#[test]
fn copresence_repair_uses_latest_display_name_match_for_legacy_rows_without_user_id(
) -> Result<(), Error> {
    let dir = TestDir::new("gamelog-repair-legacy-name");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    ensure_game_log_tables(&db)?;

    insert_join_leave(
        &db,
        1786618800,
        "OnPlayerJoined",
        "Legacy Player",
        "wrld_a:1",
        "",
        0,
    );
    insert_join_leave(
        &db,
        1786619400,
        "OnPlayerJoined",
        "Legacy Player",
        "wrld_a:1",
        "usr_known",
        0,
    );
    insert_join_leave(
        &db,
        1786619700,
        "OnPlayerLeft",
        "Legacy Player",
        "wrld_a:1",
        "",
        0,
    );
    insert_join_leave(
        &db,
        1786620000,
        "OnPlayerLeft",
        "Legacy Player",
        "wrld_a:1",
        "usr_missing",
        0,
    );

    database_maintenance_run(&db, DatabaseMaintenanceTask::RepairZeroCopresenceDurations)?;

    assert_eq!(leave_time_at(&db, 1786619700), 5 * 60 * 1000);
    assert_eq!(leave_time(&db, "usr_missing"), 0);
    Ok(())
}

#[test]
fn copresence_repair_preserves_recorded_and_rejects_implausible_history() -> Result<(), Error> {
    let dir = TestDir::new("gamelog-repair-history-guards");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    ensure_game_log_tables(&db)?;

    for (created_at, event_type, user_id, time) in [
        (1786536000, "OnPlayerJoined", "usr_day", 0),
        (1786622400, "OnPlayerLeft", "usr_day", 0),
        (1786535999, "OnPlayerJoined", "usr_over", 0),
        (1786622400, "OnPlayerLeft", "usr_over", 0),
        (1786618800, "OnPlayerJoined", "usr_recorded", 0),
        (1786622400, "OnPlayerLeft", "usr_recorded", 1234),
        (1786618800, "OnPlayerJoined", "usr_invalid", 0),
    ] {
        insert_join_leave(
            &db, created_at, event_type, user_id, "wrld_a:1", user_id, time,
        );
    }
    db.execute_non_query(
        "INSERT INTO gamelog_join_leave (created_at, type, display_name, location, user_id, time)
         VALUES (NULL, 'OnPlayerLeft', 'usr_invalid', 'wrld_a:1', 'usr_invalid', 0)",
        &Default::default(),
    )?;

    database_maintenance_run(&db, DatabaseMaintenanceTask::RepairZeroCopresenceDurations)?;

    assert_eq!(leave_time(&db, "usr_day"), 24 * 60 * 60 * 1000);
    assert_eq!(leave_time(&db, "usr_over"), 0);
    assert_eq!(leave_time(&db, "usr_recorded"), 1234);
    assert_eq!(leave_time(&db, "usr_invalid"), 0);
    Ok(())
}

#[test]
fn fix_broken_game_log_display_names_skips_unique_key_collisions() -> Result<(), Error> {
    let dir = TestDir::new("gamelog-display-name-collision");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    ensure_game_log_tables(&db)?;

    insert_join_leave(
        &db,
        1783080000,
        "OnPlayerJoined",
        "Alice (usr_a)",
        "wrld_x:1",
        "usr_a",
        0,
    );
    insert_join_leave(
        &db,
        1783080000,
        "OnPlayerJoined",
        "Alice (usr_b)",
        "wrld_x:1",
        "usr_b",
        0,
    );

    database_maintenance_run(&db, DatabaseMaintenanceTask::FixBrokenGameLogDisplayNames)?;

    let rows = db.execute(
        "SELECT display_name FROM gamelog_join_leave ORDER BY id",
        &Default::default(),
    )?;

    assert_eq!(rows.len(), 2);
    assert_eq!(row_string(&rows[0], 0), "Alice");
    assert_eq!(row_string(&rows[1], 0), "Alice (usr_b)");
    Ok(())
}

#[test]
fn vacuum_is_skipped_when_there_is_nothing_meaningful_to_reclaim() -> Result<(), Error> {
    let dir = TestDir::new("vacuum-skip");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;

    assert!(!database_vacuum_if_fragmented(&db)?);
    Ok(())
}

#[test]
fn vacuum_runs_once_a_large_delete_leaves_the_file_fragmented() -> Result<(), Error> {
    let dir = TestDir::new("vacuum-run");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;

    db.execute_non_query(
        "CREATE TABLE bulk (id INTEGER PRIMARY KEY, blob TEXT)",
        &Default::default(),
    )?;
    db.write_transaction(|tx| {
        for index in 0..6000 {
            tx.execute_non_query(
                "INSERT INTO bulk (blob) VALUES (@blob)",
                &ParamsBuilder::new()
                    .set("blob", format!("{index}{}", "x".repeat(2048)))
                    .build(),
            )?;
        }
        Ok(())
    })?;
    db.execute_non_query("DELETE FROM bulk", &Default::default())?;

    let (free_pages, page_count) = read_page_stats(&db)?;
    assert!(
        free_pages >= VACUUM_MIN_FREE_PAGES,
        "expected a large free list, got {free_pages} free of {page_count}"
    );

    assert!(database_vacuum_if_fragmented(&db)?);

    let (free_after, _) = read_page_stats(&db)?;
    assert!(
        free_after < free_pages,
        "vacuum should have reclaimed pages, {free_pages} -> {free_after}"
    );
    Ok(())
}

#[test]
fn concurrent_reads_survive_a_vacuum_instead_of_failing_busy() -> Result<(), Error> {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    let dir = TestDir::new("vacuum-concurrent-read");
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);

    db.execute_non_query(
        "CREATE TABLE bulk (id INTEGER PRIMARY KEY, blob TEXT)",
        &Default::default(),
    )?;
    db.write_transaction(|tx| {
        for index in 0..6000 {
            tx.execute_non_query(
                "INSERT INTO bulk (blob) VALUES (@blob)",
                &ParamsBuilder::new()
                    .set("blob", format!("{index}{}", "x".repeat(2048)))
                    .build(),
            )?;
        }
        Ok(())
    })?;
    db.execute_non_query("DELETE FROM bulk", &Default::default())?;

    let stop_reader = Arc::new(AtomicBool::new(false));
    let reader_db = Arc::clone(&db);
    let reader_stop = Arc::clone(&stop_reader);
    let reader = std::thread::spawn(move || -> Result<usize, Error> {
        let mut completed_reads = 0;
        while !reader_stop.load(Ordering::Acquire) {
            reader_db.execute("SELECT COUNT(*) FROM bulk", &Default::default())?;
            completed_reads += 1;
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        Ok(completed_reads)
    });

    assert!(database_vacuum_if_fragmented(&db)?);
    stop_reader.store(true, Ordering::Release);

    let completed_reads = reader.join().expect("reader thread panicked")?;
    assert!(completed_reads > 0, "the reader never completed a read");
    Ok(())
}

#[test]
fn import_upstream_print_favorites_merges_rows_into_config_and_drops_table() -> Result<(), Error> {
    let (_dir, db) = cleanup_test_db("import-upstream-print-favorites")?;
    crate::config::set_json(
        &db,
        PRINT_FAVORITE_IDS_CONFIG_KEY,
        &serde_json::json!(["prnt_local", "prnt_both"]),
    )?;
    db.execute_non_query(
        "CREATE TABLE favorite_print (id INTEGER PRIMARY KEY, print_id TEXT UNIQUE, created_at TEXT)",
        &Default::default(),
    )?;
    db.execute_non_query(
        "INSERT INTO favorite_print (print_id, created_at) VALUES
            ('prnt_newer', 1785628800),
            ('prnt_both', 1785542400),
            ('prnt_older', 1785542400),
            ('', 1785715200)",
        &Default::default(),
    )?;

    database_maintenance_run(&db, DatabaseMaintenanceTask::ImportUpstreamPrintFavorites)?;

    assert_eq!(
        crate::config::get_json(&db, PRINT_FAVORITE_IDS_CONFIG_KEY, Value::Null)?,
        serde_json::json!(["prnt_local", "prnt_both", "prnt_older", "prnt_newer"])
    );
    assert!(select_table_names(&db, "name = 'favorite_print'")?.is_empty());

    database_maintenance_run(&db, DatabaseMaintenanceTask::ImportUpstreamPrintFavorites)?;
    assert_eq!(
        crate::config::get_json(&db, PRINT_FAVORITE_IDS_CONFIG_KEY, Value::Null)?,
        serde_json::json!(["prnt_local", "prnt_both", "prnt_older", "prnt_newer"])
    );
    Ok(())
}

#[test]
fn repair_expired_notifications_seen_marks_every_user_table() -> Result<(), Error> {
    let dir = TestDir::new("notification-expired-seen-repair");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    for prefix in ["usra", "usrb"] {
        ensure_realtime_tables(&db, prefix)?;
        db.execute_non_query(
            &format!(
                "INSERT INTO {prefix}_notifications (id, created_at, type, expired, seen) VALUES ('active', 1787223600, 'friendRequest', 0, 0), ('expired', 1787220000, 'friendRequest', 1, 0)"
            ),
            &Default::default(),
        )?;
    }

    database_maintenance_run(&db, DatabaseMaintenanceTask::RepairExpiredNotificationsSeen)?;

    for prefix in ["usra", "usrb"] {
        let rows = db.execute(
            &format!("SELECT id, seen FROM {prefix}_notifications ORDER BY id"),
            &Default::default(),
        )?;
        assert_eq!(
            rows,
            vec![
                vec![serde_json::json!("active"), serde_json::json!(0)],
                vec![serde_json::json!("expired"), serde_json::json!(1)]
            ]
        );
    }
    Ok(())
}
