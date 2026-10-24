use super::*;

fn player(user_id: &str, display_name: &str, join_time_ms: Option<i64>) -> PlayerState {
    PlayerState {
        user_id: user_id.to_string(),
        display_name: display_name.to_string(),
        join_time_ms,
    }
}

#[test]
fn snapshot_and_projection_preserve_the_current_instance_roster_contract() {
    let mut state = GameLogRuntimeState {
        current_location: "wrld_current:instance".into(),
        current_world_name: "Current World".into(),
        current_destination: "wrld_destination:instance".into(),
        current_location_started_at: 1786615200,
        ..Default::default()
    };
    for player in [
        player("usr_z", "Same Name", Some(30)),
        player("", "Anonymous", Some(10)),
        player("usr_a", "Same Name", Some(20)),
    ] {
        state
            .players_by_key
            .insert(player_key(&player.user_id, &player.display_name), player);
    }

    let snapshot = state.snapshot();

    assert_eq!(
        snapshot.players,
        vec![
            player("", "Anonymous", Some(10)),
            player("usr_a", "Same Name", Some(20)),
            player("usr_z", "Same Name", Some(30)),
        ]
    );

    let projection = state.projection(1786615500, "OnPlayerJoined");

    assert_eq!(projection.current_location, "wrld_current:instance");
    assert_eq!(projection.current_world_id, "wrld_current");
    assert_eq!(projection.current_world_name, "Current World");
    assert_eq!(projection.current_location_started_at, Some(1786615200));
    assert_eq!(projection.current_location_player_ids, ["usr_a", "usr_z"]);
    assert_eq!(projection.current_location_players, snapshot.players);
    assert_eq!(projection.last_game_log_type, "OnPlayerJoined");
}

#[test]
fn player_identity_prefers_user_id_and_falls_back_to_display_name() {
    assert_eq!(player_key("usr_alice", "Alice"), "id:usr_alice");
    assert_eq!(player_key("usr_alice", "Renamed Alice"), "id:usr_alice");
    assert_eq!(player_key("", "Anonymous Alice"), "display:Anonymous Alice");
    assert_ne!(
        player_key("", "Anonymous Alice"),
        player_key("", "Anonymous Bob")
    );
}

#[test]
fn runtime_snapshot_store_shares_reads_until_the_snapshot_changes() {
    let store = RuntimeSnapshotStore::default();
    let first = store.snapshot();
    let second = store.snapshot();

    assert!(Arc::ptr_eq(&first, &second));

    store.replace(RuntimeSnapshot {
        location: "wrld_next:instance".into(),
        ..RuntimeSnapshot::default()
    });
    let replaced = store.snapshot();

    assert!(!Arc::ptr_eq(&first, &replaced));
    assert_eq!(replaced.location, "wrld_next:instance");
    assert!(first.location.is_empty());
}

#[test]
fn leave_duration_requires_known_monotonic_event_times() {
    assert_eq!(duration_ms(Some(1_000), Some(61_000)), 60_000);
    assert_eq!(duration_ms(None, Some(61_000)), 0);
    assert_eq!(duration_ms(Some(1_000), None), 0);
    assert_eq!(duration_ms(Some(61_000), Some(1_000)), 0);
}

#[test]
fn projection_uses_absence_for_an_unknown_location_start() {
    let projection = GameLogRuntimeState::default().projection(0, "game-started");

    assert_eq!(projection.current_location_started_at, None);
    assert!(projection.current_location_player_ids.is_empty());
    assert!(projection.current_location_players.is_empty());
}

#[test]
fn stored_player_join_dates_are_seconds_and_old_milliseconds_still_load() {
    let player: PlayerState = serde_json::from_value(serde_json::json!({
        "userId": "usr_a", "displayName": "A", "joinTimeMs": 1784629815250_i64
    }))
    .unwrap();
    assert_eq!(player.join_time_ms, Some(1784629815250));
    let stored = serde_json::to_value(player).unwrap();
    assert_eq!(stored["joinTime"], 1784629815);
    assert!(stored.get("joinTimeMs").is_none());
    let restored: PlayerState = serde_json::from_value(stored).unwrap();
    assert_eq!(restored.join_time_ms, Some(1784629815000));
}
