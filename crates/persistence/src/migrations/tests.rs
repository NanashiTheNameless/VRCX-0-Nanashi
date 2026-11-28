use super::reconcile_upstream_database;
use crate::migration::migration_version;
use crate::DatabaseService;

struct TestDir(std::path::PathBuf);

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn test_db(name: &str, favorite_date_type: &str, version: i64) -> (TestDir, DatabaseService) {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!("vrcx0-reconcile-{name}-{nonce}"));
    std::fs::create_dir_all(&path).unwrap();
    let db = DatabaseService::new(&path.join("test.sqlite3")).unwrap();
    db.execute_non_query(
        &format!("CREATE TABLE vrcx0_favorite_group (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, owner_id INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL, sort_order INTEGER NOT NULL, created_at {favorite_date_type} NOT NULL)"),
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        &format!("PRAGMA user_version = {version}"),
        &Default::default(),
    )
    .unwrap();
    (TestDir(path), db)
}

#[test]
fn database_numbered_by_upstream_starts_again_from_version_zero() {
    let (_dir, db) = test_db("upstream", "TEXT", 1);
    assert!(reconcile_upstream_database(&db).unwrap());
    assert_eq!(migration_version(&db).unwrap(), 0);
}

#[test]
fn fork_database_keeps_its_version() {
    let (_dir, db) = test_db("fork", "INTEGER", 2);
    assert!(!reconcile_upstream_database(&db).unwrap());
    assert_eq!(migration_version(&db).unwrap(), 2);
}
