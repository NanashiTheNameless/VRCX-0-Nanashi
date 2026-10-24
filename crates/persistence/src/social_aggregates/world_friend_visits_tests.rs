use super::test_support::*;
use super::*;
use crate::common::ParamsBuilder;
use crate::database::DatabaseService;
use crate::ownership::OwnerId;

const OWNER_USER_ID: &str = "usr_self";
const USER_PREFIX: &str = "usrself";

fn setup(name: &str) -> (TestDir, std::sync::Arc<DatabaseService>) {
    let (dir, db) = test_db(name);
    ensure_realtime_tables(&db, USER_PREFIX).unwrap();
    (dir, db)
}

fn add_friend(db: &DatabaseService, user_id: &str, display_name: &str) {
    db.execute_non_query(
        &format!(
            "INSERT INTO {USER_PREFIX}_friend_log_current (user_id, display_name, trust_level, friend_number)
             VALUES (@user_id, @display_name, 'trusted', 1)"
        ),
        &ParamsBuilder::new()
            .set("user_id", user_id)
            .set("display_name", display_name)
            .build(),
    )
    .unwrap();
}

fn insert_gps(db: &DatabaseService, created_at: &str, user_id: &str, location: &str) {
    db.execute_non_query(
        &format!(
            "INSERT INTO {USER_PREFIX}_feed_gps (created_at, user_id, display_name, location, world_name, previous_location, time, group_name)
             VALUES (@created_at, @user_id, 'Stale Name', @location, '', '', 0, '')"
        ),
        &ParamsBuilder::new()
            .set("created_at", vrcx_0_core::time::parse_epoch_seconds(created_at))
            .set("user_id", user_id)
            .set("location", location)
            .build(),
    )
    .unwrap();
}

fn insert_online_offline(
    db: &DatabaseService,
    created_at: &str,
    user_id: &str,
    kind: &str,
    location: &str,
) {
    db.execute_non_query(
        &format!(
            "INSERT INTO {USER_PREFIX}_feed_online_offline (created_at, user_id, display_name, type, location, world_name, time, group_name)
             VALUES (@created_at, @user_id, 'Stale Name', @type, @location, '', 0, '')"
        ),
        &ParamsBuilder::new()
            .set("created_at", vrcx_0_core::time::parse_epoch_seconds(created_at))
            .set("user_id", user_id)
            .set("type", kind)
            .set("location", location)
            .build(),
    )
    .unwrap();
}

#[test]
fn world_friend_visits_counts_only_current_friends() {
    let (_dir, db) = setup("friend-visits-current-friends");
    add_friend(&db, "usr_alice", "Alice");
    insert_gps(&db, "2026-08-01T10:00:00.000Z", "usr_alice", "wrld_alpha:1");
    insert_gps(&db, "2026-08-02T10:00:00.000Z", "usr_bob", "wrld_alpha:2");

    let output = get_world_friend_visits(&db, &OwnerId::new(OWNER_USER_ID), "wrld_alpha").unwrap();

    assert_eq!(output.friend_count, 1);
    assert_eq!(output.friends.len(), 1);
    assert_eq!(output.friends[0].user_id, "usr_alice");
    assert_eq!(output.friends[0].display_name, "Alice");
    assert_eq!(output.last_visited_at, 1785578400);
}

#[test]
fn world_friend_visits_merges_gps_and_online_rows() {
    let (_dir, db) = setup("friend-visits-merge-sources");
    add_friend(&db, "usr_alice", "Alice");
    insert_gps(&db, "2026-08-01T10:00:00.000Z", "usr_alice", "wrld_alpha:1");
    insert_online_offline(
        &db,
        "2026-08-03T10:00:00.000Z",
        "usr_alice",
        "Online",
        "wrld_alpha:2",
    );
    insert_online_offline(
        &db,
        "2026-08-04T10:00:00.000Z",
        "usr_alice",
        "Offline",
        "wrld_alpha:2",
    );

    let output = get_world_friend_visits(&db, &OwnerId::new(OWNER_USER_ID), "wrld_alpha").unwrap();

    assert_eq!(output.friend_count, 1);
    assert_eq!(output.friends[0].visit_count, 2);
    assert_eq!(output.friends[0].last_visited_at, 1785751200);
}

#[test]
fn world_friend_visits_matches_world_id_boundary_exactly() {
    let (_dir, db) = setup("friend-visits-world-boundary");
    add_friend(&db, "usr_alice", "Alice");
    add_friend(&db, "usr_bob", "Bob");
    insert_gps(&db, "2026-08-01T10:00:00.000Z", "usr_alice", "wrld_alpha");
    insert_gps(&db, "2026-08-02T10:00:00.000Z", "usr_bob", "wrld_alphax:1");
    insert_gps(&db, "2026-08-03T10:00:00.000Z", "usr_bob", "wrld_alphb:1");

    let output = get_world_friend_visits(&db, &OwnerId::new(OWNER_USER_ID), "wrld_alpha").unwrap();

    assert_eq!(output.friend_count, 1);
    assert_eq!(output.friends[0].user_id, "usr_alice");
}

#[test]
fn world_friend_visits_returns_empty_for_non_world_target() {
    let (_dir, db) = setup("friend-visits-non-world");
    add_friend(&db, "usr_alice", "Alice");
    insert_gps(&db, "2026-08-01T10:00:00.000Z", "usr_alice", "wrld_alpha:1");

    let output = get_world_friend_visits(&db, &OwnerId::new(OWNER_USER_ID), "private").unwrap();

    assert_eq!(output.friend_count, 0);
    assert!(output.friends.is_empty());
    assert_eq!(output.last_visited_at, 0);
}
