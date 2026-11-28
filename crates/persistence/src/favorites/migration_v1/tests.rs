use serde_json::json;
use vrcx_0_core::FavoriteEntityKind;

use super::migration;
use crate::config;
use crate::database::schema::ensure_global_store_tables;
use crate::database::DatabaseService;
use crate::favorites::{favorite_group_list, favorite_list, favorite_list_custom_order};
use crate::game_log::claim_legacy_ownership;
use crate::migration::{run, NoopProgress};
use crate::ownership::{owner_id_get, OwnerId};

struct TestDir {
    path: std::path::PathBuf,
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn test_db(name: &str) -> (TestDir, DatabaseService) {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!("vrcx0-favorite-migration-{name}-{nonce}"));
    std::fs::create_dir_all(&path).unwrap();
    let db = DatabaseService::new(&path.join("test.sqlite3")).unwrap();
    (TestDir { path }, db)
}

fn exec(db: &DatabaseService, sql: &str) {
    db.execute_non_query(sql, &Default::default()).unwrap();
}

fn create_vrcx0_legacy_tables(db: &DatabaseService) {
    ensure_global_store_tables(db).unwrap();
    exec(db, "CREATE TABLE favorite_world (id INTEGER PRIMARY KEY, created_at INTEGER, world_id TEXT, group_name TEXT, sort_order INTEGER)");
    exec(db, "CREATE TABLE favorite_avatar (id INTEGER PRIMARY KEY, created_at INTEGER, avatar_id TEXT, group_name TEXT, sort_order INTEGER)");
    exec(db, "CREATE TABLE favorite_friend (id INTEGER PRIMARY KEY, created_at INTEGER, user_id TEXT, group_name TEXT, owner_id INTEGER NOT NULL DEFAULT 0, sort_order INTEGER)");
}

fn migrate(db: &DatabaseService) {
    ensure_global_store_tables(db).unwrap();
    run(db, &[migration()], &NoopProgress).unwrap();
}

fn group_names(
    db: &DatabaseService,
    owner: Option<&OwnerId>,
    kind: FavoriteEntityKind,
) -> Vec<String> {
    favorite_group_list(db, owner, kind)
        .unwrap()
        .into_iter()
        .map(|group| group.name)
        .collect()
}

fn group_id(
    db: &DatabaseService,
    owner: Option<&OwnerId>,
    kind: FavoriteEntityKind,
    name: &str,
    shared: bool,
) -> i64 {
    favorite_group_list(db, owner, kind)
        .unwrap()
        .into_iter()
        .find(|group| group.name == name && group.shared == shared)
        .unwrap()
        .id
}

#[test]
fn empty_database_migrates_without_groups() {
    let (_dir, db) = test_db("empty");
    migrate(&db);

    for kind in [
        FavoriteEntityKind::World,
        FavoriteEntityKind::Avatar,
        FavoriteEntityKind::Friend,
    ] {
        assert!(favorite_group_list(&db, None, kind).unwrap().is_empty());
        assert!(favorite_list(&db, None, kind).unwrap().is_empty());
    }
}

#[test]
fn world_groups_keep_config_order_then_row_only_names_and_preserve_item_order() {
    let (_dir, db) = test_db("world");
    create_vrcx0_legacy_tables(&db);
    config::set_json(
        &db,
        "localFavoriteWorldGroups",
        &json!(["Empty", " Chill ", "Chill"]),
    )
    .unwrap();
    exec(
        &db,
        "INSERT INTO favorite_world (created_at, world_id, group_name, sort_order) VALUES
            (1767225600, 'wrld_1', 'Chill', 1),
            (1767312000, 'wrld_2', 'Chill ', 0),
            (1767398400, 'wrld_3', 'Late', NULL),
            (1767484800, 'wrld_4', '', NULL),
            (1767571200, ' wrld_3 ', 'Late', NULL)",
    );

    run(&db, &[migration()], &NoopProgress).unwrap();

    assert_eq!(
        group_names(&db, None, FavoriteEntityKind::World),
        vec!["Empty", "Chill", "Late", "Favorites"]
    );
    let rows = favorite_list(&db, None, FavoriteEntityKind::World).unwrap();
    assert_eq!(
        rows.iter()
            .map(|row| (row.entity_id(), row.group_name.as_str(), row.created_at))
            .collect::<Vec<_>>(),
        vec![
            ("wrld_1", "Chill", 1767225600),
            ("wrld_2", "Chill", 1767312000),
            ("wrld_3", "Late", 1767398400),
            ("wrld_4", "Favorites", 1767484800),
        ]
    );
    assert_eq!(
        favorite_list_custom_order(&db, None, FavoriteEntityKind::World)
            .unwrap()
            .into_iter()
            .filter(|row| row.group_name == "Chill")
            .map(|row| row.entity_id().to_string())
            .collect::<Vec<_>>(),
        vec!["wrld_2", "wrld_1"]
    );
}

#[test]
fn account_groups_named_like_a_shared_group_fold_into_the_shared_group() {
    let (_dir, db) = test_db("friend-realms");
    create_vrcx0_legacy_tables(&db);
    exec(&db, "INSERT INTO owners (user_id) VALUES ('usr_a')");
    config::set_json(&db, "localFavoriteFriendGroups", &json!(["Shared", "Same"])).unwrap();
    config::set_json(
        &db,
        "localFavoriteFriendGroups:usr_a",
        &json!(["Mine", "Same"]),
    )
    .unwrap();
    config::set_json(&db, "localFavoriteFriendGroups:usr_b", &json!(["Other"])).unwrap();
    exec(
        &db,
        "INSERT INTO favorite_friend (created_at, user_id, group_name, owner_id) VALUES
            (1, 'usr_1', 'Same', 0),
            ('t2', 'usr_2', 'Same', 1),
            ('t3', 'usr_3', ' Shared ', 1)",
    );
    config::set_json(&db, "sidebarFavoriteGroups", &json!(["local:Same"])).unwrap();

    run(&db, &[migration()], &NoopProgress).unwrap();

    let owner_a = OwnerId::new("usr_a");
    assert_eq!(
        group_names(&db, Some(&owner_a), FavoriteEntityKind::Friend),
        vec!["Mine", "Shared", "Same"]
    );
    let same = group_id(
        &db,
        Some(&owner_a),
        FavoriteEntityKind::Friend,
        "Same",
        true,
    );
    assert_eq!(
        config::get_json(&db, "sidebarFavoriteGroups", json!(null)).unwrap(),
        json!([format!("local:{same}")])
    );
    assert_eq!(
        group_names(
            &db,
            Some(&OwnerId::new("usr_b")),
            FavoriteEntityKind::Friend
        ),
        vec!["Other", "Shared", "Same"]
    );
    assert!(owner_id_get(&db, &OwnerId::new("usr_b")).unwrap().is_some());
    let rows = favorite_list(&db, Some(&owner_a), FavoriteEntityKind::Friend).unwrap();
    assert_eq!(
        rows.iter()
            .map(|row| (
                row.entity_id(),
                row.group_name.as_str(),
                row.group_id == same
            ))
            .collect::<Vec<_>>(),
        vec![
            ("usr_1", "Same", true),
            ("usr_2", "Same", true),
            ("usr_3", "Shared", false)
        ]
    );
}

#[test]
fn login_claim_after_migration_moves_folded_groups_to_the_account() {
    let (_dir, db) = test_db("migration-then-claim");
    create_vrcx0_legacy_tables(&db);
    exec(&db, "INSERT INTO owners (user_id) VALUES ('usr_a')");
    exec(&db, "CREATE TABLE usr_a_feed_gps (id INTEGER PRIMARY KEY)");
    config::set_json(&db, "localFavoriteFriendGroups", &json!(["Same"])).unwrap();
    config::set_json(&db, "localFavoriteFriendGroups:usr_a", &json!(["Same"])).unwrap();
    exec(
        &db,
        "INSERT INTO favorite_friend (created_at, user_id, group_name, owner_id) VALUES
            (1, 'usr_1', 'Same', 0),
            ('t2', 'usr_2', 'Same', 1)",
    );
    run(&db, &[migration()], &NoopProgress).unwrap();

    claim_legacy_ownership(&db, &OwnerId::new("usr_a")).unwrap();

    let groups = favorite_group_list(
        &db,
        Some(&OwnerId::new("usr_a")),
        FavoriteEntityKind::Friend,
    )
    .unwrap();
    assert_eq!(groups.len(), 1);
    assert_eq!((groups[0].name.as_str(), groups[0].shared), ("Same", false));
    assert_eq!(
        favorite_list(
            &db,
            Some(&OwnerId::new("usr_a")),
            FavoriteEntityKind::Friend
        )
        .unwrap()
        .len(),
        2
    );
}

#[test]
fn upstream_friend_table_without_owner_or_sort_columns_migrates_to_the_shared_realm() {
    let (_dir, db) = test_db("upstream");
    exec(
        &db,
        "CREATE TABLE favorite_friend (id INTEGER PRIMARY KEY, created_at INTEGER, user_id TEXT, group_name TEXT)",
    );
    exec(
        &db,
        "INSERT INTO favorite_friend (created_at, user_id, group_name) VALUES (1, 'usr_1', 'Group''s')",
    );

    migrate(&db);

    let groups = favorite_group_list(
        &db,
        Some(&OwnerId::new("usr_a")),
        FavoriteEntityKind::Friend,
    )
    .unwrap();
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].name, "Group's");
    assert!(groups[0].shared);
    assert_eq!(
        favorite_list(&db, None, FavoriteEntityKind::Friend).unwrap()[0].group_id,
        groups[0].id
    );
}

#[test]
fn group_references_point_at_new_group_ids() {
    let (_dir, db) = test_db("references");
    ensure_global_store_tables(&db).unwrap();
    exec(&db, "INSERT INTO owners (user_id) VALUES ('usr_a')");
    config::set_json(&db, "localFavoriteFriendGroups:usr_a", &json!(["Close"])).unwrap();
    config::set_json(&db, "localFavoriteFriendGroups:usr_b", &json!(["Close"])).unwrap();
    config::set_json(&db, "localFavoriteWorldGroups", &json!(["Close"])).unwrap();
    config::set_json(
        &db,
        "sidebarFavoriteGroups",
        &json!(["friend:group_0", "local:Close", "local:Missing"]),
    )
    .unwrap();
    config::set_json(
        &db,
        "presenceAutomationContextRules",
        &json!([{"selectedGroups": ["local:Close"], "selectedWorldGroups": ["local:Close"]}]),
    )
    .unwrap();
    config::set_json(
        &db,
        "VRCX_FavoritesWorldSelectedGroup",
        &json!({"key": "Close", "source": "local"}),
    )
    .unwrap();

    run(&db, &[migration()], &NoopProgress).unwrap();

    let account_a = group_id(
        &db,
        Some(&OwnerId::new("usr_a")),
        FavoriteEntityKind::Friend,
        "Close",
        false,
    );
    let account_b = group_id(
        &db,
        Some(&OwnerId::new("usr_b")),
        FavoriteEntityKind::Friend,
        "Close",
        false,
    );
    let world = group_id(&db, None, FavoriteEntityKind::World, "Close", false);
    let mut friend_refs = vec![format!("local:{account_a}"), format!("local:{account_b}")];
    friend_refs.sort();
    let sidebar = config::get_json(&db, "sidebarFavoriteGroups", json!(null)).unwrap();
    let sidebar = sidebar.as_array().unwrap();
    assert_eq!(sidebar[0], json!("friend:group_0"));
    let mut expanded = sidebar[1..3]
        .iter()
        .map(|value| value.as_str().unwrap().to_string())
        .collect::<Vec<_>>();
    expanded.sort();
    assert_eq!(expanded, friend_refs);
    assert_eq!(sidebar.len(), 3);
    assert_eq!(
        config::get_json(&db, "presenceAutomationContextRules", json!(null)).unwrap()[0]
            ["selectedWorldGroups"],
        json!([format!("local:{world}")])
    );
    assert_eq!(
        config::get_json(&db, "VRCX_FavoritesWorldSelectedGroup", json!(null)).unwrap(),
        json!({"key": world.to_string(), "source": "local"})
    );
}

#[test]
fn tables_seeded_by_upstream_are_kept_and_store_epoch_seconds() {
    let (_dir, db) = test_db("upstream-seeded");
    exec(&db, "CREATE TABLE vrcx0_favorite_group (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, owner_id INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL, sort_order INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE (kind, owner_id, name))");
    exec(&db, "CREATE TABLE vrcx0_favorite_item (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL, entity_id TEXT NOT NULL, sort_order INTEGER, created_at TEXT NOT NULL, UNIQUE (group_id, entity_id))");
    exec(&db, "INSERT INTO vrcx0_favorite_group (kind, owner_id, name, sort_order, created_at) VALUES ('world', 0, 'Chill', 0, '2026-01-01T00:00:00.000Z')");
    exec(&db, "INSERT INTO vrcx0_favorite_item (group_id, entity_id, created_at) VALUES (1, 'wrld_1', '2026-01-02T00:00:00.000Z')");
    exec(&db, "CREATE TABLE favorite_world (id INTEGER PRIMARY KEY, created_at INTEGER, world_id TEXT, group_name TEXT, sort_order INTEGER)");
    exec(&db, "INSERT INTO favorite_world (created_at, world_id, group_name) VALUES (1767225600, 'wrld_stale', 'Stale')");

    migrate(&db);

    assert_eq!(
        group_names(&db, None, FavoriteEntityKind::World),
        vec!["Chill"]
    );
    let rows = favorite_list(&db, None, FavoriteEntityKind::World).unwrap();
    assert_eq!(
        rows.iter()
            .map(|row| (row.entity_id(), row.created_at))
            .collect::<Vec<_>>(),
        vec![("wrld_1", 1767312000)]
    );
    let stored_type: String = db
        .execute(
            "SELECT typeof(created_at) FROM vrcx0_favorite_group",
            &Default::default(),
        )
        .unwrap()[0][0]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(stored_type, "integer");
}
