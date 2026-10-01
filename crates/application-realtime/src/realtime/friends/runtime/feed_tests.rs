#[cfg(test)]
mod tests {
    use super::super::*;

    #[test]
    fn websocket_friend_update_with_offline_status_does_not_emit_status_feed() {
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
                            status: "join me".into(),
                            status_description: "Old status".into(),
                            ..FriendRecord::default()
                        },
                        presence: FriendBaselinePresence {
                            state: "online".into(),
                            location: "wrld_old:123".into(),
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
                    "type": "friend-update",
                    "content": {
                        "userId": "usr_friend",
                        "user": {
                            "id": "usr_friend",
                            "displayName": "Friend",
                            "state": "online",
                            "status": "offline",
                            "statusDescription": "Fresh offline status"
                        }
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:01Z".into(),
            })
        else {
            panic!("friend-update should produce an output");
        };

        assert!(output.persistence.feed_entries.is_empty());
        assert!(output.joining.is_empty());
        assert_eq!(output.projection.patches[0].record.status, "offline");
        assert_eq!(
            output.projection.patches[0].record.status_description,
            "Fresh offline status"
        );
    }

    #[test]
    fn duplicate_friend_update_status_payload_only_writes_status_feed_once() {
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
                            status: "join me".into(),
                            status_description: "Old status".into(),
                            ..FriendRecord::default()
                        },
                        presence: FriendBaselinePresence {
                            state: "online".into(),
                            location: "wrld_old:123".into(),
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

        let payload = json!({
            "type": "friend-update",
            "content": {
                "userId": "usr_friend",
                "user": {
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "state": "online",
                    "status": "active",
                    "statusDescription": "Fresh WS status"
                }
            }
        });

        let RealtimeFriendApplyResult::Output(first) =
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
                json: payload.clone(),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:01Z".into(),
            })
        else {
            panic!("first friend-update should produce an output");
        };
        assert_eq!(
            first.persistence.feed_entries[0].to_json()["type"],
            "Status"
        );

        assert!(matches!(
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
                json: payload,
                raw: "{}".into(),
                received_at: "2026-05-15T00:01:01Z".into(),
            }),
            RealtimeFriendApplyResult::Ignored
        ));
    }

    #[test]
    fn friend_update_status_a_b_a_writes_each_real_diff() {
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
                            status: "active".into(),
                            status_description: "A".into(),
                            ..FriendRecord::default()
                        },
                        presence: FriendBaselinePresence {
                            state: "online".into(),
                            location: "wrld_old:123".into(),
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

        let RealtimeFriendApplyResult::Output(first) =
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
                json: json!({
                    "type": "friend-update",
                    "content": {
                        "userId": "usr_friend",
                        "user": {
                            "id": "usr_friend",
                            "displayName": "Friend",
                            "state": "online",
                            "status": "join me",
                            "statusDescription": "B"
                        }
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:01Z".into(),
            })
        else {
            panic!("first friend-update should produce an output");
        };

        let RealtimeFriendApplyResult::Output(second) =
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
                json: json!({
                    "type": "friend-update",
                    "content": {
                        "userId": "usr_friend",
                        "user": {
                            "id": "usr_friend",
                            "displayName": "Friend",
                            "state": "online",
                            "status": "active",
                            "statusDescription": "A"
                        }
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:02:01Z".into(),
            })
        else {
            panic!("second friend-update should produce an output");
        };

        assert_eq!(
            first.persistence.feed_entries[0].to_json()["type"],
            "Status"
        );
        assert_eq!(
            first.persistence.feed_entries[0].to_json()["status"],
            "join me"
        );
        assert_eq!(
            second.persistence.feed_entries[0].to_json()["type"],
            "Status"
        );
        assert_eq!(
            second.persistence.feed_entries[0].to_json()["status"],
            "active"
        );
    }
}
