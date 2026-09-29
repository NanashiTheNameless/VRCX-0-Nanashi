use super::*;

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

fn write_legacy_db(dir: &TestDir, version: i64) -> PathBuf {
    let db_path = dir.path.join("VRCX.sqlite3");
    let conn = Connection::open(&db_path).unwrap();
    conn.execute_batch("CREATE TABLE configs (key TEXT PRIMARY KEY, value TEXT);")
        .unwrap();
    conn.execute(
        "INSERT INTO configs (key, value) VALUES ('config:vrcx_databaseversion', ?1)",
        [version.to_string()],
    )
    .unwrap();
    db_path
}

fn source(db_path: PathBuf, version: i64) -> LegacyVrcxSource {
    LegacyVrcxSource {
        db_path,
        config_path: None,
        version,
    }
}

#[test]
fn rejects_upstream_version_above_import_ceiling() {
    let dir = TestDir::new("legacy-reject");
    let version = MAX_IMPORTABLE_UPSTREAM_VERSION + 1;
    let db_path = write_legacy_db(&dir, version);

    let error = validate_legacy_source(&source(db_path, version)).unwrap_err();

    assert!(error.contains("not supported yet"), "unexpected: {error}");
    assert!(error.contains(&version.to_string()), "unexpected: {error}");
}

#[test]
fn accepts_version_at_import_ceiling() {
    let dir = TestDir::new("legacy-accept");
    let db_path = write_legacy_db(&dir, MAX_IMPORTABLE_UPSTREAM_VERSION);

    assert!(validate_legacy_source(&source(db_path, MAX_IMPORTABLE_UPSTREAM_VERSION)).is_ok());
}

#[test]
fn existing_vrcx0_target_skips_auto_migration_without_version_gate() {
    let dir = TestDir::new("legacy-target-present");
    let target_db = dir.path.join("VRCX-0.sqlite3");
    let target_config = dir.path.join("VRCX-0.json");
    std::fs::write(&target_db, b"already-created").unwrap();

    let discovery = discover_legacy_vrcx_migration(&target_db, &target_config);

    assert!(discovery.importable_source.is_none());
    assert!(!discovery.status.detected);
    assert!(!discovery.status.available);
    assert_eq!(discovery.status.version, None);
}

fn write_legacy_config(dir: &TestDir, content: &str) -> PathBuf {
    let config_path = dir.path.join("VRCX.json");
    std::fs::write(&config_path, content).unwrap();
    config_path
}

#[test]
fn legacy_database_location_reads_trimmed_value_from_json() {
    let dir = TestDir::new("legacy-loc-ok");
    let config_path = write_legacy_config(
        &dir,
        r#"{"VRCX_DatabaseLocation": "  C:\\custom\\VRCX.sqlite3  "}"#,
    );

    let location = legacy_database_location(&config_path).unwrap();

    assert_eq!(location, PathBuf::from("C:\\custom\\VRCX.sqlite3"));
}

#[test]
fn legacy_database_location_none_for_missing_key() {
    let dir = TestDir::new("legacy-loc-missing-key");
    let config_path = write_legacy_config(&dir, r#"{"OtherKey": "value"}"#);

    assert!(legacy_database_location(&config_path).is_none());
}

#[test]
fn legacy_database_location_none_for_empty_or_blank_value() {
    let dir = TestDir::new("legacy-loc-blank");
    let config_path = write_legacy_config(&dir, r#"{"VRCX_DatabaseLocation": "   "}"#);

    assert!(legacy_database_location(&config_path).is_none());
}

#[test]
fn legacy_database_location_none_for_malformed_json() {
    let dir = TestDir::new("legacy-loc-malformed");
    let config_path = write_legacy_config(&dir, "{not valid json");

    assert!(legacy_database_location(&config_path).is_none());
}

#[test]
fn legacy_database_location_none_for_missing_file() {
    let dir = TestDir::new("legacy-loc-nofile");
    let config_path = dir.path.join("VRCX.json");

    assert!(legacy_database_location(&config_path).is_none());
}

#[test]
fn resolve_legacy_config_path_prefers_json_over_extensionless() {
    let dir = TestDir::new("legacy-cfg-prefer-json");
    std::fs::write(dir.path.join("VRCX.json"), "{}").unwrap();
    std::fs::write(dir.path.join("VRCX"), "{}").unwrap();

    let resolved = resolve_legacy_config_path(&dir.path).unwrap();

    assert_eq!(resolved, dir.path.join("VRCX.json"));
}

#[test]
fn resolve_legacy_config_path_falls_back_to_extensionless() {
    let dir = TestDir::new("legacy-cfg-fallback");
    std::fs::write(dir.path.join("VRCX"), "{}").unwrap();

    let resolved = resolve_legacy_config_path(&dir.path).unwrap();

    assert_eq!(resolved, dir.path.join("VRCX"));
}

#[test]
fn resolve_legacy_config_path_none_when_absent() {
    let dir = TestDir::new("legacy-cfg-absent");

    assert!(resolve_legacy_config_path(&dir.path).is_none());
}

#[test]
fn resolve_legacy_database_path_prefers_config_location_when_it_exists() {
    let dir = TestDir::new("legacy-db-prefer-config");
    let custom_db_dir = TestDir::new("legacy-db-custom-target");
    let custom_db_path = custom_db_dir.path.join("Custom.sqlite3");
    std::fs::write(&custom_db_path, b"custom").unwrap();
    std::fs::write(dir.path.join("VRCX.sqlite3"), b"default").unwrap();
    let config_path = write_legacy_config(
        &dir,
        &format!(
            r#"{{"VRCX_DatabaseLocation": "{}"}}"#,
            custom_db_path.to_string_lossy().replace('\\', "\\\\")
        ),
    );

    let resolved = resolve_legacy_database_path(&dir.path, Some(config_path.as_path())).unwrap();

    assert_eq!(resolved, custom_db_path);
}

#[test]
fn resolve_legacy_database_path_falls_back_to_default_when_config_target_missing() {
    let dir = TestDir::new("legacy-db-fallback-missing-config-target");
    std::fs::write(dir.path.join("VRCX.sqlite3"), b"default").unwrap();
    let config_path = write_legacy_config(
        &dir,
        r#"{"VRCX_DatabaseLocation": "C:\\does\\not\\exist.sqlite3"}"#,
    );

    let resolved = resolve_legacy_database_path(&dir.path, Some(config_path.as_path())).unwrap();

    assert_eq!(resolved, dir.path.join("VRCX.sqlite3"));
}

#[test]
fn resolve_legacy_database_path_uses_default_without_config() {
    let dir = TestDir::new("legacy-db-no-config");
    std::fs::write(dir.path.join("VRCX.sqlite3"), b"default").unwrap();

    let resolved = resolve_legacy_database_path(&dir.path, None).unwrap();

    assert_eq!(resolved, dir.path.join("VRCX.sqlite3"));
}

#[test]
fn resolve_legacy_database_path_none_when_nothing_present() {
    let dir = TestDir::new("legacy-db-none");

    assert!(resolve_legacy_database_path(&dir.path, None).is_none());
}

#[test]
fn read_legacy_database_version_errors_without_configs_table() {
    let dir = TestDir::new("legacy-version-no-table");
    let db_path = dir.path.join("VRCX.sqlite3");
    Connection::open(&db_path).unwrap();

    let error = read_legacy_database_version(&db_path).unwrap_err();

    assert!(
        error.contains("does not contain a configs table"),
        "unexpected: {error}"
    );
}

#[test]
fn read_legacy_database_version_defaults_to_zero_without_key() {
    let dir = TestDir::new("legacy-version-no-key");
    let db_path = dir.path.join("VRCX.sqlite3");
    let conn = Connection::open(&db_path).unwrap();
    conn.execute_batch("CREATE TABLE configs (key TEXT PRIMARY KEY, value TEXT);")
        .unwrap();

    let version = read_legacy_database_version(&db_path).unwrap();

    assert_eq!(version, 0);
}

#[test]
fn read_legacy_database_version_errors_on_non_numeric_value() {
    let dir = TestDir::new("legacy-version-bad-value");
    let db_path = dir.path.join("VRCX.sqlite3");
    let conn = Connection::open(&db_path).unwrap();
    conn.execute_batch("CREATE TABLE configs (key TEXT PRIMARY KEY, value TEXT);")
        .unwrap();
    conn.execute(
        "INSERT INTO configs (key, value) VALUES ('config:vrcx_databaseversion', 'not-a-number')",
        [],
    )
    .unwrap();

    let error = read_legacy_database_version(&db_path).unwrap_err();

    assert!(error.contains("is invalid"), "unexpected: {error}");
}

#[test]
fn dedupe_paths_keeps_first_occurrence_order_and_distinct_case() {
    let input = vec![
        PathBuf::from("C:\\Users\\a\\VRCX"),
        PathBuf::from("C:\\Users\\a\\b"),
        PathBuf::from("C:\\Users\\a\\VRCX"),
        PathBuf::from("C:\\Users\\a\\vrcx"),
    ];

    let result = dedupe_paths(input);

    assert_eq!(
        result,
        vec![
            PathBuf::from("C:\\Users\\a\\VRCX"),
            PathBuf::from("C:\\Users\\a\\b"),
            PathBuf::from("C:\\Users\\a\\vrcx"),
        ]
    );
}
