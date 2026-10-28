use super::*;
use rusqlite::Connection;

struct TestDir(PathBuf);
impl TestDir {
    fn new() -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "nanashi-auto-import-{}-{nonce}",
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

fn source(root: &Path, original_vrcx: bool) -> (Source, Connection) {
    let directory = root.join("source");
    fs::create_dir(&directory).unwrap();
    let database = directory.join(if original_vrcx {
        "VRCX.sqlite3"
    } else {
        DATABASE
    });
    let conn = Connection::open(&database).unwrap();
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE configs(key TEXT PRIMARY KEY, value TEXT); INSERT INTO configs VALUES ('config:vrcx_databaseversion','18'); CREATE TABLE history(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO history VALUES (1,'kept');").unwrap();
    let settings = directory.join(if original_vrcx { "VRCX.json" } else { SETTINGS });
    fs::write(&settings, br#"{"setting":"kept"}"#).unwrap();
    (
        Source {
            directory,
            database,
            settings: Some(settings),
            original_vrcx,
        },
        conn,
    )
}

fn target(root: &Path) -> PathBuf {
    let target = root.join("target");
    fs::create_dir(&target).unwrap();
    fs::write(target.join("runtime.lock"), b"active").unwrap();
    target
}

#[test]
fn imports_both_upstreams_with_wal_settings_and_user_files_without_source_writes() {
    for original in [false, true] {
        let dir = TestDir::new();
        let (source, conn) = source(&dir.0, original);
        let target = target(&dir.0);
        fs::create_dir(source.directory.join("backups")).unwrap();
        fs::write(
            source.directory.join("backups/VRCX-personal.sqlite3"),
            b"backup",
        )
        .unwrap();
        fs::write(source.directory.join(".private-user-file"), b"secret").unwrap();
        fs::write(
            source.directory.join("VRCX-0.data-dir.json"),
            b"do not follow",
        )
        .unwrap();
        fs::write(
            source.directory.join("pending_profile_restore.json"),
            b"do not restore",
        )
        .unwrap();
        let before = family_hashes(&source.database).unwrap();
        let shm_before = fs::read(sibling(&source.database, "-shm")).unwrap();
        import_with_sources(&target, || Ok(Some(source.clone()))).unwrap();
        assert_eq!(family_hashes(&source.database).unwrap(), before);
        assert_eq!(
            fs::read(sibling(&source.database, "-shm")).unwrap(),
            shm_before
        );
        assert_eq!(
            fs::read(target.join("backups/VRCX-personal.sqlite3")).unwrap(),
            b"backup"
        );
        assert_eq!(
            fs::read(target.join(".private-user-file")).unwrap(),
            b"secret"
        );
        assert!(!target.join("VRCX-0.data-dir.json").exists());
        assert!(!target.join("pending_profile_restore.json").exists());
        crate::profile_names::migrate_profile_names(&target).unwrap();
        let db = Connection::open(target.join(crate::profile_names::DATABASE_FILE)).unwrap();
        let value: String = db
            .query_row("SELECT value FROM history WHERE id=1", [], |row| row.get(0))
            .unwrap();
        assert_eq!(value, "kept");
        assert_eq!(
            fs::read(target.join(crate::profile_names::SETTINGS_FILE)).unwrap(),
            br#"{"setting":"kept"}"#
        );
        assert!(!target.join(STAGING).exists());
        drop(conn);
    }
}

#[test]
fn existing_profiles_take_priority_without_discovering_other_sources() {
    for name in [
        DATABASE,
        SETTINGS,
        "VRCX-0-Nanashi.sqlite3",
        "VRCX-0-Nanashi.json",
    ] {
        let dir = TestDir::new();
        let target = target(&dir.0);
        fs::write(target.join(name), b"current").unwrap();
        if name == crate::profile_names::DATABASE_FILE {
            fs::create_dir(target.join(STAGING)).unwrap();
            fs::write(target.join(STAGING).join(READY), b"stale marker").unwrap();
        }
        import_with_sources(&target, || panic!("must keep the existing profile")).unwrap();
        assert_eq!(fs::read(target.join(name)).unwrap(), b"current");
    }
}

#[test]
fn unsupported_or_corrupt_source_never_publishes_profile_files() {
    for corrupt in [false, true] {
        let dir = TestDir::new();
        let (source, conn) = source(&dir.0, true);
        conn.execute("UPDATE configs SET value='999'", []).unwrap();
        drop(conn);
        if corrupt {
            fs::write(&source.database, b"corrupt").unwrap();
        }
        let before = fs::read(&source.database).unwrap();
        let target = target(&dir.0);
        assert!(import_with_sources(&target, || Ok(Some(source.clone()))).is_err());
        assert!(!target.join(DATABASE).exists());
        assert!(!target.join(SETTINGS).exists());
        assert_eq!(fs::read(&source.database).unwrap(), before);
    }
}

#[test]
fn interrupted_publish_resumes_and_never_overwrites_conflicting_files() {
    let dir = TestDir::new();
    let (source, conn) = source(&dir.0, false);
    let target = target(&dir.0);
    fs::write(source.directory.join("memo.txt"), b"source memo").unwrap();
    fs::write(target.join("memo.txt"), b"existing memo").unwrap();
    assert!(import_with_sources(&target, || Ok(Some(source))).is_err());
    assert!(!target.join(DATABASE).exists());
    assert_eq!(fs::read(target.join("memo.txt")).unwrap(), b"existing memo");
    fs::rename(target.join("memo.txt"), target.join("saved-memo.txt")).unwrap();
    import_with_sources(&target, || panic!("resume the staged snapshot")).unwrap();
    assert!(target.join(DATABASE).is_file());
    assert_eq!(fs::read(target.join("memo.txt")).unwrap(), b"source memo");
    assert_eq!(
        fs::read(target.join("saved-memo.txt")).unwrap(),
        b"existing memo"
    );
    drop(conn);
}

#[test]
fn incomplete_copy_is_retried_and_damaged_ready_snapshot_is_preserved() {
    let dir = TestDir::new();
    let (source, conn) = source(&dir.0, false);
    let target = target(&dir.0);
    let staging = target.join(STAGING);
    fs::create_dir(&staging).unwrap();
    fs::write(staging.join(DATABASE), b"partial").unwrap();
    import_with_sources(&target, || Ok(Some(source))).unwrap();
    assert!(target.join(DATABASE).is_file());
    fs::create_dir(&staging).unwrap();
    fs::write(staging.join(READY), br#"{"database_hash":"wrong"}"#).unwrap();
    fs::write(staging.join(DATABASE), b"damaged").unwrap();
    let before = fs::read(target.join(DATABASE)).unwrap();
    assert!(import_with_sources(&target, || panic!("must preserve ready snapshot")).is_err());
    assert_eq!(fs::read(target.join(DATABASE)).unwrap(), before);
    assert!(staging.exists());
    drop(conn);
}

#[test]
fn discovery_prefers_vrcx0_and_follows_both_custom_location_formats() {
    let root0 = TestDir::new();
    let (vrcx0, conn0) = source(&root0.0, false);
    let pointer_directory = root0.0.join("upstream-default");
    fs::create_dir(&pointer_directory).unwrap();
    fs::write(
        pointer_directory.join("VRCX-0.data-dir.json"),
        serde_json::to_vec(&serde_json::json!({"dataDir": vrcx0.directory})).unwrap(),
    )
    .unwrap();
    let root_original = TestDir::new();
    let (original, conn_original) = source(&root_original.0, true);
    let selected = discover_source_from_dirs(
        Some(&pointer_directory),
        std::slice::from_ref(&original.directory),
    )
    .unwrap()
    .unwrap();
    assert_eq!(selected.database, vrcx0.database);
    assert!(!selected.original_vrcx);
    let external_database = root_original.0.join("elsewhere.sqlite3");
    drop(conn_original);
    fs::rename(&original.database, &external_database).unwrap();
    fs::write(
        original.settings.as_ref().unwrap(),
        serde_json::to_vec(&serde_json::json!({"VRCX_DatabaseLocation": "../elsewhere.sqlite3"}))
            .unwrap(),
    )
    .unwrap();
    let selected = discover_source_from_dirs(None, &[original.directory])
        .unwrap()
        .unwrap();
    assert_eq!(
        selected.database.canonicalize().unwrap(),
        external_database.canonicalize().unwrap()
    );
    assert!(selected.original_vrcx);
    drop(conn0);
}

#[test]
fn missing_or_invalid_custom_locations_never_fall_back_to_an_empty_profile() {
    let root = TestDir::new();
    let pointer = root.0.join("VRCX-0.data-dir.json");
    fs::write(&pointer, br#"{"dataDir":"missing"}"#).unwrap();
    assert!(discover_source_from_dirs(Some(&root.0), &[]).is_err());
    fs::write(&pointer, b"broken json").unwrap();
    assert!(discover_source_from_dirs(Some(&root.0), &[]).is_err());
    let (original, conn) = source(&root.0, true);
    fs::write(
        original.settings.unwrap(),
        br#"{"VRCX_DatabaseLocation":"missing.sqlite3"}"#,
    )
    .unwrap();
    assert!(discover_source_from_dirs(None, &[original.directory]).is_err());
    drop(conn);
}

#[cfg(not(windows))]
#[test]
fn resolves_windows_database_locations_inside_a_wine_prefix() {
    let root = TestDir::new();
    let directory = root
        .0
        .join("prefix/drive_c/users/wine-user/AppData/Roaming/VRCX");
    fs::create_dir_all(&directory).unwrap();
    let expected = root.0.join("prefix/drive_c/history/VRCX.sqlite3");
    assert_eq!(
        resolve_database_location(&directory, r"C:\history\VRCX.sqlite3"),
        expected
    );
    assert_eq!(
        resolve_database_location(&directory, "c:/history/VRCX.sqlite3"),
        expected
    );
}

#[test]
fn discovers_extensionless_original_settings() {
    let root = TestDir::new();
    let (original, conn) = source(&root.0, true);
    fs::rename(original.settings.unwrap(), original.directory.join("VRCX")).unwrap();
    let selected = discover_source_from_dirs(None, std::slice::from_ref(&original.directory))
        .unwrap()
        .unwrap();
    assert_eq!(selected.settings, Some(original.directory.join("VRCX")));
    drop(conn);
}

#[test]
fn recovers_a_copied_hot_journal_without_committing_or_changing_the_source() {
    let root = TestDir::new();
    let (source, conn) = source(&root.0, false);
    conn.execute_batch(
        "PRAGMA journal_mode=DELETE; BEGIN IMMEDIATE; UPDATE history SET value='uncommitted';",
    )
    .unwrap();
    conn.cache_flush().unwrap();
    assert!(sibling(&source.database, "-journal").is_file());
    let original = family_hashes(&source.database).unwrap();
    let target = target(&root.0);
    import_with_sources(&target, || Ok(Some(source.clone()))).unwrap();
    assert_eq!(family_hashes(&source.database).unwrap(), original);
    let imported = Connection::open(target.join(DATABASE)).unwrap();
    let value: String = imported
        .query_row("SELECT value FROM history WHERE id=1", [], |row| row.get(0))
        .unwrap();
    assert_eq!(value, "kept");
    let pending: String = conn
        .query_row("SELECT value FROM history WHERE id=1", [], |row| row.get(0))
        .unwrap();
    assert_eq!(pending, "uncommitted");
    conn.execute_batch("ROLLBACK").unwrap();
}

#[cfg(unix)]
#[test]
fn imported_auxiliary_tools_keep_their_executable_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let root = TestDir::new();
    let (source, conn) = source(&root.0, false);
    let tool = source.directory.join("user-tool");
    fs::write(&tool, b"tool").unwrap();
    fs::set_permissions(&tool, fs::Permissions::from_mode(0o700)).unwrap();
    let target = target(&root.0);
    import_with_sources(&target, || Ok(Some(source))).unwrap();
    assert_eq!(
        fs::metadata(target.join(DATABASE))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    assert_eq!(
        fs::metadata(target.join("user-tool"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    drop(conn);
}
