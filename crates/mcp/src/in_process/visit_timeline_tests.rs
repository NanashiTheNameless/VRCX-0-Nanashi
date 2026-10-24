use serde_json::{json, Map};
use vrcx_0_core::OwnerId;
use vrcx_0_persistence::game_log::{
    write_batch, GameLogJoinLeaveEntry, GameLogLocationEntry, GameLogWriteBatch,
};

use super::*;
use crate::test_support::test_runtime_with_database;

fn join_leave(
    created_at: &str,
    event_type: &str,
    name: &str,
    user_id: &str,
) -> GameLogJoinLeaveEntry {
    GameLogJoinLeaveEntry {
        created_at: vrcx_0_core::time::parse_epoch_seconds(created_at).unwrap(),
        event_type: event_type.into(),
        display_name: name.into(),
        location: "wrld_a:1".into(),
        user_id: user_id.into(),
        world_name: "World A".into(),
        time: 0,
    }
}

#[tokio::test]
async fn visit_timeline_tool_reconstructs_a_visit_over_the_bridge() {
    let (_dir, runtime, db) =
        test_runtime_with_database("in-process-visit-timeline", "usr_owner").unwrap();
    write_batch(
        db.as_ref(),
        &OwnerId::new("usr_owner"),
        &GameLogWriteBatch {
            locations: vec![GameLogLocationEntry {
                created_at: 1780344000,
                location: "wrld_a:1".into(),
                world_id: "wrld_a".into(),
                world_name: "World A".into(),
                time: 1_800_000,
                group_name: String::new(),
            }],
            join_leave: vec![
                join_leave(
                    "2026-06-01T20:00:00.000Z",
                    "OnPlayerJoined",
                    "Owner",
                    "usr_owner",
                ),
                join_leave(
                    "2026-06-01T20:05:00.000Z",
                    "OnPlayerJoined",
                    "Alice",
                    "usr_alice",
                ),
                join_leave(
                    "2026-06-01T20:15:00.000Z",
                    "OnPlayerLeft",
                    "Alice",
                    "usr_alice",
                ),
                join_leave(
                    "2026-06-01T20:20:00.000Z",
                    "OnPlayerJoined",
                    "Alice",
                    "usr_alice",
                ),
            ],
            ..GameLogWriteBatch::default()
        },
    )
    .unwrap();
    let tools = spawn_in_process_tools(runtime).await.unwrap();

    let mut arguments = Map::new();
    arguments.insert("at".into(), json!("2026-06-01T20:10:00Z"));
    let outcome = tools
        .call_tool("get_visit_timeline", Some(arguments))
        .await
        .unwrap();

    assert!(!outcome.is_error, "{}", outcome.text);
    let structured = outcome.structured.expect("structured tool result");
    assert_eq!(structured["visit"]["location"], "wrld_a:1");
    assert_eq!(structured["visit"]["joinedAt"], "2026-06-01T20:00:00.000Z");
    assert_eq!(structured["visit"]["leftAt"], "2026-06-01T20:30:00.000Z");
    assert_eq!(structured["visit"]["inProgress"], false);
    assert_eq!(structured["peopleObserved"], 1);
    let alice = &structured["roster"][0];
    assert_eq!(alice["displayName"], "Alice");
    assert_eq!(alice["stints"].as_array().unwrap().len(), 2);
    assert_eq!(alice["stints"][1]["leftAt"], serde_json::Value::Null);
    assert_eq!(alice["sharedMinutes"], 20);
    assert!(structured["summary"]
        .as_str()
        .unwrap()
        .contains("Alice (20m)"));
    assert!(structured["caveats"]
        .as_array()
        .unwrap()
        .iter()
        .any(|caveat| caveat.as_str().unwrap().contains("inProgress")));

    let missing = tools
        .call_tool("get_visit_timeline", Some(Map::new()))
        .await
        .unwrap();
    assert!(missing.is_error);
}
