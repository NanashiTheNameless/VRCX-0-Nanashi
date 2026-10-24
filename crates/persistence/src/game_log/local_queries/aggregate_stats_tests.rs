use serde_json::json;

use super::test_support::*;
use crate::game_log::{
    get_previous_instances_by_group_id, get_previous_instances_by_world_id,
    previous_instance_event_rows_query, write_batch, GameLogLocationEntry, GameLogWriteBatch,
};
use crate::ownership::OwnerId;
use crate::player_list::{instance_activity_dates_get, instance_activity_rows_get};

#[test]
fn world_and_user_stat_queries_return_defaults_and_skip_current_matches() -> Result<(), crate::Error>
{
    let test_db = test_db("local-query-stats")?;
    seed_fixture(&test_db.db)?;

    assert_eq!(
        query(
            &test_db.db,
            "lastVisit",
            json!({
                "worldId": "wrld_alpha",
                "currentWorldMatch": true
            }),
        )?["created_at"],
        1778745600
    );
    assert_eq!(
        query(
            &test_db.db,
            "visitCount",
            json!({ "worldId": "wrld_alpha" })
        )?["visitCount"],
        2
    );
    assert_eq!(
        query(
            &test_db.db,
            "timeSpentInWorld",
            json!({ "worldId": "wrld_alpha" }),
        )?["timeSpent"],
        150_000
    );
    assert_eq!(
        query(
            &test_db.db,
            "lastGroupVisit",
            json!({ "groupId": "grp_alpha" })
        )?["created_at"],
        1778752800
    );
    assert_eq!(
        query(
            &test_db.db,
            "lastSeen",
            json!({
                "userId": "usr_vip",
                "displayName": "Vip Friend",
                "inCurrentWorld": true
            }),
        )?["created_at"],
        1778745660
    );
    assert_eq!(
        query(
            &test_db.db,
            "joinCount",
            json!({
                "userId": "usr_vip",
                "displayName": "Vip Friend"
            }),
        )?["joinCount"],
        1
    );
    assert_eq!(
        query(
            &test_db.db,
            "timeSpent",
            json!({
                "userId": "usr_vip",
                "displayName": "Vip Friend"
            }),
        )?["timeSpent"],
        1_800_000
    );

    let stats = query(
        &test_db.db,
        "userStats",
        json!({
            "userId": "usr_target",
            "displayName": "New Target"
        }),
    )?;
    assert_eq!(stats["joinCount"], 1);
    assert_eq!(stats["timeSpent"], 900_000);
    assert_eq!(
        stats["previousDisplayNames"][0]["displayName"],
        "Old Target"
    );

    assert_eq!(
        query(
            &test_db.db,
            "lastVisit",
            json!({ "worldId": "wrld_missing" })
        )?,
        json!({ "created_at": 0, "worldId": "" })
    );
    Ok(())
}

#[test]
fn aggregate_and_lookup_queries_cover_group_world_player_and_dates() -> Result<(), crate::Error> {
    let test_db = test_db("local-query-aggregates")?;
    seed_fixture(&test_db.db)?;

    let group_rows =
        get_previous_instances_by_group_id(&test_db.db, &OwnerId::new("usr_test"), "grp_alpha")?;
    assert_eq!(group_rows.len(), 2);
    assert_eq!(group_rows[0].location, "wrld_alpha:inst-c~group(grp_alpha)");
    assert_eq!(group_rows[0].created_at, 1778752800);
    assert_eq!(group_rows[0].time, 90_000);
    assert_eq!(
        serde_json::to_value(&group_rows)?,
        query(
            &test_db.db,
            "previousInstancesByGroupId",
            json!({ "groupId": "grp_alpha" }),
        )?
    );

    let all_stats = rows(query(
        &test_db.db,
        "allUserStats",
        json!({
            "userIds": ["usr_vip"],
            "displayNames": ["New Target"]
        }),
    )?);
    assert_eq!(all_stats.len(), 2);

    assert_eq!(
        query(&test_db.db, "lastDate", json!({}))?,
        json!(1778753100)
    );

    let previous_by_user = previous_instance_event_rows_query(
        &test_db.db,
        &OwnerId::new("usr_test"),
        "usr_vip",
        Some(1778745600),
        Some(1778746200),
        0,
    )?;
    assert_eq!(previous_by_user.len(), 1);
    assert_eq!(previous_by_user[0].world_name, "Alpha World");

    let world_rows =
        get_previous_instances_by_world_id(&test_db.db, &OwnerId::new("usr_test"), "wrld_alpha")?;
    assert_eq!(world_rows.len(), 2);
    assert_eq!(world_rows[0].created_at, 1778752800);
    assert_eq!(world_rows[0].time, 90_000);
    assert_eq!(
        serde_json::to_value(&world_rows)?,
        query(
            &test_db.db,
            "previousInstancesByWorldId",
            json!({ "worldId": "wrld_alpha" }),
        )?
    );

    let players = rows(query(
        &test_db.db,
        "playersFromInstanceRows",
        json!({ "location": "wrld_alpha:inst-a~group(grp_alpha)" }),
    )?);
    assert_eq!(players.len(), 4);

    assert_eq!(
        query(
            &test_db.db,
            "locationBeforeOrAt",
            json!({ "createdAt": 1778751000 }),
        )?["worldId"],
        "wrld_beta"
    );

    let range = rows(query(
        &test_db.db,
        "joinLeaveRange",
        json!({
            "location": "wrld_alpha:inst-a~group(grp_alpha)",
            "afterDate": 1778745600,
            "beforeDate": 1778745720
        }),
    )?);
    assert_eq!(range.len(), 2);

    let detail = rows(query(
        &test_db.db,
        "playerDetailFromInstance",
        json!({ "location": "wrld_alpha:inst-a~group(grp_alpha)" }),
    )?);
    assert_eq!(detail[0]["display_name"], "Vip Friend");

    let names = rows(query(
        &test_db.db,
        "previousDisplayNamesByUserId",
        json!({ "userId": "usr_target" }),
    )?);
    assert_eq!(
        row_texts(&names, "displayName"),
        vec!["New Target".to_string(), "Old Target".to_string(),]
    );

    let instance_times = rows(query(&test_db.db, "instanceTimes", json!({}))?);
    assert_eq!(instance_times.len(), 3);

    let online = rows(query(
        &test_db.db,
        "onlineSessions",
        json!({
            "fromDate": 1778751000,
            "toDate": 1778754600
        }),
    )?);
    assert_eq!(
        row_epochs(&online, "created_at"),
        vec![1778749200, 1778752800,]
    );

    let after = rows(query(
        &test_db.db,
        "onlineSessionsAfter",
        json!({
            "afterCreatedAt": 1778749200,
            "inclusive": false
        }),
    )?);
    assert_eq!(row_epochs(&after, "created_at"), vec![1778752800,]);

    Ok(())
}

#[test]
fn typed_group_previous_instances_preserve_legacy_location_aggregation() -> Result<(), crate::Error>
{
    let test_db = test_db("typed-group-previous-instances")?;
    let location = "wrld_alpha:inst-a~group(grp_alpha)";
    write_batch(
        &test_db.db,
        &OwnerId::new("usr_test"),
        &GameLogWriteBatch {
            locations: vec![
                GameLogLocationEntry {
                    created_at: 1778745600,
                    location: location.into(),
                    world_id: "wrld_alpha".into(),
                    world_name: "Alpha World".into(),
                    time: 60_000,
                    group_name: "Group Alpha".into(),
                },
                GameLogLocationEntry {
                    created_at: 1778749200,
                    location: location.into(),
                    world_id: "wrld_alpha".into(),
                    world_name: "Alpha World Updated".into(),
                    time: 30_000,
                    group_name: "Group Alpha Updated".into(),
                },
            ],
            ..Default::default()
        },
    )?;

    let rows =
        get_previous_instances_by_group_id(&test_db.db, &OwnerId::new("usr_test"), "grp_alpha")?;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].created_at, 1778745600);
    assert_eq!(rows[0].world_name, "Alpha World");
    assert_eq!(rows[0].group_name, "Group Alpha");
    assert_eq!(rows[0].time, 90_000);
    assert_eq!(
        serde_json::to_value(&rows)?,
        query(
            &test_db.db,
            "previousInstancesByGroupId",
            json!({ "groupId": "grp_alpha" }),
        )?
    );

    Ok(())
}

#[test]
fn activity_and_session_queries_cover_empty_and_cursor_edges() -> Result<(), crate::Error> {
    let test_db = test_db("local-query-sessions")?;
    seed_fixture(&test_db.db)?;

    let activity = instance_activity_rows_get(
        &test_db.db,
        &OwnerId::new("usr_test"),
        1778745600,
        1778746200,
    )?;
    assert_eq!(activity[0].display_name, "Vip Friend");

    assert_eq!(
        instance_activity_dates_get(&test_db.db, &OwnerId::new("usr_test"), "usr_vip".into(),)?,
        vec![1778747400, 1778745660]
    );

    let join_history = rows(query(
        &test_db.db,
        "instanceJoinHistory",
        json!({
            "userId": "usr_vip",
            "createdAt": 1778745600
        }),
    )?);
    assert_eq!(
        join_history[0]["location"],
        "wrld_alpha:inst-a~group(grp_alpha)"
    );

    assert_eq!(
        query(
            &test_db.db,
            "worldNameByWorldId",
            json!({ "worldId": "wrld_alpha" }),
        )?,
        json!("Alpha World")
    );
    assert_eq!(
        query(
            &test_db.db,
            "userIdFromDisplayName",
            json!({ "displayName": "Vip Friend" }),
        )?,
        json!("usr_vip")
    );

    Ok(())
}
