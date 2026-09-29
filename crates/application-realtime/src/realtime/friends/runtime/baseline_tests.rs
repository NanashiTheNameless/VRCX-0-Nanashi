#[cfg(test)]
mod tests {
    use super::super::*;

    #[test]
    fn baseline_causal_watermark_reports_baseline_identity() {
        let runtime = RealtimeFriendsRuntime::default();
        let empty = runtime.baseline_causal_watermark();
        assert_eq!(empty.generation, None);
        assert_eq!(empty.baseline_revision, None);

        runtime.set_baseline(FriendRosterBaseline::default(), 7, 3);

        let watermark = runtime.baseline_causal_watermark();
        assert_eq!(watermark.generation, Some(7));
        assert_eq!(watermark.baseline_revision, Some(3));
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
                    FriendRecord {
                        display_name: "Friend".into(),
                        state: "active".into(),
                        ..FriendRecord::default()
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
            snapshot.friends_by_id.get("usr_friend").unwrap().state,
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
                    FriendRecord {
                        state: "active".into(),
                        id: "usr_friend".into(),
                        display_name: "Friend".into(),
                        ..FriendRecord::default()
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
        assert!(runtime.current_friend_record("usr_stranger").is_none());
    }

    #[test]
    fn roster_snapshot_builds_current_json_with_stable_order() {
        let runtime = RealtimeFriendsRuntime::default();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                endpoint: "https://api.example.test".into(),
                websocket: "wss://ws.example.test".into(),
                friends_by_id: [
                    (
                        "usr_existing".to_string(),
                        FriendRecord {
                            state: "active".into(),
                            id: "usr_existing".into(),
                            ..Default::default()
                        },
                    ),
                    (
                        "usr_new".to_string(),
                        FriendRecord {
                            state: "online".into(),
                            id: "usr_new".into(),
                            ..Default::default()
                        },
                    ),
                ]
                .into_iter()
                .collect(),
            },
            7,
            3,
        );

        let projection = runtime
            .roster_snapshot(&["usr_removed".into(), "usr_existing".into()])
            .unwrap()
            .unwrap();

        assert_eq!(projection.current_user_id, "usr_self");
        assert_eq!(projection.endpoint, "https://api.example.test");
        assert_eq!(projection.websocket, "wss://ws.example.test");
        assert_eq!(projection.friend_count, 2);
        assert_eq!(
            projection.snapshot["orderedFriendIds"],
            json!(["usr_new", "usr_existing"])
        );
        assert_eq!(projection.snapshot["onlineIds"], json!(["usr_new"]));
        assert_eq!(projection.snapshot["activeIds"], json!(["usr_existing"]));
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
                        FriendRecord {
                            id: "usr_friend".into(),
                            display_name: "Friend".into(),
                            state: previous_state.into(),
                            ..FriendRecord::default()
                        },
                    )]
                    .into_iter()
                    .collect(),
                    ..FriendRosterBaseline::default()
                },
                1,
                0,
            );
            let mut next = FriendRecord {
                id: "usr_friend".into(),
                display_name: "Friend".into(),
                state: "online".into(),
                location: next_location.into(),
                ..FriendRecord::default()
            };
            if placeholder {
                next.extra
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

            let snapshot = runtime.snapshot().expect("baseline present");
            let friend = snapshot
                .friends_by_id
                .get("usr_friend")
                .expect("friend present");
            assert_eq!(
                friend.state, "online",
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
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "Friend".into(),
                        state: "offline".into(),
                        extra: [
                            ("$trustLevel".to_string(), json!("Trusted User")),
                            ("tags".to_string(), json!(["system_trust_veteran"])),
                        ]
                        .into_iter()
                        .collect(),
                        ..FriendRecord::default()
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
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "Friend".into(),
                        state: "offline".into(),
                        extra: [
                            ("$trustLevel".to_string(), json!("Visitor")),
                            ("tags".to_string(), json!([])),
                            ("$profileSource".to_string(), json!("placeholder")),
                        ]
                        .into_iter()
                        .collect(),
                        ..FriendRecord::default()
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
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "Friend".into(),
                        state: "offline".into(),
                        ..FriendRecord::default()
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
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "Friend".into(),
                        state: "offline".into(),
                        ..FriendRecord::default()
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            1,
            None,
        );

        let snapshot = runtime.snapshot().expect("baseline present");
        let friend = snapshot
            .friends_by_id
            .get("usr_friend")
            .expect("friend present");
        assert_eq!(friend.state, "online");
        assert_eq!(friend.extra.get("pendingOffline"), Some(&json!(false)));
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
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "Friend".into(),
                        state: "online".into(),
                        location: "wrld_x:1".into(),
                        ..FriendRecord::default()
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
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "usr_friend".into(),
                        state: "online".into(),
                        extra: [("$profileSource".to_string(), json!("placeholder"))]
                            .into_iter()
                            .collect(),
                        ..FriendRecord::default()
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
    fn rest_online_baseline_cancels_pending_offline_without_feed() {
        let runtime = RealtimeFriendsRuntime::default();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "Friend".into(),
                        state: "online".into(),
                        location: "wrld_1:123".into(),
                        ..FriendRecord::default()
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
        let PendingOfflineTimerAction::Schedule { token, .. } = output.timer_action else {
            panic!("offline should schedule pending timer");
        };
        let watermark = runtime.baseline_causal_watermark().friend_state_sequence;

        let effects = runtime.set_baseline_with_effects(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "Friend".into(),
                        state: "online".into(),
                        location: "wrld_2:456".into(),
                        ..FriendRecord::default()
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            1,
            Some(watermark),
        );

        let snapshot = runtime.snapshot().unwrap();
        let friend = snapshot.friends_by_id.get("usr_friend").unwrap();
        assert_eq!(friend.state, "online");
        assert_eq!(friend.location, "wrld_2:456");
        assert_eq!(friend.extra.get("pendingOffline"), Some(&json!(false)));
        assert!(effects.schedules.is_empty());
        assert!(effects.confirmed_feed_entries.is_empty());
        assert!(runtime
            .fire_pending_offline("usr_friend", token, "2026-05-15T00:03:00Z".into())
            .is_none());
    }
}
