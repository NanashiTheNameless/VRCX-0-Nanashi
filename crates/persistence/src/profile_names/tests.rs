use super::*;
use rusqlite::Connection;

struct TestDir(std::path::PathBuf);
impl TestDir {
    fn new() -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "nanashi-profile-names-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn legacy_database(directory: &Path) -> Connection {
    let conn = Connection::open(directory.join(LEGACY_DATABASE)).unwrap();
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE history (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO history VALUES (1, 'preserved');").unwrap();
    conn
}
fn value(path: &Path) -> String {
    Connection::open(path)
        .unwrap()
        .query_row("SELECT value FROM history WHERE id=1", [], |row| row.get(0))
        .unwrap()
}

#[test]
fn migration_includes_committed_wal_and_preserves_originals() {
    let dir = TestDir::new();
    let conn = legacy_database(&dir.0);
    fs::write(dir.0.join(LEGACY_SETTINGS), br#"{"setting":"kept"}"#).unwrap();
    let original = fs::read(dir.0.join(LEGACY_DATABASE)).unwrap();
    let wal = fs::read(dir.0.join(format!("{LEGACY_DATABASE}-wal"))).unwrap();
    migrate_profile_names(&dir.0).unwrap();
    assert_eq!(value(&dir.0.join(DATABASE_FILE)), "preserved");
    assert_eq!(
        fs::read(dir.0.join(SETTINGS_FILE)).unwrap(),
        br#"{"setting":"kept"}"#
    );
    assert_eq!(fs::read(dir.0.join(LEGACY_DATABASE)).unwrap(), original);
    assert_eq!(
        fs::read(dir.0.join(format!("{LEGACY_DATABASE}-wal"))).unwrap(),
        wal
    );
    assert!(!dir.0.join(format!("{DATABASE_FILE}-wal")).exists());
    drop(conn);
}

#[test]
fn retries_partial_staging_and_keeps_existing_new_settings() {
    let dir = TestDir::new();
    drop(legacy_database(&dir.0));
    fs::write(dir.0.join(SETTINGS_FILE), br#"{"new":"kept"}"#).unwrap();
    fs::write(dir.0.join(LEGACY_SETTINGS), br#"{"old":"ignored"}"#).unwrap();
    fs::create_dir(dir.0.join(STAGING)).unwrap();
    fs::write(dir.0.join(STAGING).join(DATABASE_FILE), b"partial snapshot").unwrap();
    migrate_profile_names(&dir.0).unwrap();
    assert_eq!(value(&dir.0.join(DATABASE_FILE)), "preserved");
    assert_eq!(
        fs::read(dir.0.join(SETTINGS_FILE)).unwrap(),
        br#"{"new":"kept"}"#
    );
    Connection::open(dir.0.join(DATABASE_FILE))
        .unwrap()
        .execute("UPDATE history SET value='new'", [])
        .unwrap();
    migrate_profile_names(&dir.0).unwrap();
    assert_eq!(value(&dir.0.join(DATABASE_FILE)), "new");
}

#[test]
fn invalid_database_or_settings_never_publishes_a_new_database() {
    for corrupt_database in [false, true] {
        let dir = TestDir::new();
        if corrupt_database {
            fs::write(dir.0.join(LEGACY_DATABASE), b"corrupt").unwrap();
        } else {
            drop(legacy_database(&dir.0));
        }
        fs::write(dir.0.join(LEGACY_SETTINGS), b"corrupt json").unwrap();
        assert!(migrate_profile_names(&dir.0).is_err());
        assert!(!dir.0.join(DATABASE_FILE).exists());
        assert!(!dir.0.join(SETTINGS_FILE).exists());
        assert!(dir.0.join(LEGACY_DATABASE).exists());
    }
}

#[test]
fn orphan_destination_sidecars_are_preserved_and_block_migration() {
    let dir = TestDir::new();
    drop(legacy_database(&dir.0));
    let wal = dir.0.join(format!("{DATABASE_FILE}-wal"));
    fs::write(&wal, b"valuable").unwrap();
    assert!(migrate_profile_names(&dir.0).is_err());
    assert!(!dir.0.join(DATABASE_FILE).exists());
    assert_eq!(fs::read(wal).unwrap(), b"valuable");
}

#[test]
fn empty_and_settings_only_profiles_are_supported() {
    let dir = TestDir::new();
    migrate_profile_names(&dir.0).unwrap();
    assert!(!dir.0.join(DATABASE_FILE).exists());
    fs::write(dir.0.join(LEGACY_SETTINGS), b"{}").unwrap();
    migrate_profile_names(&dir.0).unwrap();
    assert_eq!(fs::read(dir.0.join(SETTINGS_FILE)).unwrap(), b"{}");
    assert!(!dir.0.join(DATABASE_FILE).exists());
}

#[test]
fn pending_backup_restore_recovers_corrupt_legacy_database_before_rename() {
    use crate::profile_backup::{
        create_backup_archive, read_profile_database_version, request_staged_profile_restore,
        validate_and_stage_profile_restore, ProfileBackupKind, ProfileBackupManifestMetadata,
    };
    let dir = TestDir::new();
    let snapshot = dir.0.join("snapshot.sqlite3");
    let db = crate::DatabaseService::new(&snapshot).unwrap();
    crate::config::set_string(&db, "rename-sentinel", "restored").unwrap();
    crate::write_vrcx0_schema_version(&db, crate::VRCX0_SCHEMA_VERSION).unwrap();
    drop(db);
    let archive = dir.0.join("old.vrcx0backup");
    create_backup_archive(
        &snapshot,
        &archive,
        ProfileBackupManifestMetadata {
            app_version: "3.0.0".into(),
            db_version: read_profile_database_version(&snapshot).unwrap(),
            created_at: 1784014200,
            platform: "linux".into(),
            kind: ProfileBackupKind::Manual,
        },
    )
    .unwrap();
    let validation = validate_and_stage_profile_restore(&archive, &dir.0, "3.0.1")
        .unwrap()
        .validation
        .unwrap();
    request_staged_profile_restore(&dir.0, &validation).unwrap();
    fs::write(dir.0.join(LEGACY_DATABASE), b"corrupt original").unwrap();
    migrate_profile_names(&dir.0).unwrap();
    assert!(!crate::profile_backup::has_pending_profile_restore(&dir.0));
    let db = crate::DatabaseService::new(&dir.0.join(DATABASE_FILE)).unwrap();
    assert_eq!(
        crate::config::get_raw(&db, "rename-sentinel")
            .unwrap()
            .as_deref(),
        Some("restored")
    );
    let rollbacks = dir
        .0
        .join(crate::profile_backup::RESTORE_ROLLBACK_DIRECTORY);
    let rollback = fs::read_dir(rollbacks)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    assert_eq!(
        fs::read(rollback.join(LEGACY_DATABASE)).unwrap(),
        b"corrupt original"
    );
}

#[test]
fn mixed_filenames_restore_settings_without_replacing_the_new_database() {
    let dir = TestDir::new();
    drop(legacy_database(&dir.0));
    crate::legacy_migration::copy_database_snapshot(
        &dir.0.join(LEGACY_DATABASE),
        &dir.0.join(DATABASE_FILE),
        |_, _| {},
    )
    .unwrap();
    Connection::open(dir.0.join(DATABASE_FILE))
        .unwrap()
        .execute("UPDATE history SET value='current'", [])
        .unwrap();
    fs::write(dir.0.join(LEGACY_SETTINGS), br#"{"setting":"recovered"}"#).unwrap();
    migrate_profile_names(&dir.0).unwrap();
    assert_eq!(value(&dir.0.join(DATABASE_FILE)), "current");
    assert_eq!(
        fs::read(dir.0.join(SETTINGS_FILE)).unwrap(),
        br#"{"setting":"recovered"}"#
    );
    assert_eq!(value(&dir.0.join(LEGACY_DATABASE)), "preserved");
}
