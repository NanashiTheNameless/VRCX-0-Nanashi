use std::path::PathBuf;

use serde_json::json;

use super::*;
use crate::cache_entities::CacheEntityInput;
use crate::game_log::{
    write_batch, GameLogJoinLeaveEntry, GameLogLocationEntry, GameLogWriteBatch,
};
use crate::worlds::world_cache_upsert;

struct TestDatabase {
    _dir: TestDir,
    db: DatabaseService,
}

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-player-list-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn test_db(name: &str) -> Result<TestDatabase, Error> {
    let dir = TestDir::new(name);
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    Ok(TestDatabase { _dir: dir, db })
}

fn location(
    created_at: i64,
    location: &str,
    world_id: &str,
    world_name: &str,
) -> GameLogLocationEntry {
    GameLogLocationEntry {
        created_at,
        location: location.into(),
        world_id: world_id.into(),
        world_name: world_name.into(),
        time: 60_000,
        group_name: String::new(),
    }
}

fn join_leave(
    created_at: i64,
    event_type: &str,
    display_name: &str,
    location: &str,
    user_id: &str,
    time: i64,
) -> GameLogJoinLeaveEntry {
    GameLogJoinLeaveEntry {
        created_at,
        event_type: event_type.into(),
        display_name: display_name.into(),
        location: location.into(),
        user_id: user_id.into(),
        world_name: String::new(),
        time,
    }
}

fn cache_world(id: &str, name: &str) -> CacheEntityInput {
    CacheEntityInput {
        id: json!(id),
        author_id: json!("usr_author"),
        author_name: json!("Author"),
        created_at: json!(1767225600),
        description: json!("Description"),
        image_url: json!("image.png"),
        name: json!(name),
        release_status: json!("public"),
        thumbnail_image_url: json!("thumb.png"),
        updated_at: json!(1767312000),
        version: json!(1),
    }
}

#[test]
fn activity_includes_duration_start_across_range_and_filters_traveling() -> Result<(), Error> {
    let test_db = test_db("activity-range")?;
    write_batch(
        &test_db.db,
        &OwnerId::new("usr_test"),
        &GameLogWriteBatch {
            join_leave: vec![
                join_leave(
                    1782900600,
                    "OnPlayerLeft",
                    "Spanning",
                    "wrld_a:instance",
                    "usr_spanning",
                    1_200_000,
                ),
                join_leave(
                    1782901200,
                    "OnPlayerLeft",
                    "Covering",
                    "wrld_a:instance",
                    "usr_covering",
                    3_600_000,
                ),
                join_leave(
                    1782899520,
                    "OnPlayerLeft",
                    "Traveling",
                    " traveling:traveling ",
                    "usr_traveling",
                    0,
                ),
                join_leave(
                    1782899580,
                    "OnPlayerJoined",
                    "Joined",
                    "wrld_a:instance",
                    "usr_joined",
                    0,
                ),
            ],
            ..GameLogWriteBatch::default()
        },
    )?;

    let rows = instance_activity_rows_get(
        &test_db.db,
        &OwnerId::new("usr_test"),
        1782899340,
        1782899700,
    )?;
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].display_name, "Spanning");
    assert_eq!(rows[0].created_at, 1782900600);
    assert_eq!(rows[1].display_name, "Covering");
    Ok(())
}

#[test]
fn world_summaries_prefer_cache_and_fall_back_to_latest_game_log_name() -> Result<(), Error> {
    let test_db = test_db("world-summaries")?;
    world_cache_upsert(&test_db.db, cache_world("wrld_cached", "Cached Name"))?;
    world_cache_upsert(&test_db.db, cache_world("wrld_empty_cache", ""))?;
    write_batch(
        &test_db.db,
        &OwnerId::new("usr_test"),
        &GameLogWriteBatch {
            locations: vec![
                location(1782864000, "cached:1", "wrld_cached", "Game Log Name"),
                location(1782864060, "fallback:1", "wrld_fallback", "Old Fallback"),
                location(1782864120, "fallback:2", "wrld_fallback", "Latest Fallback"),
                location(1782864180, "empty:1", "wrld_empty_cache", "Recovered Name"),
            ],
            ..GameLogWriteBatch::default()
        },
    )?;

    let summaries = world_summaries_get(
        &test_db.db,
        &OwnerId::new("usr_test"),
        vec![
            " wrld_cached ".into(),
            "wrld_cached".into(),
            "wrld_fallback".into(),
            "wrld_empty_cache".into(),
            "wrld_missing".into(),
            " ".into(),
        ],
    )?;
    assert_eq!(summaries.len(), 3);
    assert_eq!(summaries["wrld_cached"].name, "Cached Name");
    assert_eq!(summaries["wrld_cached"].author_name, "Author");
    assert_eq!(summaries["wrld_fallback"].name, "Latest Fallback");
    assert!(summaries["wrld_fallback"].author_name.is_empty());
    assert_eq!(summaries["wrld_empty_cache"].name, "Recovered Name");
    assert!(!summaries.contains_key("wrld_missing"));
    Ok(())
}
