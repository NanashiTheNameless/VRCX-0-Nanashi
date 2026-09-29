#[cfg(test)]
mod tests {
    use super::super::*;
    use crate::realtime::FriendIconChange;

    fn runtime_with_friend(record: FriendRecord) -> RealtimeFriendsRuntime {
        let runtime = RealtimeFriendsRuntime::default();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [("usr_friend".to_string(), record)].into_iter().collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            0,
        );
        runtime
    }

    fn empty_runtime() -> RealtimeFriendsRuntime {
        let runtime = RealtimeFriendsRuntime::default();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                ..FriendRosterBaseline::default()
            },
            1,
            0,
        );
        runtime
    }

    fn ws(json: Value) -> RealtimeWsMessagePayload {
        RealtimeWsMessagePayload {
            json,
            raw: "{}".into(),
            received_at: "2026-05-15T00:00:00Z".into(),
        }
    }

    fn friend_record(state: &str, location: &str) -> FriendRecord {
        FriendRecord {
            id: "usr_friend".into(),
            display_name: "Friend".into(),
            state: state.into(),
            location: location.into(),
            ..FriendRecord::default()
        }
    }

    fn snapshot_friend(runtime: &RealtimeFriendsRuntime) -> FriendRecord {
        runtime
            .snapshot()
            .unwrap()
            .friends_by_id
            .get("usr_friend")
            .cloned()
            .unwrap()
    }

    #[test]
    fn friend_online_presence_from_content_profile_from_user_ignores_garbage_state() {
        let runtime = runtime_with_friend(friend_record("offline", "offline"));

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-online",
            "content": {
                "userId": "usr_friend",
                "location": "wrld_home:42~region(jp)",
                "travelingToLocation": "",
                "worldId": "wrld_home",
                "platform": "standalonewindows",
                "canRequestInvite": false,
                "user": {
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "state": "offline",
                    "status": "join me",
                    "statusDescription": "come vibe",
                    "tags": ["system_trust_veteran"],
                    "last_platform": "standalonewindows"
                }
            }
        }))) else {
            panic!("friend-online should produce an output");
        };

        let patch = &output.projection.patches[0];
        assert_eq!(patch.patch.state, "online");
        assert_eq!(patch.patch.location, "wrld_home:42~region(jp)");
        assert_eq!(patch.patch.world_id, "wrld_home");
        assert_eq!(patch.patch.platform, "standalonewindows");
        assert_eq!(patch.patch.status, "join me");
        assert_eq!(patch.patch.status_description, "come vibe");
        assert_eq!(patch.patch.display_name, "Friend");
        assert_eq!(patch.patch.extra["$trustLevel"], "Trusted User");
        assert!(output
            .persistence
            .feed_entries
            .iter()
            .any(|entry| entry.to_json()["type"] == "Online"));

        let friend = snapshot_friend(&runtime);
        assert_eq!(friend.state, "online");
        assert_eq!(friend.location, "wrld_home:42~region(jp)");
    }

    #[test]
    fn friend_online_traveling_splits_location_sentinel_and_destination() {
        let runtime = runtime_with_friend(friend_record("offline", "offline"));

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-online",
            "content": {
                "userId": "usr_friend",
                "location": "traveling",
                "travelingToLocation": "wrld_dest:7~region(us)",
                "worldId": "wrld_dest",
                "platform": "standalonewindows",
                "user": {
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "state": "offline"
                }
            }
        }))) else {
            panic!("friend-online should produce an output");
        };

        let patch = &output.projection.patches[0];
        assert_eq!(patch.patch.state, "online");
        assert_eq!(patch.patch.location, "traveling");
        assert_eq!(patch.patch.traveling_to_location, "wrld_dest:7~region(us)");
        assert!(output
            .projection
            .feed_entries
            .iter()
            .any(|entry| entry.to_json()["type"] == "OnPlayerJoining"));

        let friend = snapshot_friend(&runtime);
        assert_eq!(friend.location, "traveling");
        assert_eq!(friend.traveling_to_location, "wrld_dest:7~region(us)");
    }

    #[test]
    fn friend_location_with_embedded_user_updates_location_and_profile() {
        let mut baseline = friend_record("online", "wrld_old:1~region(jp)");
        baseline.status = "active".into();
        let runtime = runtime_with_friend(baseline);

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-location",
            "content": {
                "userId": "usr_friend",
                "location": "wrld_new:2~region(jp)",
                "travelingToLocation": "",
                "worldId": "wrld_new",
                "platform": "standalonewindows",
                "canRequestInvite": false,
                "user": {
                    "id": "usr_friend",
                    "displayName": "New Name",
                    "state": "offline",
                    "status": "join me"
                }
            }
        }))) else {
            panic!("friend-location should produce an output");
        };

        let patch = &output.projection.patches[0];
        assert_eq!(patch.patch.state, "online");
        assert_eq!(
            patch.state_bucket_authority,
            FriendStateBucketAuthority::Explicit
        );
        assert_eq!(patch.patch.location, "wrld_new:2~region(jp)");
        assert_eq!(patch.patch.status, "join me");
        assert_eq!(patch.patch.display_name, "New Name");
        assert!(output
            .persistence
            .feed_entries
            .iter()
            .any(|entry| entry.to_json()["type"] == "GPS"));

        let friend = snapshot_friend(&runtime);
        assert_eq!(friend.location, "wrld_new:2~region(jp)");
        assert_eq!(friend.status, "join me");
    }

    #[test]
    fn friend_update_embedded_user_owns_icon_url() {
        let mut baseline = friend_record("online", "wrld_old:1~region(jp)");
        baseline.icon_url = "https://api.vrchat.cloud/api/1/image/file_old/1/256".into();
        let runtime = runtime_with_friend(baseline);

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-update",
            "content": {
                "userId": "usr_friend",
                "user": {
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "iconUrl": "https://api.vrchat.cloud/api/1/image/file_new/2/256",
                    "iconFrame": "invt_frame"
                }
            }
        }))) else {
            panic!("friend-update should produce an output");
        };

        let patch = &output.projection.patches[0];
        assert_eq!(
            patch.patch.icon_url,
            "https://api.vrchat.cloud/api/1/image/file_new/2/256"
        );
        assert!(!patch.patch.extra.contains_key("iconUrl"));

        let friend = snapshot_friend(&runtime);
        assert_eq!(
            friend.icon_url,
            "https://api.vrchat.cloud/api/1/image/file_new/2/256"
        );
        assert!(!friend.extra.contains_key("iconUrl"));
        assert_eq!(
            friend.extra.get("iconFrame"),
            Some(&Value::String("invt_frame".into()))
        );
    }

    #[test]
    fn friend_location_top_level_traveling_overrides_stale_embedded_location() {
        let runtime = runtime_with_friend(friend_record("online", "wrld_old:1~region(jp)"));

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-location",
            "content": {
                "userId": "usr_friend",
                "location": "traveling",
                "travelingToLocation": "wrld_dest:7~region(us)",
                "worldId": "wrld_dest",
                "user": {
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "state": "offline",
                    "location": "wrld_old:1~region(jp)",
                    "travelingToLocation": "wrld_old:1~region(jp)",
                    "worldId": "wrld_old"
                }
            }
        }))) else {
            panic!("friend-location should produce an output");
        };

        let patch = &output.projection.patches[0];
        assert_eq!(patch.patch.location, "traveling");
        assert_eq!(patch.patch.traveling_to_location, "wrld_dest:7~region(us)");
        assert_eq!(patch.patch.world_id, "wrld_dest");

        let friend = snapshot_friend(&runtime);
        assert_eq!(friend.location, "traveling");
        assert_eq!(friend.traveling_to_location, "wrld_dest:7~region(us)");
        assert_eq!(friend.world_id, "wrld_dest");
    }

    #[test]
    fn friend_location_top_level_presence_ignores_stale_embedded_presence_fields() {
        let runtime = runtime_with_friend(friend_record("online", "traveling"));

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-location",
            "content": {
                "userId": "usr_friend",
                "location": "wrld_new:2~region(jp)",
                "travelingToLocation": "",
                "user": {
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "state": "offline",
                    "location": "traveling",
                    "travelingToLocation": "wrld_old:1~region(jp)",
                    "worldId": "wrld_old"
                }
            }
        }))) else {
            panic!("friend-location should produce an output");
        };

        let patch = &output.projection.patches[0].patch;
        assert_eq!(patch.location, "wrld_new:2~region(jp)");
        assert!(patch.traveling_to_location.is_empty());
        assert_eq!(patch.world_id, "wrld_new");

        let friend = snapshot_friend(&runtime);
        assert_eq!(friend.location, "wrld_new:2~region(jp)");
        assert!(friend.traveling_to_location.is_empty());
        assert_eq!(friend.world_id, "wrld_new");
    }

    #[test]
    fn friend_location_without_user_updates_location_from_content_top_level() {
        let runtime = runtime_with_friend(friend_record("online", "wrld_old:1~region(jp)"));

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-location",
            "content": {
                "userId": "usr_friend",
                "location": "wrld_new:2~region(jp)"
            }
        }))) else {
            panic!("friend-location should produce an output");
        };

        let patch = &output.projection.patches[0];
        assert_eq!(patch.patch.state, "online");
        assert_eq!(
            patch.state_bucket_authority,
            FriendStateBucketAuthority::Preserve
        );
        assert_eq!(patch.patch.location, "wrld_new:2~region(jp)");
        assert!(output
            .persistence
            .feed_entries
            .iter()
            .any(|entry| entry.to_json()["type"] == "GPS"));

        assert_eq!(snapshot_friend(&runtime).location, "wrld_new:2~region(jp)");
    }

    #[test]
    fn friend_active_from_offline_sets_active_bucket_offline_sentinel_and_profile() {
        let runtime = runtime_with_friend(friend_record("offline", "offline"));

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-active",
            "content": {
                "userId": "usr_friend",
                "platform": "standalonewindows",
                "user": {
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "state": "offline",
                    "status": "busy"
                }
            }
        }))) else {
            panic!("friend-active should produce an output");
        };

        let patch = &output.projection.patches[0];
        assert_eq!(patch.patch.state, "active");
        assert_eq!(patch.patch.location, "offline");
        assert_eq!(patch.patch.status, "busy");
        assert_eq!(patch.patch.display_name, "Friend");

        let friend = snapshot_friend(&runtime);
        assert_eq!(friend.state, "active");
        assert_eq!(friend.location, "offline");
        assert_eq!(friend.status, "busy");
    }

    #[test]
    fn friend_offline_without_user_debounces_and_preserves_profile() {
        let mut baseline = friend_record("online", "wrld_1:123~region(jp)");
        baseline.status = "join me".into();
        let runtime = runtime_with_friend(baseline);

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-offline",
            "content": {
                "userId": "usr_friend",
                "platform": "standalonewindows"
            }
        }))) else {
            panic!("friend-offline should produce an output");
        };

        let patch = &output.projection.patches[0];
        assert_eq!(patch.patch.state, "online");
        assert_eq!(patch.patch.extra["pendingOffline"], true);
        assert!(output.persistence.feed_entries.is_empty());
        let PendingOfflineTimerAction::Schedule { token, .. } = output.timer_action else {
            panic!("online->offline should schedule a pending-offline timer");
        };

        let debounced = snapshot_friend(&runtime);
        assert_eq!(debounced.state, "online");
        assert_eq!(debounced.status, "join me");
        assert_eq!(debounced.location, "wrld_1:123~region(jp)");

        let fired = runtime
            .fire_pending_offline("usr_friend", token, "2026-05-15T00:03:00Z".into())
            .unwrap();
        assert_eq!(fired.projection.patches[0].patch.state, "offline");
        assert_eq!(snapshot_friend(&runtime).status, "join me");
    }

    #[test]
    fn friend_update_is_profile_only_and_ignores_garbage_state() {
        let mut baseline = friend_record("online", "wrld_1:123~region(jp)");
        baseline.status = "join me".into();
        baseline.status_description = "old".into();
        let runtime = runtime_with_friend(baseline);

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-update",
            "content": {
                "userId": "usr_friend",
                "user": {
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "state": "offline",
                    "status": "active",
                    "statusDescription": "fresh"
                }
            }
        }))) else {
            panic!("friend-update should produce an output");
        };

        let patch = &output.projection.patches[0];
        assert_eq!(patch.patch.state, "online");
        assert_eq!(patch.patch.location, "wrld_1:123~region(jp)");
        assert_eq!(patch.patch.status, "active");
        assert_eq!(patch.patch.status_description, "fresh");

        let friend = snapshot_friend(&runtime);
        assert_eq!(friend.state, "online");
        assert_eq!(friend.location, "wrld_1:123~region(jp)");
    }

    #[test]
    fn friend_add_ws_shape_does_not_trust_embedded_state() {
        let runtime = empty_runtime();

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-add",
            "content": {
                "userId": "usr_friend",
                "user": {
                    "id": "usr_friend",
                    "displayName": "Added",
                    "state": "online"
                }
            }
        }))) else {
            panic!("friend-add should produce an output");
        };

        let patch = &output.projection.patches[0];
        assert_eq!(patch.patch.state, "offline");
        assert_eq!(output.persistence.friend_log_upserts.len(), 1);
        assert!(output
            .persistence
            .feed_entries
            .iter()
            .any(|entry| entry.to_json()["type"] == "Friend"
                && entry.to_json()["displayName"] == "Added"));

        assert_eq!(snapshot_friend(&runtime).state, "offline");
    }

    #[test]
    fn friend_delete_removes_from_roster() {
        let runtime = runtime_with_friend(friend_record("online", "wrld_1:123~region(jp)"));
        let friend_user_ids = runtime.friend_user_ids_snapshot();

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-delete",
            "content": { "userId": "usr_friend" }
        }))) else {
            panic!("friend-delete should produce an output");
        };

        assert_eq!(output.projection.removals, vec!["usr_friend"]);
        assert_eq!(output.projection.location_time_snapshot, Some(vec![]));
        assert_eq!(output.persistence.friend_log_deletes.len(), 1);
        assert!(output
            .persistence
            .feed_entries
            .iter()
            .any(|entry| entry.to_json()["type"] == "Unfriend"));

        assert!(!runtime
            .snapshot()
            .unwrap()
            .friends_by_id
            .contains_key("usr_friend"));
        let empty_friend_user_ids = runtime.friend_user_ids_snapshot();
        assert!(!std::sync::Arc::ptr_eq(
            &friend_user_ids,
            &empty_friend_user_ids
        ));
        assert!(empty_friend_user_ids.is_empty());
    }

    #[test]
    fn friend_update_profile_merge_is_defined_only() {
        let mut baseline = friend_record("online", "wrld_1:123~region(jp)");
        baseline.icon_url = "https://images.example/original/256".into();
        let runtime = runtime_with_friend(baseline);

        let RealtimeFriendApplyResult::Output(_) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-update",
            "content": {
                "userId": "usr_friend",
                "user": {
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "iconUrl": "https://images.example/first/256",
                    "status": "join me"
                }
            }
        }))) else {
            panic!("friend-update with iconUrl should produce an output");
        };
        assert_eq!(
            snapshot_friend(&runtime).icon_url,
            "https://images.example/first/256"
        );

        let RealtimeFriendApplyResult::Output(_) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-update",
            "content": {
                "userId": "usr_friend",
                "user": {
                    "id": "usr_friend",
                    "statusDescription": "desc only"
                }
            }
        }))) else {
            panic!("friend-update without iconUrl should still produce an output");
        };
        assert_eq!(
            snapshot_friend(&runtime).icon_url,
            "https://images.example/first/256"
        );

        let RealtimeFriendApplyResult::Output(_) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-update",
            "content": {
                "userId": "usr_friend",
                "user": {
                    "id": "usr_friend",
                    "iconUrl": Value::Null,
                    "status": "ask me"
                }
            }
        }))) else {
            panic!("friend-update with null iconUrl should still produce an output");
        };
        assert_eq!(
            snapshot_friend(&runtime).icon_url,
            "https://images.example/first/256"
        );
    }

    #[test]
    fn friend_update_icon_file_change_reports_previous_and_next_file_ids() {
        let mut baseline = friend_record("online", "wrld_1:123~region(jp)");
        baseline.icon_url = "https://api.vrchat.cloud/api/1/image/file_old/1/256".into();
        let runtime = runtime_with_friend(baseline);

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-update",
            "content": {
                "userId": "usr_friend",
                "user": {
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "iconUrl": "https://api.vrchat.cloud/api/1/image/file_new/2/256"
                }
            }
        }))) else {
            panic!("friend-update should produce an output");
        };

        assert_eq!(
            output.icon_changes,
            vec![FriendIconChange {
                user_id: "usr_friend".into(),
                display_name: "Friend".into(),
                previous_icon_url: "https://api.vrchat.cloud/api/1/image/file_old/1/256".into(),
                next_icon_url: "https://api.vrchat.cloud/api/1/image/file_new/2/256".into(),
                created_at: output.icon_changes[0].created_at.clone(),
            }]
        );
        assert!(!output.icon_changes[0].created_at.is_empty());
    }

    #[test]
    fn icon_url_changes_without_a_new_file_id_are_not_reported() {
        let mut baseline = friend_record("online", "wrld_1:123~region(jp)");
        baseline.icon_url = "https://api.vrchat.cloud/api/1/image/file_same/1/256".into();
        let runtime = runtime_with_friend(baseline);

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-location",
            "content": {
                "userId": "usr_friend",
                "location": "wrld_1:456~region(jp)",
                "travelingToLocation": "",
                "worldId": "wrld_1",
                "platform": "standalonewindows",
                "user": {
                    "id": "usr_friend",
                    "iconUrl": "https://api.vrchat.cloud/api/1/image/file_same/2/128"
                }
            }
        }))) else {
            panic!("friend-location should produce an output");
        };
        assert!(output.icon_changes.is_empty());
    }

    #[test]
    fn first_seen_icon_urls_are_not_reported_as_changes() {
        let runtime = runtime_with_friend(friend_record("online", "wrld_1:123~region(jp)"));

        let RealtimeFriendApplyResult::Output(output) = runtime.apply_ws_message(&ws(json!({
            "type": "friend-update",
            "content": {
                "userId": "usr_friend",
                "user": {
                    "id": "usr_friend",
                    "iconUrl": "https://api.vrchat.cloud/api/1/image/file_new/1/256"
                }
            }
        }))) else {
            panic!("friend-update should produce an output");
        };
        assert!(output.icon_changes.is_empty());
        assert_eq!(
            snapshot_friend(&runtime).icon_url,
            "https://api.vrchat.cloud/api/1/image/file_new/1/256"
        );
    }
}
