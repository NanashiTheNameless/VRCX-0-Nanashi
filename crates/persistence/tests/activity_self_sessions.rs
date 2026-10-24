use std::path::PathBuf;

use serde_json::json;
use vrcx_0_core::OwnerId;
use vrcx_0_persistence::activity::{
    activity_bucket_cache_get, activity_bucket_cache_upsert, activity_self_caches_invalidate,
    activity_self_sessions_refresh, activity_self_sessions_warmup, activity_sessions_get,
    activity_sync_state_get, ActivityBucketCacheInput, ActivityBucketCacheQueryInput,
    ActivityRefreshMode, ActivitySelfSessionsRefreshInput, ActivitySelfSessionsRefreshOutput,
    ActivitySessionOutput, ActivityViewKind,
};
use vrcx_0_persistence::game_log::{write_batch, GameLogLocationEntry, GameLogWriteBatch};
use vrcx_0_persistence::DatabaseService;

const OWNER: &str = "usr_self";
const NOW: i64 = 1736467200;

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn test_db(name: &str) -> (TestDir, DatabaseService) {
    let dir = TestDir::new(name);
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap();
    (dir, db)
}

fn ms(seconds: i64) -> i64 {
    seconds * 1000
}

fn location(created_at: i64, time: i64) -> GameLogLocationEntry {
    GameLogLocationEntry {
        created_at,
        location: "wrld_1:1".to_string(),
        world_id: "wrld_1".to_string(),
        world_name: "World".to_string(),
        time,
        group_name: String::new(),
    }
}

fn seed(db: &DatabaseService, locations: Vec<GameLogLocationEntry>) {
    write_batch(
        db,
        &OwnerId::new(OWNER),
        &GameLogWriteBatch {
            locations,
            ..Default::default()
        },
    )
    .unwrap();
}

fn refresh(
    db: &DatabaseService,
    mode: ActivityRefreshMode,
    range_days: i64,
) -> ActivitySelfSessionsRefreshOutput {
    activity_self_sessions_refresh(
        db,
        &OwnerId::new(OWNER),
        ActivitySelfSessionsRefreshInput {
            user_id: OWNER.to_string(),
            mode,
            range_days: json!(range_days),
            now_ms: Some(ms(NOW)),
        },
    )
    .unwrap()
}

fn spans(sessions: &[ActivitySessionOutput]) -> Vec<(i64, i64, bool)> {
    sessions
        .iter()
        .map(|session| (session.start, session.end, session.is_open_tail))
        .collect()
}

fn persisted_spans(db: &DatabaseService) -> Vec<(i64, i64, bool)> {
    spans(&activity_sessions_get(db, OWNER.to_string()).unwrap())
}

#[test]
fn full_refresh_merges_adjacent_rows_and_records_the_source_cursor() {
    let (_dir, db) = test_db("activity-self-full");
    seed(
        &db,
        vec![
            location(1736416800, 3_600_000),
            location(1736420520, 0),
            location(1736422200, 1_800_000),
            location(1736452800, 0),
        ],
    );

    let output = refresh(&db, ActivityRefreshMode::Full, 30);

    let expected = vec![
        (ms(1736416800), ms(1736424000), false),
        (ms(1736452800), ms(NOW), true),
    ];
    assert_eq!(spans(&output.sessions), expected);
    assert_eq!(output.source_count, 4);
    assert_eq!(output.sync.source_last_created_at, 1736452800);
    assert_eq!(output.sync.cached_range_days, 30);
    assert!(output.sync.is_self);
    assert_eq!(persisted_spans(&db), expected);
    let sync = activity_sync_state_get(&db, OWNER.to_string())
        .unwrap()
        .unwrap();
    assert_eq!(sync.source_last_created_at, 1736452800);
    assert_eq!(sync.cached_range_days, 30);
}

#[test]
fn incremental_refresh_extends_the_last_session_and_advances_the_cursor() {
    let (_dir, db) = test_db("activity-self-incremental");
    seed(
        &db,
        vec![
            location(1736416800, 3_600_000),
            location(1736452800, 1_800_000),
        ],
    );
    refresh(&db, ActivityRefreshMode::Full, 30);
    seed(&db, vec![location(1736454720, 1_800_000)]);

    let output = refresh(&db, ActivityRefreshMode::Incremental, 30);

    let expected = vec![
        (ms(1736416800), ms(1736420400), false),
        (ms(1736452800), ms(1736456520), true),
    ];
    assert_eq!(spans(&output.sessions), expected);
    assert_eq!(output.source_count, 2);
    assert_eq!(output.sync.source_last_created_at, 1736454720);
    assert_eq!(persisted_spans(&db), expected);
}

#[test]
fn expand_refresh_backfills_older_rows_and_ignores_narrower_ranges() {
    let (_dir, db) = test_db("activity-self-expand");
    seed(&db, vec![location(1736416800, 3_600_000)]);
    refresh(&db, ActivityRefreshMode::Full, 30);
    seed(&db, vec![location(1732089600, 3_600_000)]);

    let expanded = refresh(&db, ActivityRefreshMode::Expand, 60);

    let expected = vec![
        (ms(1732089600), ms(1732093200), false),
        (ms(1736416800), ms(1736420400), true),
    ];
    assert_eq!(spans(&expanded.sessions), expected);
    assert_eq!(expanded.source_count, 2);
    assert_eq!(expanded.sync.cached_range_days, 60);
    assert_eq!(expanded.sync.source_last_created_at, 1736416800);
    assert_eq!(persisted_spans(&db), expected);

    let narrower = refresh(&db, ActivityRefreshMode::Expand, 30);

    assert_eq!(spans(&narrower.sessions), expected);
    assert_eq!(narrower.source_count, 0);
    assert_eq!(narrower.sync.cached_range_days, 60);
}

#[test]
fn invalidating_self_caches_lets_the_next_refresh_see_backfilled_history() {
    let (_dir, db) = test_db("activity-self-invalidate");
    seed(&db, vec![location(1736452800, 3_600_000)]);
    refresh(&db, ActivityRefreshMode::Full, 30);
    activity_bucket_cache_upsert(
        &db,
        ActivityBucketCacheInput {
            owner_user_id: OwnerId::new(OWNER),
            target_user_id: "usr_friend".to_string(),
            range_days: json!(30),
            view_kind: ActivityViewKind::Overlap,
            exclude_key: String::new(),
            bucket_version: json!(1),
            built_from_cursor: "1736452800".into(),
            raw_buckets: json!([]),
            normalized_buckets: json!([]),
            summary: json!({}),
            built_at: NOW,
        },
    )
    .unwrap();
    seed(&db, vec![location(1736330400, 3_600_000)]);

    activity_self_caches_invalidate(&db, &OwnerId::new(OWNER)).unwrap();

    assert!(activity_sync_state_get(&db, OWNER.to_string())
        .unwrap()
        .is_none());
    assert!(activity_bucket_cache_get(
        &db,
        ActivityBucketCacheQueryInput {
            owner_user_id: OwnerId::new(OWNER),
            target_user_id: "usr_friend".to_string(),
            range_days: json!(30),
            view_kind: ActivityViewKind::Overlap,
            exclude_key: String::new(),
        },
    )
    .unwrap()
    .is_none());
    let output =
        activity_self_sessions_warmup(&db, OwnerId::new(OWNER), 30, Some(ms(NOW))).unwrap();
    assert_eq!(
        spans(&output.sessions),
        vec![
            (ms(1736330400), ms(1736334000), false),
            (ms(1736452800), ms(1736456400), true),
        ]
    );
}
