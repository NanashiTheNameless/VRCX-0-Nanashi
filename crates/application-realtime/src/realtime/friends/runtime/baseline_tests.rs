#[cfg(test)]
mod tests {
    use super::super::presence_test_support::{friend_view, is_pending_offline, location_tag};
    use super::super::*;

    #[test]
    fn roster_revision_reports_the_baseline_identity() {
        let runtime = RealtimeFriendsRuntime::default();
        assert_eq!(runtime.roster_revision(), None);

        runtime.set_baseline(FriendRosterBaseline::default(), 7, 3);

        assert_eq!(runtime.roster_revision(), Some((7, 3)));
    }

    #[test]
    fn stores_normalized_friend_baseline() {
        let runtime = RealtimeFriendsRuntime::default();
        let result = runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: " usr_self ".into(),
                endpoint: " https://api.example.test ".into(),
                websocket: " wss://ws.example.test ".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendBaselineEntry {
                        record: FriendRecord {
                            display_name: "Friend".into(),
                            ..FriendRecord::default()
                        },
                        presence: FriendBaselinePresence {
                            state: "active".into(),
                            ..FriendBaselinePresence::default()
                        },
                    },
                )]
                .into_iter()
                .collect(),
            },
            7,
            3,
        );

        assert!(result.accepted);
        assert_eq!(result.friend_count, 1);
        assert_eq!(result.generation, 7);
        assert_eq!(result.baseline_revision, 3);
        let snapshot = runtime.snapshot().unwrap();
        assert_eq!(snapshot.current_user_id, "usr_self");
        assert_eq!(snapshot.generation, 7);
        assert_eq!(snapshot.baseline_revision, 3);
        assert_eq!(
            snapshot.presence_by_id["usr_friend"]
                .view
                .section()
                .as_str(),
            "active"
        );

        let friend_user_ids = runtime.friend_user_ids_snapshot();
        assert_eq!(friend_user_ids.len(), 1);
        assert!(friend_user_ids.contains("usr_friend"));
        assert!(std::sync::Arc::ptr_eq(
            &friend_user_ids,
            &runtime.friend_user_ids_snapshot()
        ));

        runtime.set_baseline(FriendRosterBaseline::default(), 7, 4);
        let empty_friend_user_ids = runtime.friend_user_ids_snapshot();
        assert!(!std::sync::Arc::ptr_eq(
            &friend_user_ids,
            &empty_friend_user_ids
        ));
        assert!(empty_friend_user_ids.is_empty());
    }

    #[test]
    fn current_friend_queries_read_only_the_requested_record() {
        let runtime = RealtimeFriendsRuntime::default();
        runtime.set_baseline(
            FriendRosterBaseline {
                endpoint: "https://api.example.test".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendBaselineEntry {
                        record: FriendRecord {
                            id: "usr_friend".into(),
                            display_name: "Friend".into(),
                            ..FriendRecord::default()
                        },
                        presence: FriendBaselinePresence {
                            state: "active".into(),
                            ..FriendBaselinePresence::default()
                        },
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            7,
            3,
        );

        assert!(runtime.is_current_friend(" usr_friend "));
        assert!(!runtime.is_current_friend("usr_stranger"));
        let snapshot = runtime.current_friend_record("usr_friend").unwrap();
        assert_eq!(snapshot.endpoint, "https://api.example.test");
        assert_eq!(snapshot.record.id, "usr_friend");
        assert_eq!(snapshot.record.display_name, "Friend");
        assert_eq!(snapshot.presence.section().as_str(), "active");
        assert!(runtime.current_friend_record("usr_stranger").is_none());
    }

    #[test]
    fn roster_snapshot_builds_current_json_with_presence_views() {
        let runtime = RealtimeFriendsRuntime::default();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                endpoint: "https://api.example.test".into(),
                websocket: "wss://ws.example.test".into(),
                friends_by_id: [
                    (
                        "usr_existing".to_string(),
                        FriendBaselineEntry {
                            record: FriendRecord {
                                id: "usr_existing".into(),
                                ..Default::default()
                            },
                            presence: FriendBaselinePresence {
                                state: "active".into(),
                                ..FriendBaselinePresence::default()
                            },
                        },
                    ),
                    (
                        "usr_new".to_string(),
                        FriendBaselineEntry {
                            record: FriendRecord {
                                id: "usr_new".into(),
                                ..Default::default()
                            },
                            presence: FriendBaselinePresence {
                                state: "online".into(),
                                ..FriendBaselinePresence::default()
                            },
                        },
                    ),
                ]
                .into_iter()
                .collect(),
            },
            7,
            3,
        );

        let projection = runtime.roster_snapshot().unwrap();
        let snapshot = serde_json::to_value(&projection.snapshot).unwrap();

        assert_eq!(projection.current_user_id, "usr_self");
        assert_eq!(projection.endpoint, "https://api.example.test");
        assert_eq!(projection.websocket, "wss://ws.example.test");
        assert_eq!(projection.friend_count, 2);
        assert_eq!(
            snapshot["presenceById"]["usr_new"]["view"]["kind"],
            "online"
        );
        assert_eq!(
            snapshot["presenceById"]["usr_existing"]["view"]["kind"],
            "active"
        );
    }

    #[test]
    fn baseline_generation_uses_realtime_transport_generation_after_clear() {
        let runtime = RealtimeFriendsRuntime::default();
        runtime.clear();

        let result = runtime.set_baseline(FriendRosterBaseline::default(), 1, 0);

        assert!(result.accepted);
        assert_eq!(result.generation, 1);
        assert_eq!(runtime.snapshot().unwrap().generation, 1);
    }

    #[test]
    fn baseline_refresh_follows_official_list_state() {
        for (previous_state, next_location, placeholder) in [
            ("active", "", true),
            ("offline", "", true),
            ("active", "wrld_929c02a8:1", false),
        ] {
            let runtime = RealtimeFriendsRuntime::default();
            runtime.set_baseline(
                FriendRosterBaseline {
                    current_user_id: "usr_self".into(),
                    friends_by_id: [(
                        "usr_friend".to_string(),
                        FriendBaselineEntry {
                            record: FriendRecord {
                                id: "usr_friend".into(),
                                display_name: "Friend".into(),
                                ..FriendRecord::default()
                            },
                            presence: FriendBaselinePresence {
                                state: previous_state.into(),
                                ..FriendBaselinePresence::default()
                            },
                        },
                    )]
                    .into_iter()
                    .collect(),
                    ..FriendRosterBaseline::default()
                },
                1,
                0,
            );
            let mut next = FriendBaselineEntry {
                record: FriendRecord {
                    id: "usr_friend".into(),
                    display_name: "Friend".into(),
                    ..FriendRecord::default()
                },
                presence: FriendBaselinePresence {
                    state: "online".into(),
                    location: next_location.into(),
                    ..FriendBaselinePresence::default()
                },
            };
            if placeholder {
                next.record
                    .extra
                    .insert("$profileSource".to_string(), json!("placeholder"));
            }
            runtime.set_baseline(
                FriendRosterBaseline {
                    current_user_id: "usr_self".into(),
                    friends_by_id: [("usr_friend".to_string(), next)].into_iter().collect(),
                    ..FriendRosterBaseline::default()
                },
                1,
                1,
            );

            assert_eq!(
                friend_view(&runtime, "usr_friend").section().as_str(),
                "online",
                "{previous_state} -> online (placeholder: {placeholder})"
            );
        }
    }

    #[test]
    fn placeholder_baseline_refresh_keeps_existing_trust() {
        let runtime = RealtimeFriendsRuntime::default();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendBaselineEntry {
                        record: FriendRecord {
                            id: "usr_friend".into(),
                            display_name: "Friend".into(),
                            extra: [
                                ("$trustLevel".to_string(), json!("Trusted User")),
                                ("tags".to_string(), json!(["system_trust_veteran"])),
                            ]
                            .into_iter()
                            .collect(),
                            ..FriendRecord::default()
                        },
                        presence: FriendBaselinePresence {
                            state: "offline".into(),
                            ..FriendBaselinePresence::default()
                        },
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            0,
        );
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendBaselineEntry {
                        record: FriendRecord {
                            id: "usr_friend".into(),
                            display_name: "Friend".into(),
                            extra: [
                                ("$trustLevel".to_string(), json!("Visitor")),
                                ("tags".to_string(), json!([])),
                                ("$profileSource".to_string(), json!("placeholder")),
                            ]
                            .into_iter()
                            .collect(),
                            ..FriendRecord::default()
                        },
                        presence: FriendBaselinePresence {
                            state: "offline".into(),
                            ..FriendBaselinePresence::default()
                        },
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            1,
        );

        let snapshot = runtime.snapshot().expect("baseline present");
        let friend = snapshot
            .friends_by_id
            .get("usr_friend")
            .expect("friend present");
        assert_eq!(
            friend.extra.get("$trustLevel"),
            Some(&json!("Trusted User"))
        );
        assert_eq!(
            friend.extra.get("tags"),
            Some(&json!(["system_trust_veteran"]))
        );
    }

    #[test]
    fn unwatermarked_baseline_preserves_inflight_ws_state() {
        let runtime = RealtimeFriendsRuntime::default();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendBaselineEntry {
                        record: FriendRecord {
                            id: "usr_friend".into(),
                            display_name: "Friend".into(),
                            ..FriendRecord::default()
                        },
                        presence: FriendBaselinePresence {
                            state: "offline".into(),
                            ..FriendBaselinePresence::default()
                        },
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            0,
        );
        let RealtimeFriendApplyResult::Output(_) =
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
                json: json!({
                    "type": "friend-online",
                    "content": {
                        "userId": "usr_friend",
                        "location": "wrld_x:1",
                        "user": { "id": "usr_friend", "location": "wrld_x:1" }
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:01Z".into(),
            })
        else {
            panic!("friend-online should produce an output");
        };
        let effects = runtime.set_baseline_with_effects(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendBaselineEntry {
                        record: FriendRecord {
                            id: "usr_friend".into(),
                            display_name: "Friend".into(),
                            ..FriendRecord::default()
                        },
                        presence: FriendBaselinePresence {
                            state: "offline".into(),
                            ..FriendBaselinePresence::default()
                        },
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            1,
            None,
            1_800_000_000_000,
        );

        let friend = friend_view(&runtime, "usr_friend");
        assert_eq!(friend.section().as_str(), "online");
        assert!(!is_pending_offline(&friend));
        assert!(effects.schedules.is_empty());
    }

    #[test]
    fn placeholder_keeps_existing_display_name_not_id() {
        let runtime = RealtimeFriendsRuntime::default();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendBaselineEntry {
                        record: FriendRecord {
                            id: "usr_friend".into(),
                            display_name: "Friend".into(),
                            ..FriendRecord::default()
                        },
                        presence: FriendBaselinePresence {
                            state: "online".into(),
                            location: "wrld_x:1".into(),
                            ..FriendBaselinePresence::default()
                        },
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            0,
        );
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendBaselineEntry {
                        record: FriendRecord {
                            id: "usr_friend".into(),
                            display_name: "usr_friend".into(),
                            extra: [("$profileSource".to_string(), json!("placeholder"))]
                                .into_iter()
                                .collect(),
                            ..FriendRecord::default()
                        },
                        presence: FriendBaselinePresence {
                            state: "online".into(),
                            ..FriendBaselinePresence::default()
                        },
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            1,
        );

        let snapshot = runtime.snapshot().expect("baseline present");
        let friend = snapshot
            .friends_by_id
            .get("usr_friend")
            .expect("friend present");
        assert_eq!(friend.display_name, "Friend");
    }

    #[test]
    fn rest_online_baseline_keeps_a_live_pending_and_requests_refetch() {
        let runtime = RealtimeFriendsRuntime::default();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendBaselineEntry {
                        record: FriendRecord {
                            id: "usr_friend".into(),
                            display_name: "Friend".into(),
                            ..FriendRecord::default()
                        },
                        presence: FriendBaselinePresence {
                            state: "online".into(),
                            location: "wrld_1:123".into(),
                            ..FriendBaselinePresence::default()
                        },
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            0,
        );

        let RealtimeFriendApplyResult::Output(output) =
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
                json: json!({
                    "type": "friend-offline",
                    "content": { "userId": "usr_friend" }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:00Z".into(),
            })
        else {
            panic!("friend-offline should produce an output");
        };
        assert!(
            output.wake.is_some(),
            "offline should schedule pending timer"
        );
        let watermark = runtime.friend_rev();

        let effects = runtime.set_baseline_with_effects(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendBaselineEntry {
                        record: FriendRecord {
                            id: "usr_friend".into(),
                            display_name: "Friend".into(),
                            ..FriendRecord::default()
                        },
                        presence: FriendBaselinePresence {
                            state: "online".into(),
                            location: "wrld_2:456".into(),
                            ..FriendBaselinePresence::default()
                        },
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            1,
            Some(watermark),
            1_800_000_000_000,
        );

        let friend = friend_view(&runtime, "usr_friend");
        assert_eq!(friend.section().as_str(), "online");
        assert_eq!(location_tag(&friend), Some("wrld_1:123"));
        assert!(is_pending_offline(&friend));
        assert!(effects.presence_feed_entries.is_empty());
        assert_eq!(effects.profile_refetch_user_ids, vec!["usr_friend"]);
        let fired = runtime
            .wake("usr_friend", "2026-05-15T00:03:00Z")
            .expect("the live pending still finalizes");
        assert_eq!(
            fired.persistence.feed_entries[0].to_json()["type"],
            "Offline"
        );
    }

    #[test]
    fn new_generation_baseline_rearms_a_kept_pending_timer() {
        let runtime = RealtimeFriendsRuntime::default();
        runtime.set_baseline(single_friend_baseline("online", "wrld_1:123"), 1, 0);
        let RealtimeFriendApplyResult::Output(output) =
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
                json: json!({
                    "type": "friend-offline",
                    "content": { "userId": "usr_friend" }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:00Z".into(),
            })
        else {
            panic!("friend-offline should produce an output");
        };
        let at_ms = output.wake.expect("pending timer").at_ms;
        let received_ms = chrono::DateTime::parse_from_rfc3339("2026-05-15T00:00:00Z")
            .expect("valid timestamp")
            .timestamp_millis();

        let effects = runtime.set_baseline_with_effects(
            single_friend_baseline("online", "wrld_1:123"),
            2,
            0,
            None,
            received_ms + 60_000,
        );

        assert!(is_pending_offline(&friend_view(&runtime, "usr_friend")));
        assert_eq!(effects.schedules.len(), 1);
        assert_eq!(effects.schedules[0].user_id, "usr_friend");
        assert_eq!(effects.schedules[0].at_ms, at_ms);
    }

    fn single_friend_baseline(state: &str, location: &str) -> FriendRosterBaseline {
        FriendRosterBaseline {
            current_user_id: "usr_self".into(),
            friends_by_id: [(
                "usr_friend".to_string(),
                FriendBaselineEntry {
                    record: FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "Friend".into(),
                        ..FriendRecord::default()
                    },
                    presence: FriendBaselinePresence {
                        state: state.into(),
                        location: location.into(),
                        ..FriendBaselinePresence::default()
                    },
                },
            )]
            .into_iter()
            .collect(),
            ..FriendRosterBaseline::default()
        }
    }

    #[test]
    fn baseline_announces_joining_once_per_generation() {
        let traveling = || {
            let mut baseline = single_friend_baseline("online", "traveling");
            if let Some(entry) = baseline.friends_by_id.get_mut("usr_friend") {
                entry.presence.traveling_to_location = "wrld_2:456".into();
            }
            baseline
        };
        let joining_user_ids = |effects: &state::FriendBaselineEffects| {
            effects
                .joining_feed_entries
                .iter()
                .map(|entry| {
                    let entry = entry.to_json();
                    assert_eq!(entry["type"], "OnPlayerJoining");
                    entry["userId"].as_str().unwrap_or_default().to_string()
                })
                .collect::<Vec<_>>()
        };
        let runtime = RealtimeFriendsRuntime::default();
        let settled = runtime.set_baseline_with_effects(
            single_friend_baseline("online", "wrld_1:123"),
            1,
            0,
            None,
            1_800_000_000_000,
        );
        assert!(joining_user_ids(&settled).is_empty());

        let departed =
            runtime.set_baseline_with_effects(traveling(), 1, 1, None, 1_800_000_001_000);
        assert_eq!(joining_user_ids(&departed), ["usr_friend"]);

        let still_traveling =
            runtime.set_baseline_with_effects(traveling(), 1, 2, None, 1_800_000_002_000);
        assert!(joining_user_ids(&still_traveling).is_empty());

        let reconnected =
            runtime.set_baseline_with_effects(traveling(), 2, 0, None, 1_800_000_003_000);
        assert_eq!(joining_user_ids(&reconnected), ["usr_friend"]);
    }

    #[test]
    fn baseline_for_another_session_rebuilds_without_presence_feed() {
        let runtime = RealtimeFriendsRuntime::default();
        runtime.set_baseline(single_friend_baseline("offline", "offline"), 1, 0);
        let mut other_account = single_friend_baseline("online", "wrld_2:456");
        other_account.current_user_id = "usr_other".into();

        let effects =
            runtime.set_baseline_with_effects(other_account, 2, 0, None, 1_800_000_000_000);

        assert_eq!(
            friend_view(&runtime, "usr_friend").section().as_str(),
            "online"
        );
        assert!(effects.presence_feed_entries.is_empty());
    }

    #[test]
    fn same_session_baseline_after_reconnect_merges_as_evidence() {
        let runtime = RealtimeFriendsRuntime::default();
        runtime.set_baseline(single_friend_baseline("offline", "offline"), 1, 0);

        let effects = runtime.set_baseline_with_effects(
            single_friend_baseline("online", "wrld_2:456"),
            2,
            0,
            None,
            1_800_000_000_000,
        );

        assert_eq!(effects.presence_feed_entries.len(), 1);
        assert_eq!(effects.presence_feed_entries[0].to_json()["type"], "Online");
    }

    #[test]
    fn patches_and_roster_snapshots_carry_versioned_presence_views() {
        let runtime = RealtimeFriendsRuntime::default();
        runtime.set_baseline(single_friend_baseline("offline", "offline"), 1, 0);

        let RealtimeFriendApplyResult::Output(output) =
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
                json: json!({
                    "type": "friend-online",
                    "content": { "userId": "usr_friend", "location": "wrld_a:1", "platform": "android" }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:00Z".into(),
            })
        else {
            panic!("friend-online should produce an output");
        };
        let presence = serde_json::to_value(&output.projection.patches[0].presence).unwrap();
        assert!(presence["rev"].as_u64().unwrap() > 0);
        assert_eq!(presence["view"]["kind"], "online");
        assert_eq!(presence["view"]["place"]["location"]["tag"], "wrld_a:1");
        assert_eq!(presence["view"]["platform"], "android");

        let snapshot = runtime.roster_snapshot().unwrap().snapshot;
        let snapshot = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(snapshot["presenceById"]["usr_friend"], presence);
        assert_eq!(snapshot["generation"], 1);
        let current = runtime.current_friend_record("usr_friend").unwrap();
        assert_eq!(current.presence.section().as_str(), "online");
        assert_eq!(current.presence.platform(), "android");
        runtime.clear();
        assert!(runtime.current_friend_record("usr_friend").is_none());
    }
}
