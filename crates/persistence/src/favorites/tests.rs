use std::path::PathBuf;
use std::sync::Arc;

use super::*;
use crate::config::get_json;

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

fn test_db(name: &str) -> (TestDir, Arc<DatabaseService>) {
    let dir = TestDir::new(name);
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap());
    (dir, db)
}

fn group_names(db: &DatabaseService, kind: FavoriteEntityKind) -> Vec<String> {
    favorite_list(db, None, kind)
        .unwrap()
        .into_iter()
        .map(|row| row.group_name)
        .collect()
}

fn config_array(db: &DatabaseService, key: &str) -> Vec<String> {
    get_json(db, key, serde_json::Value::Null)
        .unwrap()
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|value| value.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

#[test]
fn rename_updates_favorites_and_config_atomically() {
    let (_dir, db) = test_db("favorite-rename-with-config");
    favorite_add(
        &db,
        None,
        FavoriteEntityKind::Friend,
        "usr_1".into(),
        "old".into(),
    )
    .unwrap();

    let affected = favorite_group_rename_with_config(
        &db,
        None,
        FavoriteEntityKind::Friend,
        "localFavoriteFriendGroups",
        "old",
        "new",
        &["new".to_string()],
    )
    .unwrap();

    assert_eq!(affected, 1);
    assert_eq!(
        group_names(&db, FavoriteEntityKind::Friend),
        vec!["new".to_string()]
    );
    assert_eq!(
        config_array(&db, "localFavoriteFriendGroups"),
        vec!["new".to_string()]
    );
}

#[test]
fn rename_with_config_merges_into_existing_group_despite_unique_index() {
    let (_dir, db) = test_db("favorite-rename-merge-with-config");
    favorite_add(
        &db,
        None,
        FavoriteEntityKind::Friend,
        "usr_1".into(),
        "a".into(),
    )
    .unwrap();
    favorite_add(
        &db,
        None,
        FavoriteEntityKind::Friend,
        "usr_1".into(),
        "b".into(),
    )
    .unwrap();

    favorite_group_rename_with_config(
        &db,
        None,
        FavoriteEntityKind::Friend,
        "localFavoriteFriendGroups",
        "a",
        "b",
        &["b".to_string()],
    )
    .unwrap();

    assert_eq!(
        group_names(&db, FavoriteEntityKind::Friend),
        vec!["b".to_string()]
    );
    assert_eq!(
        config_array(&db, "localFavoriteFriendGroups"),
        vec!["b".to_string()]
    );
}

#[test]
fn delete_removes_favorites_and_rewrites_config_atomically() {
    let (_dir, db) = test_db("favorite-delete-with-config");
    favorite_add(
        &db,
        None,
        FavoriteEntityKind::Friend,
        "usr_1".into(),
        "doomed".into(),
    )
    .unwrap();

    favorite_group_delete_with_config(
        &db,
        None,
        FavoriteEntityKind::Friend,
        "localFavoriteFriendGroups",
        "doomed",
        &[],
    )
    .unwrap();

    assert!(group_names(&db, FavoriteEntityKind::Friend).is_empty());
    assert!(config_array(&db, "localFavoriteFriendGroups").is_empty());
}

#[test]
fn favorite_add_is_idempotent_for_same_entity_and_group() {
    let (_dir, db) = test_db("favorite-add-idempotent");

    let first = favorite_add(
        &db,
        None,
        FavoriteEntityKind::World,
        "wrld_1".into(),
        "group".into(),
    )
    .unwrap();
    let second = favorite_add(
        &db,
        None,
        FavoriteEntityKind::World,
        "wrld_1".into(),
        "group".into(),
    )
    .unwrap();

    assert_eq!(first, 1);
    assert_eq!(second, 0);
    assert_eq!(
        favorite_list(&db, None, FavoriteEntityKind::World)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn friend_favorites_are_owner_scoped_with_shared_legacy_rows() {
    let (_dir, db) = test_db("favorite-owner-scope");

    assert_eq!(
        favorite_add(
            &db,
            Some(&OwnerId::new("usr_a")),
            FavoriteEntityKind::Friend,
            "usr_same".into(),
            "group".into(),
        )
        .unwrap(),
        1
    );
    assert_eq!(
        favorite_add(
            &db,
            Some(&OwnerId::new("usr_b")),
            FavoriteEntityKind::Friend,
            "usr_same".into(),
            "group".into(),
        )
        .unwrap(),
        1
    );
    assert_eq!(
        favorite_add(
            &db,
            Some(&OwnerId::new("usr_a")),
            FavoriteEntityKind::Friend,
            "usr_same".into(),
            "group".into(),
        )
        .unwrap(),
        0
    );
    favorite_add(
        &db,
        None,
        FavoriteEntityKind::Friend,
        "usr_shared".into(),
        "legacy".into(),
    )
    .unwrap();

    let a = favorite_list(
        &db,
        Some(&OwnerId::new("usr_a")),
        FavoriteEntityKind::Friend,
    )
    .unwrap();
    let b = favorite_list(
        &db,
        Some(&OwnerId::new("usr_b")),
        FavoriteEntityKind::Friend,
    )
    .unwrap();
    assert_eq!(a.len(), 2);
    assert_eq!(b.len(), 2);

    let first_world = favorite_add(
        &db,
        Some(&OwnerId::new("usr_a")),
        FavoriteEntityKind::World,
        "wrld_1".into(),
        "group".into(),
    )
    .unwrap();
    let duplicate_world = favorite_add(
        &db,
        Some(&OwnerId::new("usr_b")),
        FavoriteEntityKind::World,
        "wrld_1".into(),
        "group".into(),
    )
    .unwrap();
    assert_eq!((first_world, duplicate_world), (1, 0));
}

#[test]
fn favorite_list_upgrades_legacy_friend_table_before_owner_scoped_read() {
    let (_dir, db) = test_db("favorite-legacy-owner-upgrade");
    db.execute_non_query(
        "CREATE TABLE favorite_friend (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, group_name TEXT)",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "CREATE UNIQUE INDEX favorite_friend_user_id_group_idx ON favorite_friend (user_id, group_name)",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "INSERT INTO favorite_friend (created_at, user_id, group_name) VALUES ('2026-07-01T00:00:00.000Z', 'usr_legacy', 'legacy')",
        &Default::default(),
    )
    .unwrap();

    let rows = favorite_list(
        &db,
        Some(&OwnerId::new("usr_owner")),
        FavoriteEntityKind::Friend,
    )
    .unwrap();

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].user_id.as_deref(), Some("usr_legacy"));
    assert_eq!(rows[0].group_name, "legacy");
    let columns = crate::database::schema::table_column_names(&db, "favorite_friend").unwrap();
    assert!(columns.contains("owner_id"));
}

#[test]
fn ensure_global_store_tables_preserves_dirty_duplicates_and_promotes_unique_index_once_clean() {
    let (_dir, db) = test_db("favorite-dirty-duplicate-index");
    db.execute_non_query(
        "CREATE TABLE IF NOT EXISTS favorite_world (id INTEGER PRIMARY KEY, created_at TEXT, world_id TEXT, group_name TEXT)",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "INSERT INTO favorite_world (created_at, world_id, group_name) VALUES ('2026-01-01T00:00:00.000Z', 'wrld_1', 'group')",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "INSERT INTO favorite_world (created_at, world_id, group_name) VALUES ('2026-01-02T00:00:00.000Z', 'wrld_1', 'group')",
        &Default::default(),
    )
    .unwrap();

    ensure_global_store_tables(&db).unwrap();

    assert_eq!(
        favorite_list(&db, None, FavoriteEntityKind::World)
            .unwrap()
            .len(),
        2
    );

    assert_eq!(
        favorite_add(
            &db,
            None,
            FavoriteEntityKind::World,
            "wrld_1".into(),
            "group".into(),
        )
        .unwrap(),
        0
    );
    assert_eq!(
        favorite_list(&db, None, FavoriteEntityKind::World)
            .unwrap()
            .len(),
        2
    );
    assert!(!db
        .execute(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'favorite_world_world_id_group_lookup_idx'",
            &Default::default(),
        )
        .unwrap()
        .is_empty());

    db.execute_non_query(
        "DELETE FROM favorite_world WHERE created_at = '2026-01-02T00:00:00.000Z'",
        &Default::default(),
    )
    .unwrap();
    ensure_global_store_tables(&db).unwrap();

    assert!(db
        .execute(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'favorite_world_world_id_group_lookup_idx'",
            &Default::default(),
        )
        .unwrap()
        .is_empty());
    assert!(!db
        .execute(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'favorite_world_world_id_group_idx'",
            &Default::default(),
        )
        .unwrap()
        .is_empty());
}
