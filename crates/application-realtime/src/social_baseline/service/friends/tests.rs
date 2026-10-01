use vrcx_0_core::friends::StateBucket;
use vrcx_0_core::presence::{Place, PresenceEntry, PresencePlace, PresenceView};

use super::*;

#[test]
fn collect_suspicious_only_targets_mismatched_or_traveling_friends() {
    let expected_ids = vec![
        "usr_online".to_string(),
        "usr_active_pc".to_string(),
        "usr_traveling".to_string(),
        "usr_offline".to_string(),
    ];
    let state_by_id = HashMap::from([
        ("usr_online".to_string(), StateBucket::Online),
        ("usr_active_pc".to_string(), StateBucket::Active),
        ("usr_traveling".to_string(), StateBucket::Online),
        ("usr_offline".to_string(), StateBucket::Offline),
    ]);
    let profile = |id: &str, platform: &str, location: &str| {
        RemoteFriendProfile::from_raw(
            json!({ "id": id, "platform": platform, "location": location }),
            None,
        )
        .expect("valid profile")
    };
    let fetched_friends_by_id = HashMap::from([
        (
            "usr_online".to_string(),
            profile("usr_online", "standalonewindows", "wrld_1:1"),
        ),
        (
            "usr_active_pc".to_string(),
            profile("usr_active_pc", "standalonewindows", "offline"),
        ),
        (
            "usr_traveling".to_string(),
            profile("usr_traveling", "standalonewindows", "traveling"),
        ),
        (
            "usr_offline".to_string(),
            profile("usr_offline", "", "offline"),
        ),
    ]);

    let suspicious =
        collect_suspicious_friend_ids(&expected_ids, &state_by_id, &fetched_friends_by_id);

    assert_eq!(
        suspicious,
        vec!["usr_active_pc".to_string(), "usr_traveling".to_string()]
    );
}

#[test]
fn collect_suspicious_flags_stale_online_friend() {
    let expected_ids = vec!["usr_stale".to_string()];
    let state_by_id = HashMap::from([("usr_stale".to_string(), StateBucket::Online)]);
    let fetched_friends_by_id = HashMap::from([(
        "usr_stale".to_string(),
        RemoteFriendProfile::from_raw(
            json!({ "id": "usr_stale", "platform": "", "location": "offline" }),
            None,
        )
        .expect("valid profile"),
    )]);

    let suspicious =
        collect_suspicious_friend_ids(&expected_ids, &state_by_id, &fetched_friends_by_id);

    assert_eq!(suspicious, vec!["usr_stale".to_string()]);
}

#[test]
fn insert_fetched_friend_collects_profile_and_prefers_online_source() {
    let mut fetched_friends_by_id = HashMap::new();
    let mut ordered = Vec::new();
    let mut seen = HashSet::new();

    insert_fetched_friend(
        &mut fetched_friends_by_id,
        &mut ordered,
        &mut seen,
        json!({ "id": "usr_friend", "state": "online", "location": "offline" }),
        Some(StateBucket::Offline),
    );
    insert_fetched_friend(
        &mut fetched_friends_by_id,
        &mut ordered,
        &mut seen,
        json!({ "id": "usr_friend", "location": "wrld_live:123" }),
        Some(StateBucket::Online),
    );

    assert_eq!(ordered, vec!["usr_friend".to_string()]);
    let profile = fetched_friends_by_id
        .get("usr_friend")
        .expect("inserted friend profile");
    assert_eq!(profile.source_state_bucket, Some(StateBucket::Online));
    assert_eq!(
        object_field_string(&profile.raw, &["location"]),
        "wrld_live:123"
    );
}

#[test]
fn fast_roster_records_use_current_user_ids_and_remote_profiles_without_friend_log() {
    let expected_ids = vec!["usr_online".to_string(), "usr_missing".to_string()];
    let state_by_id = HashMap::from([
        ("usr_online".to_string(), StateBucket::Online),
        ("usr_missing".to_string(), StateBucket::Offline),
    ]);
    let fetched_friends_by_id = HashMap::from([(
        "usr_online".to_string(),
        RemoteFriendProfile::from_raw(
            json!({
                "id": "usr_online",
                "displayName": "Online Friend",
                "location": "wrld_live:123",
                "platform": "standalonewindows",
                "tags": ["system_trust_known"]
            }),
            Some(StateBucket::Online),
        )
        .expect("valid profile"),
    )]);

    let friends_by_id =
        build_fast_roster_records(&expected_ids, &state_by_id, fetched_friends_by_id);
    assert_eq!(
        friends_by_id
            .get("usr_online")
            .and_then(|friend| object_field(friend, "displayName"))
            .and_then(Value::as_str),
        Some("Online Friend")
    );
    assert_eq!(
        friends_by_id
            .get("usr_online")
            .and_then(|friend| object_field(friend, "location"))
            .and_then(Value::as_str),
        Some("wrld_live:123")
    );
    assert_eq!(
        friends_by_id
            .get("usr_missing")
            .and_then(|friend| object_field(friend, "displayName"))
            .and_then(Value::as_str),
        Some("usr_missing")
    );
    let mut friend_ids = friends_by_id.keys().cloned().collect::<Vec<_>>();
    friend_ids.sort();
    assert_eq!(friend_ids, vec!["usr_missing", "usr_online"]);
}

#[test]
fn fast_roster_records_preserve_open_remote_profile_fields() {
    let expected_ids = vec!["usr_future".to_string()];
    let state_by_id = HashMap::from([("usr_future".to_string(), StateBucket::Online)]);
    let fetched_friends_by_id = HashMap::from([(
        "usr_future".to_string(),
        RemoteFriendProfile::from_raw(
            json!({
                "id": "usr_future",
                "displayName": "Future Friend",
                "platform": "standalonewindows",
                "futureProfile": {
                    "nested": [1, { "unknown": true }]
                }
            }),
            Some(StateBucket::Online),
        )
        .expect("valid profile"),
    )]);

    let friends_by_id =
        build_fast_roster_records(&expected_ids, &state_by_id, fetched_friends_by_id);

    assert_eq!(
        friends_by_id["usr_future"]["futureProfile"],
        json!({ "nested": [1, { "unknown": true }] })
    );
    assert_eq!(
        friends_by_id["usr_future"]["$profileSource"],
        json!("remote")
    );
}

#[test]
fn placeholder_friend_uses_realtime_list_bucket() {
    let expected_ids = vec!["usr_stale".to_string()];
    let state_by_id = HashMap::from([("usr_stale".to_string(), StateBucket::Online)]);
    let fetched_friends_by_id = HashMap::new();

    let friends_by_id =
        build_fast_roster_records(&expected_ids, &state_by_id, fetched_friends_by_id);
    let stale = friends_by_id.get("usr_stale").expect("usr_stale present");
    assert_eq!(
        object_field(stale, "state").and_then(Value::as_str),
        Some("online")
    );
    assert_eq!(
        object_field(stale, "$profileSource").and_then(Value::as_str),
        Some("placeholder")
    );
}

#[test]
fn placeholder_active_friend_is_kept_active() {
    let expected_ids = vec!["usr_active".to_string()];
    let state_by_id = HashMap::from([("usr_active".to_string(), StateBucket::Active)]);
    let fetched_friends_by_id = HashMap::new();

    let friends_by_id =
        build_fast_roster_records(&expected_ids, &state_by_id, fetched_friends_by_id);
    let active = friends_by_id.get("usr_active").expect("usr_active present");
    assert_eq!(
        object_field(active, "state").and_then(Value::as_str),
        Some("active")
    );
}

#[test]
fn online_friend_in_private_world_stays_online() {
    let expected_ids = vec!["usr_priv".to_string()];
    let state_by_id = HashMap::from([("usr_priv".to_string(), StateBucket::Online)]);
    let fetched_friends_by_id = HashMap::from([(
        "usr_priv".to_string(),
        RemoteFriendProfile::from_raw(
            json!({
                "id": "usr_priv",
                "displayName": "Priv",
                "location": "private",
                "status": "ask me"
            }),
            Some(StateBucket::Online),
        )
        .expect("valid profile"),
    )]);

    let friends_by_id =
        build_fast_roster_records(&expected_ids, &state_by_id, fetched_friends_by_id);
    let priv_friend = friends_by_id.get("usr_priv").expect("usr_priv present");
    assert_eq!(
        object_field(priv_friend, "state").and_then(Value::as_str),
        Some("online")
    );
}

#[test]
fn list_bucket_decides_state_not_location() {
    let expected_ids = vec!["usr_inworld".to_string()];
    let state_by_id = HashMap::from([("usr_inworld".to_string(), StateBucket::Offline)]);
    let fetched_friends_by_id = HashMap::from([(
        "usr_inworld".to_string(),
        RemoteFriendProfile::from_raw(
            json!({
                "id": "usr_inworld",
                "displayName": "InWorld",
                "location": "wrld_1b754e93:1",
                "status": "join me"
            }),
            Some(StateBucket::Offline),
        )
        .expect("valid profile"),
    )]);

    let friends_by_id =
        build_fast_roster_records(&expected_ids, &state_by_id, fetched_friends_by_id);
    let friend = friends_by_id
        .get("usr_inworld")
        .expect("usr_inworld present");
    assert_eq!(
        object_field(friend, "state").and_then(Value::as_str),
        Some("offline")
    );
}

#[test]
fn active_list_bucket_ignores_location() {
    let expected_ids = vec!["usr_active_inworld".to_string()];
    let state_by_id = HashMap::from([("usr_active_inworld".to_string(), StateBucket::Active)]);
    let fetched_friends_by_id = HashMap::from([(
        "usr_active_inworld".to_string(),
        RemoteFriendProfile::from_raw(
            json!({
                "id": "usr_active_inworld",
                "displayName": "ActiveInWorld",
                "location": "wrld_929c02a8:1",
                "status": "join me"
            }),
            Some(StateBucket::Active),
        )
        .expect("valid profile"),
    )]);

    let friends_by_id =
        build_fast_roster_records(&expected_ids, &state_by_id, fetched_friends_by_id);
    let friend = friends_by_id
        .get("usr_active_inworld")
        .expect("usr_active_inworld present");
    assert_eq!(
        object_field(friend, "state").and_then(Value::as_str),
        Some("active")
    );
}

#[test]
fn canonical_records_replace_roster_snapshot_and_presence() -> Result<()> {
    let mut output = SocialFriendRosterBaselineOutput {
        user_id: "usr_self".into(),
        stale: false,
        count: 1,
        detail: String::new(),
        snapshot: Some(crate::realtime::FriendRosterSnapshot {
            current_user_id: "usr_self".into(),
            friends_by_id: HashMap::from([(
                "usr_stale".to_string(),
                FriendRecord {
                    id: "usr_stale".into(),
                    ..FriendRecord::default()
                },
            )]),
            presence_by_id: HashMap::from([(
                "usr_stale".to_string(),
                PresenceEntry {
                    rev: 0,
                    view: PresenceView::Offline,
                },
            )]),
            generation: 0,
        }),
        friend_log_changed: false,
    };
    let friends_by_id = HashMap::from([
        (
            "usr_online".to_string(),
            FriendRecord {
                id: "usr_online".into(),
                display_name: "Online".into(),
                ..FriendRecord::default()
            },
        ),
        (
            "usr_offline".to_string(),
            FriendRecord {
                id: "usr_offline".into(),
                display_name: "Offline".into(),
                ..FriendRecord::default()
            },
        ),
    ]);

    let presence_by_id = HashMap::from([
        (
            "usr_online".to_string(),
            PresenceEntry {
                rev: 0,
                view: PresenceView::Online {
                    place: PresencePlace::new(&Place::Unknown),
                    platform: String::new(),
                    online_since_ms: None,
                },
            },
        ),
        (
            "usr_offline".to_string(),
            PresenceEntry {
                rev: 0,
                view: PresenceView::Offline,
            },
        ),
    ]);

    let applied = apply_friend_roster_baseline_sync_outcome(
        &mut output,
        FriendBaselineSyncOutcome::accepted(
            crate::realtime::FriendBaselineResult {
                accepted: true,
                generation: 7,
                baseline_revision: 1,
                friend_count: u32::try_from(friends_by_id.len()).unwrap_or(u32::MAX),
            },
            crate::realtime::RealtimeFriendSnapshot {
                current_user_id: "usr_self".into(),
                generation: 7,
                baseline_revision: 1,
                friends_by_id,
                presence_by_id,
                ..crate::realtime::RealtimeFriendSnapshot::default()
            },
            true,
        ),
    )
    .is_some();

    let snapshot = output.snapshot.expect("roster snapshot");
    assert!(applied);
    assert_eq!(output.count, 2);
    assert!(output.friend_log_changed);
    assert!(!snapshot.friends_by_id.contains_key("usr_stale"));
    assert!(!snapshot.presence_by_id.contains_key("usr_stale"));
    assert!(matches!(
        snapshot.presence_by_id["usr_online"].view,
        PresenceView::Online { .. }
    ));
    assert_eq!(
        snapshot.presence_by_id["usr_offline"].view,
        PresenceView::Offline
    );
    Ok(())
}

#[test]
fn canonical_records_can_be_moved_out_after_snapshot_rebuild() -> Result<()> {
    let mut output = SocialFriendRosterBaselineOutput {
        user_id: "usr_self".into(),
        stale: false,
        count: 0,
        detail: String::new(),
        snapshot: None,
        friend_log_changed: false,
    };
    let mut extra = serde_json::Map::new();
    extra.insert(
        "futureProfile".into(),
        json!({ "nested": [1, { "unknown": true }] }),
    );
    let friends_by_id = HashMap::from([(
        "usr_future".to_string(),
        FriendRecord {
            id: "usr_future".into(),
            display_name: "Future Friend".into(),
            extra,
            ..FriendRecord::default()
        },
    )]);

    let returned = apply_friend_roster_baseline_sync_outcome(
        &mut output,
        FriendBaselineSyncOutcome::accepted(
            crate::realtime::FriendBaselineResult {
                accepted: true,
                generation: 7,
                baseline_revision: 1,
                friend_count: u32::try_from(friends_by_id.len()).unwrap_or(u32::MAX),
            },
            crate::realtime::RealtimeFriendSnapshot {
                current_user_id: "usr_self".into(),
                generation: 7,
                baseline_revision: 1,
                friends_by_id,
                ..crate::realtime::RealtimeFriendSnapshot::default()
            },
            false,
        ),
    )
    .expect("accepted baseline should return canonical records");

    assert_eq!(
        returned["usr_future"].extra["futureProfile"],
        json!({ "nested": [1, { "unknown": true }] })
    );
    assert_eq!(
        output
            .snapshot
            .as_ref()
            .expect("roster snapshot")
            .friends_by_id["usr_future"]
            .extra["futureProfile"],
        json!({ "nested": [1, { "unknown": true }] })
    );
    Ok(())
}

#[test]
fn rejected_sync_outcome_clears_roster_snapshot() -> Result<()> {
    let mut output = SocialFriendRosterBaselineOutput {
        user_id: "usr_self".into(),
        stale: false,
        count: 1,
        detail: String::new(),
        snapshot: Some(crate::realtime::FriendRosterSnapshot {
            current_user_id: "usr_self".into(),
            friends_by_id: HashMap::from([(
                "usr_stale".to_string(),
                FriendRecord {
                    id: "usr_stale".into(),
                    ..FriendRecord::default()
                },
            )]),
            presence_by_id: HashMap::from([(
                "usr_stale".to_string(),
                PresenceEntry {
                    rev: 0,
                    view: PresenceView::Offline,
                },
            )]),
            generation: 0,
        }),
        friend_log_changed: true,
    };

    let applied = apply_friend_roster_baseline_sync_outcome(
        &mut output,
        FriendBaselineSyncOutcome::rejected(crate::realtime::FriendBaselineResult {
            accepted: false,
            ..crate::realtime::FriendBaselineResult::default()
        }),
    )
    .is_some();

    assert!(!applied);
    assert!(output.stale);
    assert!(output.snapshot.is_none());
    assert!(!output.friend_log_changed);
    Ok(())
}
