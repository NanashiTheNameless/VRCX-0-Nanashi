use super::test_support::*;
use super::*;
use crate::database::DatabaseService;
use crate::ownership::OwnerId;

fn insert_location(db: &DatabaseService, created_at: &str, location: &str, millis: i64) {
    db.execute_non_query(
        "INSERT INTO gamelog_location (created_at, location, world_id, world_name, time, group_name)
         VALUES (@created_at, @location, @world_id, @world_name, @time, '')",
        &crate::common::ParamsBuilder::new()
            .set("created_at", vrcx_0_core::time::parse_epoch_seconds(created_at))
            .set("location", location)
            .set("world_id", location.split(':').next().unwrap_or_default().to_string())
            .set("world_name", format!("World {location}"))
            .set("time", millis)
            .build(),
    )
    .unwrap();
}

fn timeline(db: &DatabaseService, at: &str) -> VisitTimelineOutput {
    get_visit_timeline(
        db,
        VisitTimelineInput {
            owner_user_id: OwnerId::new("usr_me"),
            at: at.into(),
            location: None,
            limit: None,
        },
    )
    .unwrap()
}

fn seed_two_visits(db: &DatabaseService) {
    insert_location(db, "2026-06-01T20:00:00.000Z", "wrld_a:1", 3_600_000);
    insert_location(db, "2026-06-01T21:30:00.000Z", "wrld_b:2", 0);
    // Alice was already inside, leaves, comes back; Bob joins once and stays past
    // our own leave; my own join row is excluded; Carol belongs to the next visit.
    insert_join_leave(
        db,
        "2026-06-01T20:00:00.000Z",
        "OnPlayerJoined",
        "Me",
        "usr_me",
        "wrld_a:1",
        0,
    );
    insert_join_leave(
        db,
        "2026-06-01T20:10:00.000Z",
        "OnPlayerLeft",
        "Alice",
        "usr_alice",
        "wrld_a:1",
        0,
    );
    insert_join_leave(
        db,
        "2026-06-01T20:20:00.000Z",
        "OnPlayerJoined",
        "Alice",
        "usr_alice",
        "wrld_a:1",
        0,
    );
    insert_join_leave(
        db,
        "2026-06-01T20:50:00.000Z",
        "OnPlayerLeft",
        "Alice",
        "usr_alice",
        "wrld_a:1",
        0,
    );
    insert_join_leave(
        db,
        "2026-06-01T20:30:00.000Z",
        "OnPlayerJoined",
        "Bob",
        "usr_bob",
        "",
        0,
    );
    insert_join_leave(
        db,
        "2026-06-01T21:30:00.000Z",
        "OnPlayerJoined",
        "Carol",
        "usr_carol",
        "wrld_b:2",
        0,
    );
}

#[test]
fn visit_timeline_reconstructs_exact_bounds_and_per_person_stints() {
    let (_dir, db) = test_db("visit-timeline");
    create_game_log_tables(&db);
    seed_two_visits(&db);

    let output = timeline(&db, "2026-06-01T20:35:00.000Z");

    let visit = output.visit.unwrap();
    assert_eq!(visit.location, "wrld_a:1");
    assert_eq!(visit.joined_at, "2026-06-01T20:00:00.000Z");
    assert_eq!(visit.left_at.as_deref(), Some("2026-06-01T21:00:00.000Z"));
    assert_eq!(visit.stay_minutes, 60);
    assert!(!visit.in_progress);
    assert_eq!(output.people_observed, 2);
    assert!(!output.truncated);

    let alice = output
        .roster
        .iter()
        .find(|row| row.user_id == "usr_alice")
        .unwrap();
    assert_eq!(alice.stints.len(), 2);
    assert_eq!(alice.stints[0].joined_at, None);
    assert_eq!(
        alice.stints[0].left_at.as_deref(),
        Some("2026-06-01T20:10:00.000Z")
    );
    assert_eq!(
        alice.stints[1].joined_at.as_deref(),
        Some("2026-06-01T20:20:00.000Z")
    );
    assert_eq!(alice.shared_minutes, 30);
    assert_eq!(
        alice.first_joined_at.as_deref(),
        Some("2026-06-01T20:20:00.000Z")
    );
    assert_eq!(
        alice.last_left_at.as_deref(),
        Some("2026-06-01T20:50:00.000Z")
    );

    let bob = output
        .roster
        .iter()
        .find(|row| row.user_id == "usr_bob")
        .unwrap();
    assert_eq!(bob.stints.len(), 1);
    assert_eq!(bob.stints[0].left_at, None);
    assert_eq!(bob.shared_minutes, 30);
    assert!(output.roster.iter().all(|row| row.user_id != "usr_carol"));
    assert!(output.summary.starts_with("You were in World wrld_a:1 from 2026-06-01T20:00:00.000Z to 2026-06-01T21:00:00.000Z (1h); 2 people observed."));
    assert!(output.summary.contains("Alice (30m)"));
}

#[test]
fn visit_timeline_accepts_the_visited_at_from_search_worlds_visited() {
    let (_dir, db) = test_db("visit-timeline-visited-at");
    create_game_log_tables(&db);
    seed_two_visits(&db);

    let output = timeline(&db, "2026-06-01T20:00:00.000Z");

    assert_eq!(output.visit.unwrap().location, "wrld_a:1");
    assert_eq!(output.people_observed, 2);
}

#[test]
fn visit_timeline_marks_the_current_visit_in_progress_without_left_at() {
    let (_dir, db) = test_db("visit-timeline-in-progress");
    create_game_log_tables(&db);
    seed_two_visits(&db);

    let output = timeline(&db, "2026-06-01T22:00:00.000Z");

    let visit = output.visit.unwrap();
    assert_eq!(visit.location, "wrld_b:2");
    assert!(visit.in_progress);
    assert_eq!(visit.left_at, None);
    let carol = &output.roster[0];
    assert_eq!(carol.display_name, "Carol");
    assert_eq!(carol.shared_minutes, 0);
    assert!(output.summary.contains("still there"));
}

#[test]
fn visit_timeline_reports_gaps_between_visits_instead_of_guessing() {
    let (_dir, db) = test_db("visit-timeline-gap");
    create_game_log_tables(&db);
    seed_two_visits(&db);

    let output = timeline(&db, "2026-06-01T21:15:00.000Z");

    assert!(output.visit.is_none());
    assert!(output
        .summary
        .contains("nearest earlier visit ended at 2026-06-01T21:00:00.000Z"));

    let before_any = timeline(&db, "2026-05-01T00:00:00.000Z");
    assert!(before_any.visit.is_none());
    assert!(before_any.summary.contains("No visit"));
}

#[test]
fn visit_timeline_caps_the_roster_and_keeps_the_total_count() {
    let (_dir, db) = test_db("visit-timeline-cap");
    create_game_log_tables(&db);
    insert_location(&db, "2026-06-01T20:00:00.000Z", "wrld_a:1", 3_600_000);
    for index in 0..5 {
        insert_join_leave(
            &db,
            &format!("2026-06-01T20:0{index}:00.000Z"),
            "OnPlayerJoined",
            &format!("Player {index}"),
            &format!("usr_{index}"),
            "wrld_a:1",
            0,
        );
    }

    let output = get_visit_timeline(
        &db,
        VisitTimelineInput {
            owner_user_id: OwnerId::new("usr_me"),
            at: "2026-06-01T20:30:00.000Z".into(),
            location: Some("wrld_a:1".into()),
            limit: Some(2),
        },
    )
    .unwrap();

    assert_eq!(output.roster.len(), 2);
    assert_eq!(output.people_observed, 5);
    assert!(output.truncated);
    assert_eq!(output.roster[0].display_name, "Player 0");
}
