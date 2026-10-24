use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

use super::*;

static TEST_COUNTER: AtomicUsize = AtomicUsize::new(0);

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let id = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path =
            std::env::temp_dir().join(format!("vrcx0-memos-{name}-{}-{id}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
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

#[test]
fn memo_list_users_page_returns_ordered_cursor_page() {
    let (_dir, db) = test_db("page");
    ensure_global_store_tables(&db).unwrap();
    db.execute_non_query(
        "INSERT INTO memos (user_id, edited_at, memo)
             VALUES
                ('usr_a', 1780308000, 'A'),
                ('usr_b', 1780480800, 'B'),
                ('usr_c', 1780394400, 'C')",
        &Default::default(),
    )
    .unwrap();

    assert_eq!(memo_count_users(&db).unwrap(), 3);
    assert_eq!(memo_list_users(&db).unwrap().len(), 3);

    let first = memo_list_users_page(&db, 2, None).unwrap();
    assert_eq!(first.len(), 2);
    assert_eq!(first[0].user_id, "usr_b");
    assert_eq!(first[1].user_id, "usr_c");

    let second = memo_list_users_page(
        &db,
        2,
        Some((first[1].edited_at, first[1].user_id.as_str())),
    )
    .unwrap();
    assert_eq!(second.len(), 1);
    assert_eq!(second[0].user_id, "usr_a");
}

#[test]
fn save_memo_rejects_a_blank_entity_id() {
    let (_dir, db) = test_db("save-blank-id");

    let result = memo_save_user(&db, "   ".into(), "hello".into());

    assert!(result.is_err());
}

#[test]
fn save_memo_upserts_a_non_empty_memo_and_stamps_edited_at() {
    let (_dir, db) = test_db("save-upsert");

    let saved = memo_save_user(&db, "usr_alice".into(), "remember this".into()).unwrap();
    assert_eq!(saved.memo, "remember this");
    assert!(saved.edited_at > 0);

    let fetched = memo_get_user(&db, "usr_alice".into()).unwrap().unwrap();
    assert_eq!(fetched.memo, "remember this");
    assert_eq!(fetched.edited_at, saved.edited_at);

    let updated = memo_save_user(&db, "usr_alice".into(), "updated memo".into()).unwrap();
    let refetched = memo_get_user(&db, "usr_alice".into()).unwrap().unwrap();
    assert_eq!(refetched.memo, "updated memo");
    assert_eq!(refetched.edited_at, updated.edited_at);
}

#[test]
fn save_memo_with_empty_memo_deletes_the_row_instead_of_storing_a_blank() {
    let (_dir, db) = test_db("save-delete-on-empty");
    memo_save_user(&db, "usr_alice".into(), "remember this".into()).unwrap();

    let result = memo_save_user(&db, "usr_alice".into(), "".into()).unwrap();

    assert_eq!(result.edited_at, 0);
    assert_eq!(result.memo, "");
    assert!(memo_get_user(&db, "usr_alice".into()).unwrap().is_none());
}

#[test]
fn save_memo_with_empty_memo_on_a_missing_row_is_a_no_op() {
    let (_dir, db) = test_db("save-delete-missing");

    let result = memo_save_user(&db, "usr_ghost".into(), "".into()).unwrap();

    assert_eq!(result.entity_id, "usr_ghost");
    assert_eq!(result.memo, "");
    assert_eq!(memo_count_users(&db).unwrap(), 0);
}

#[test]
fn memo_get_user_returns_none_for_blank_or_unknown_id() {
    let (_dir, db) = test_db("get-user-none");

    assert!(memo_get_user(&db, "  ".into()).unwrap().is_none());
    assert!(memo_get_user(&db, "usr_unknown".into()).unwrap().is_none());
}

#[test]
fn memo_save_world_and_avatar_route_to_their_own_tables() {
    let (_dir, db) = test_db("save-world-avatar");
    memo_save_world(&db, "wrld_1".into(), "great world".into()).unwrap();
    memo_save_avatar(&db, "avtr_1".into(), "cool avatar".into()).unwrap();

    assert_eq!(
        memo_get_world(&db, "wrld_1".into()).unwrap().unwrap().memo,
        "great world"
    );
    assert_eq!(
        memo_get_avatar(&db, "avtr_1".into()).unwrap().unwrap().memo,
        "cool avatar"
    );
    assert!(memo_get_avatar(&db, "wrld_1".into()).unwrap().is_none());
    assert!(memo_get_world(&db, "avtr_1".into()).unwrap().is_none());
}

#[test]
fn memo_get_worlds_many_filters_blanks_and_only_returns_matches() {
    let (_dir, db) = test_db("worlds-many");
    memo_save_world(&db, "wrld_1".into(), "memo one".into()).unwrap();
    memo_save_world(&db, "wrld_2".into(), "memo two".into()).unwrap();

    assert!(memo_get_worlds_many(&db, &[]).unwrap().is_empty());
    assert!(memo_get_worlds_many(&db, &["   ".to_string()])
        .unwrap()
        .is_empty());

    let rows = memo_get_worlds_many(
        &db,
        &[
            "wrld_1".to_string(),
            "wrld_missing".to_string(),
            "  ".to_string(),
        ],
    )
    .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].world_id, "wrld_1");
}

#[test]
fn memo_list_user_notes_returns_empty_for_blank_owner_without_touching_db() {
    let (_dir, db) = test_db("notes-blank-owner");

    assert!(memo_list_user_notes(&db, OwnerId::new("  "))
        .unwrap()
        .is_empty());
}

#[test]
fn memo_list_user_notes_reads_the_owners_notes_table() {
    let (_dir, db) = test_db("notes-list");
    let prefix = normalize_user_table_prefix("usr_self").unwrap();
    ensure_user_store_tables(&db, &prefix).unwrap();
    db.execute_non_query(
        &format!(
            "INSERT INTO {prefix}_notes (user_id, display_name, note, created_at)
                 VALUES ('usr_alice', 'Alice', 'met at a concert', 1780272000)"
        ),
        &Default::default(),
    )
    .unwrap();

    let notes = memo_list_user_notes(&db, OwnerId::new("usr_self")).unwrap();

    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].user_id, "usr_alice");
    assert_eq!(notes[0].note, "met at a concert");
}

#[test]
fn memo_count_users_and_list_users_agree_on_an_empty_table() {
    let (_dir, db) = test_db("count-empty");

    assert_eq!(memo_count_users(&db).unwrap(), 0);
    assert!(memo_list_users(&db).unwrap().is_empty());
}
