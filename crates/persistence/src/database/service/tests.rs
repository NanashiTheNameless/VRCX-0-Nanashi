use super::upgrade::status_temporary_path;
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

#[test]
fn executes_daily_named_parameter_reads_and_writes() -> Result<(), Error> {
    let dir = TestDir::new("sqlite-daily");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let empty = HashMap::new();

    db.execute_non_query(
        "CREATE TABLE daily_items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, visits INTEGER NOT NULL)",
        &empty,
    )?;

    let mut args = HashMap::new();
    args.insert("@id".to_string(), serde_json::json!(1));
    args.insert("@name".to_string(), serde_json::json!("trusted"));
    args.insert("@visits".to_string(), serde_json::json!(3));
    assert_eq!(
        db.execute_non_query(
            "INSERT INTO daily_items (id, name, visits) VALUES (@id, @name, @visits)",
            &args,
        )?,
        1
    );

    let mut update_args = HashMap::new();
    update_args.insert("@id".to_string(), serde_json::json!(1));
    update_args.insert("@visits".to_string(), serde_json::json!(4));
    assert_eq!(
        db.execute_non_query(
            "UPDATE daily_items SET visits = @visits WHERE id = @id",
            &update_args,
        )?,
        1
    );

    let rows = db.execute(
        "SELECT name, visits FROM daily_items WHERE id = @id",
        &update_args,
    )?;

    assert_eq!(
        rows,
        vec![vec![serde_json::json!("trusted"), serde_json::json!(4)]]
    );
    Ok(())
}

#[test]
fn interruptible_read_stops_work_and_releases_its_reader() -> Result<(), Error> {
    let dir = TestDir::new("sqlite-interruptible-read");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let empty = HashMap::new();

    let interrupted = db.execute_interruptible(
        "WITH RECURSIVE numbers(value) AS (VALUES(1) UNION ALL SELECT value + 1 FROM numbers WHERE value < 1000000) SELECT SUM(value) FROM numbers",
        &empty,
        || true,
    );
    assert!(matches!(
        interrupted,
        Err(Error::Sqlite { ref message, .. }) if message.contains("interrupted")
    ));

    assert_eq!(
        db.execute("SELECT 1", &empty)?,
        vec![vec![serde_json::json!(1)]]
    );
    assert_eq!(
        db.execute("SELECT 2", &empty)?,
        vec![vec![serde_json::json!(2)]]
    );
    Ok(())
}

#[test]
fn interruptible_read_can_cancel_while_all_readers_are_busy() -> Result<(), Error> {
    let dir = TestDir::new("sqlite-interruptible-reader-wait");
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
    let (ready_tx, ready_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let held_db = Arc::clone(&db);
    let holder = std::thread::spawn(move || {
        let inner = held_db.inner.read().unwrap();
        let DatabaseMode::Main(main) = &*inner else {
            panic!("expected main database");
        };
        let _first = main.readers[0].lock().unwrap();
        let _second = main.readers[1].lock().unwrap();
        ready_tx.send(()).unwrap();
        release_rx.recv().unwrap();
    });
    ready_rx.recv().unwrap();

    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let cancel_flag = Arc::clone(&cancelled);
    let canceller = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(20));
        cancel_flag.store(true, Ordering::Release);
    });
    let empty = HashMap::new();
    let wait_started = std::time::Instant::now();
    let query_cancelled = Arc::clone(&cancelled);
    let result = db.execute_interruptible("SELECT 1", &empty, move || {
        query_cancelled.load(Ordering::Acquire)
    });

    release_tx.send(()).unwrap();
    holder.join().unwrap();
    canceller.join().unwrap();
    assert!(matches!(
        result,
        Err(Error::Database(ref message)) if message.contains("interrupted")
    ));
    assert!(wait_started.elapsed() < Duration::from_secs(1));
    Ok(())
}

#[test]
fn configured_writer_trades_secure_delete_and_full_sync_for_write_throughput() -> Result<(), Error>
{
    let conn = Connection::open_in_memory().map_err(|e| Error::Database(e.to_string()))?;
    configure_connection(&conn)?;
    let secure_delete = conn
        .query_row("PRAGMA secure_delete;", [], |row| row.get::<_, i64>(0))
        .map_err(|e| Error::Database(e.to_string()))?;
    let synchronous = conn
        .query_row("PRAGMA synchronous;", [], |row| row.get::<_, i64>(0))
        .map_err(|e| Error::Database(e.to_string()))?;
    assert_eq!(secure_delete, 0);
    assert_eq!(synchronous, 1);
    Ok(())
}

#[test]
fn configured_reader_sorts_in_memory_while_the_writer_keeps_spilling_to_disk() -> Result<(), Error>
{
    let reader = Connection::open_in_memory().map_err(|e| Error::Database(e.to_string()))?;
    configure_read_connection(&reader)?;
    let writer = Connection::open_in_memory().map_err(|e| Error::Database(e.to_string()))?;
    configure_connection(&writer)?;

    let reader_temp_store = reader
        .query_row("PRAGMA temp_store;", [], |row| row.get::<_, i64>(0))
        .map_err(|e| Error::Database(e.to_string()))?;
    let writer_temp_store = writer
        .query_row("PRAGMA temp_store;", [], |row| row.get::<_, i64>(0))
        .map_err(|e| Error::Database(e.to_string()))?;

    assert_eq!(reader_temp_store, 2);
    assert_ne!(writer_temp_store, 2);
    Ok(())
}

#[test]
fn rolls_back_writer_transaction_when_any_statement_fails() -> Result<(), Error> {
    let dir = TestDir::new("sqlite-transaction-rollback");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let empty = HashMap::new();

    db.execute_non_query(
        "CREATE TABLE transaction_items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
        &empty,
    )?;

    let result = db.write_transaction(|tx| {
        let mut args = HashMap::new();
        args.insert("@id".to_string(), serde_json::json!(1));
        args.insert("@name".to_string(), serde_json::json!("pending"));
        tx.execute_non_query(
            "INSERT INTO transaction_items (id, name) VALUES (@id, @name)",
            &args,
        )?;
        tx.execute_non_query("INSERT INTO missing_table (value) VALUES (1)", &empty)?;
        Ok(())
    });

    assert!(result.is_err());
    let rows = db.execute("SELECT COUNT(*) FROM transaction_items", &empty)?;
    assert_eq!(rows[0][0], serde_json::json!(0));
    Ok(())
}

#[test]
fn profile_backup_vacuum_into_snapshots_content_and_replaces_existing_destination(
) -> Result<(), Error> {
    let dir = TestDir::new("profile-backup-vacuum");
    let db_path = dir.path.join("VRCX-0.sqlite3");
    let snapshot_path = dir.path.join("snapshot.sqlite3");
    let db = DatabaseService::new(&db_path)?;
    let empty = HashMap::new();
    db.execute_non_query(
        "CREATE TABLE snapshot_items (id INTEGER PRIMARY KEY, value TEXT NOT NULL)",
        &empty,
    )?;
    db.execute_non_query(
        "INSERT INTO snapshot_items (value) VALUES ('complete')",
        &empty,
    )?;
    fs::write(&snapshot_path, b"replace me")?;

    db.vacuum_into(&snapshot_path)?;

    let snapshot = Connection::open_with_flags(snapshot_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| Error::Database(error.to_string()))?;
    let value: String = snapshot
        .query_row("SELECT value FROM snapshot_items", [], |row| row.get(0))
        .map_err(|error| Error::Database(error.to_string()))?;
    assert_eq!(value, "complete");
    Ok(())
}

#[test]
fn profile_backup_vacuum_into_rejects_upgrade_mode() -> Result<(), Error> {
    let dir = TestDir::new("profile-backup-upgrade-mode");
    let db_path = dir.path.join("VRCX-0.sqlite3");
    let db = DatabaseService::new(&db_path)?;
    let empty = HashMap::new();
    db.execute_non_query(
        "CREATE TABLE configs (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        &empty,
    )?;
    db.execute_non_query(
        "INSERT INTO configs (key, value) VALUES ('config:vrcx_0_databaseversion', '18')",
        &empty,
    )?;
    db.begin_upgrade(18, 18)?;

    let result = db.vacuum_into(&dir.path.join("snapshot.sqlite3"));

    assert!(result.is_err());
    db.fail_upgrade("test complete".into())?;
    Ok(())
}

#[test]
fn data_dir_migration_freeze_closes_and_abort_reopens_main_database() -> Result<(), Error> {
    let dir = TestDir::new("data-dir-migration-freeze");
    let db_path = dir.path.join("VRCX-0.sqlite3");
    let db = DatabaseService::new(&db_path)?;
    let empty = HashMap::new();
    db.execute_non_query("CREATE TABLE migration_items (value TEXT NOT NULL)", &empty)?;
    db.execute_non_query(
        "INSERT INTO migration_items (value) VALUES ('before-freeze')",
        &empty,
    )?;

    let frozen = db.freeze_for_migration()?;

    assert_eq!(frozen.db_path, db_path);
    assert_eq!(frozen.db_bytes, fs::metadata(&frozen.db_path)?.len());
    assert!(!db.is_main_mode());
    assert!(db
        .execute("SELECT value FROM migration_items", &empty)
        .is_err());

    db.reopen_after_migration_abort()?;

    assert!(db.is_main_mode());
    let rows = db.execute("SELECT value FROM migration_items", &empty)?;
    assert_eq!(rows, vec![vec![serde_json::json!("before-freeze")]]);
    db.execute_non_query(
        "INSERT INTO migration_items (value) VALUES ('after-reopen')",
        &empty,
    )?;
    Ok(())
}

#[test]
fn data_dir_migration_freeze_rejects_upgrade_without_changing_mode() -> Result<(), Error> {
    let dir = TestDir::new("data-dir-migration-upgrade-mode");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let empty = HashMap::new();
    db.execute_non_query(
        "CREATE TABLE configs (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        &empty,
    )?;
    db.execute_non_query(
        "INSERT INTO configs (key, value) VALUES ('config:vrcx_0_databaseversion', '18')",
        &empty,
    )?;
    db.begin_upgrade(18, 18)?;

    assert!(db.freeze_for_migration().is_err());
    assert!(!db.is_main_mode());
    db.execute_non_query(
        "INSERT INTO configs (key, value) VALUES ('upgrade-session', 'active')",
        &empty,
    )?;
    db.fail_upgrade("test complete".into())?;
    assert!(db.is_main_mode());
    Ok(())
}

#[test]
fn upgrade_backup_continues_when_source_checkpoint_is_busy() -> Result<(), Error> {
    let dir = TestDir::new("database-upgrade-busy-source-checkpoint");
    let db_path = dir.path.join("VRCX-0.sqlite3");
    let db = DatabaseService::new(&db_path)?;
    let empty = HashMap::new();
    db.execute_non_query("CREATE TABLE migration_items (value TEXT NOT NULL)", &empty)?;
    db.execute_non_query(
        "INSERT INTO migration_items (value) VALUES ('before-reader')",
        &empty,
    )?;

    {
        let inner = db
            .inner
            .read()
            .map_err(|error| Error::Database(error.to_string()))?;
        let DatabaseMode::Main(main) = &*inner else {
            unreachable!();
        };
        main.writer
            .lock()
            .map_err(|error| Error::Database(error.to_string()))?
            .busy_timeout(std::time::Duration::from_millis(10))
            .map_err(|error| Error::Database(error.to_string()))?;
    }

    let mut reader =
        Connection::open(&db_path).map_err(|error| Error::Database(error.to_string()))?;
    let reader_tx = reader
        .transaction()
        .map_err(|error| Error::Database(error.to_string()))?;
    let _: i64 = reader_tx
        .query_row("SELECT COUNT(*) FROM migration_items", [], |row| row.get(0))
        .map_err(|error| Error::Database(error.to_string()))?;
    db.execute_non_query(
        "INSERT INTO migration_items (value) VALUES ('after-reader')",
        &empty,
    )?;

    db.begin_upgrade(16, 18)?;

    assert_eq!(
        db.execute("SELECT value FROM migration_items ORDER BY rowid", &empty)?,
        vec![
            vec![serde_json::json!("before-reader")],
            vec![serde_json::json!("after-reader")],
        ]
    );

    reader_tx
        .rollback()
        .map_err(|error| Error::Database(error.to_string()))?;
    drop(reader);
    db.fail_upgrade("test complete".into())?;
    Ok(())
}

#[test]
fn passive_checkpoint_reports_partial_progress_and_truncate_reports_busy() -> Result<(), Error> {
    let dir = TestDir::new("wal-checkpoint-modes");
    let db_path = dir.path.join("VRCX-0.sqlite3");
    let db = DatabaseService::new(&db_path)?;
    let empty = HashMap::new();
    db.execute_non_query(
        "CREATE TABLE checkpoint_items (value TEXT NOT NULL)",
        &empty,
    )?;
    db.execute_non_query(
        "INSERT INTO checkpoint_items (value) VALUES ('before-reader')",
        &empty,
    )?;

    let mut reader = Connection::open(&db_path).map_err(Error::sqlite)?;
    let reader_tx = reader.transaction().map_err(Error::sqlite)?;
    let _: i64 = reader_tx
        .query_row("SELECT COUNT(*) FROM checkpoint_items", [], |row| {
            row.get(0)
        })
        .map_err(Error::sqlite)?;
    db.execute_non_query(
        "INSERT INTO checkpoint_items (value) VALUES ('after-reader')",
        &empty,
    )?;

    let passive = db.checkpoint_wal_passive()?;
    assert!(!passive.busy);
    assert!(!passive.is_complete());
    assert!(passive.log_frames > passive.checkpointed_frames);

    let truncate_started = std::time::Instant::now();
    let truncate = db.truncate_wal()?;
    assert!(truncate.busy);
    assert!(!truncate.is_complete());
    assert!(truncate_started.elapsed() < Duration::from_secs(1));

    {
        let inner = db
            .inner
            .read()
            .map_err(|error| Error::Database(error.to_string()))?;
        let DatabaseMode::Main(main) = &*inner else {
            unreachable!();
        };
        let busy_timeout_millis: i64 = main
            .writer
            .lock()
            .map_err(|error| Error::Database(error.to_string()))?
            .query_row("PRAGMA busy_timeout", [], |row| row.get(0))
            .map_err(Error::sqlite)?;
        assert_eq!(busy_timeout_millis, 5_000);
    }

    reader_tx.rollback().map_err(Error::sqlite)?;
    drop(reader);

    assert!(db.checkpoint_wal_passive()?.is_complete());
    assert!(db.truncate_wal()?.is_complete());
    Ok(())
}

#[test]
fn failed_upgraded_database_reopen_restores_original_and_preserves_work_copy() -> Result<(), Error>
{
    let dir = TestDir::new("database-upgrade-reopen-rollback");
    let db_path = dir.path.join("VRCX-0.sqlite3");
    let db = DatabaseService::new(&db_path)?;
    let empty = HashMap::new();
    db.execute_non_query(
        "CREATE TABLE configs (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        &empty,
    )?;
    db.execute_non_query("CREATE TABLE recovery_items (value TEXT NOT NULL)", &empty)?;
    db.execute_non_query(
        "INSERT INTO configs (key, value) VALUES ('config:vrcx_0_databaseversion', '17')",
        &empty,
    )?;
    db.execute_non_query(
        "INSERT INTO recovery_items (value) VALUES ('original')",
        &empty,
    )?;
    db.begin_upgrade(17, 18)?;
    db.execute_non_query(
        "UPDATE configs SET value = '18' WHERE key = 'config:vrcx_0_databaseversion'",
        &empty,
    )?;
    db.execute_non_query("UPDATE recovery_items SET value = 'upgraded'", &empty)?;

    let mut reopen_attempts = 0;
    let result = db.commit_upgrade_with_reopen(|path| {
        reopen_attempts += 1;
        if reopen_attempts == 1 {
            Err(Error::Database(
                "injected upgraded database reopen failure".into(),
            ))
        } else {
            open_main_database(path)
        }
    });

    assert!(result.is_err());
    assert_eq!(reopen_attempts, 2);
    assert!(db.is_main_mode());
    let rows = db.execute("SELECT value FROM recovery_items", &empty)?;
    assert_eq!(rows, vec![vec![serde_json::json!("original")]]);
    let failed = db.get_failed_upgrade()?.expect("failed upgrade status");
    let work_db_path = PathBuf::from(failed.work_db_path);
    assert!(work_db_path.exists());
    assert!(!dir
        .path
        .join("db-upgrade")
        .join(".upgrade-failed.json.tmp")
        .exists());
    let work = Connection::open_with_flags(work_db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| Error::Database(error.to_string()))?;
    let value: String = work
        .query_row("SELECT value FROM recovery_items", [], |row| row.get(0))
        .map_err(|error| Error::Database(error.to_string()))?;
    assert_eq!(value, "upgraded");
    Ok(())
}

fn interrupt_upgrade_between_replacement_renames(dir: &TestDir) -> Result<PathBuf, Error> {
    let db_path = dir.path.join("VRCX-0.sqlite3");
    let empty = HashMap::new();
    {
        let db = DatabaseService::new(&db_path)?;
        db.execute_non_query("CREATE TABLE recovery_items (value TEXT NOT NULL)", &empty)?;
        db.execute_non_query(
            "INSERT INTO recovery_items (value) VALUES ('original')",
            &empty,
        )?;
        db.begin_upgrade(17, 18)?;
        db.execute_non_query("UPDATE recovery_items SET value = 'upgraded'", &empty)?;
    }
    crate::database::sidecar::remove_sidecars(&db_path)?;
    std::fs::rename(
        &db_path,
        dir.path
            .join("db-upgrade")
            .join("VRCX-0-before-upgrade.sqlite3"),
    )?;
    Ok(db_path)
}

#[test]
fn interrupted_upgrade_replacement_restores_original_before_retry() -> Result<(), Error> {
    let dir = TestDir::new("database-upgrade-interrupted-replacement");
    let db_path = interrupt_upgrade_between_replacement_renames(&dir)?;

    let db = DatabaseService::new(&db_path)?;
    assert!(db.get_failed_upgrade()?.is_some());
    db.discard_failed_upgrade()?;

    let rows = db.execute("SELECT value FROM recovery_items", &HashMap::new())?;
    assert_eq!(rows, vec![vec![serde_json::json!("original")]]);
    Ok(())
}

#[test]
fn interrupted_upgrade_replacement_restores_original_over_a_recreated_database() -> Result<(), Error>
{
    let dir = TestDir::new("database-upgrade-interrupted-recreated");
    let db_path = interrupt_upgrade_between_replacement_renames(&dir)?;
    Connection::open(&db_path)
        .and_then(|conn| conn.execute_batch("CREATE TABLE configs (key TEXT PRIMARY KEY)"))
        .map_err(Error::sqlite)?;

    let db = DatabaseService::new(&db_path)?;

    let rows = db.execute("SELECT value FROM recovery_items", &HashMap::new())?;
    assert_eq!(rows, vec![vec![serde_json::json!("original")]]);
    Ok(())
}

#[test]
fn interrupted_upgrade_replacement_restores_original_without_the_work_copy() -> Result<(), Error> {
    let dir = TestDir::new("database-upgrade-interrupted-no-work-copy");
    let db_path = interrupt_upgrade_between_replacement_renames(&dir)?;
    let work_db_path = dir
        .path
        .join("db-upgrade")
        .join("VRCX-0-upgrade-17-to-18.sqlite3");
    crate::database::sidecar::remove_sidecars(&work_db_path)?;
    std::fs::remove_file(&work_db_path)?;

    let db = DatabaseService::new(&db_path)?;

    let rows = db.execute("SELECT value FROM recovery_items", &HashMap::new())?;
    assert_eq!(rows, vec![vec![serde_json::json!("original")]]);
    Ok(())
}

#[test]
fn unreadable_upgrade_status_keeps_the_existing_main_database() -> Result<(), Error> {
    let dir = TestDir::new("database-upgrade-unreadable-status");
    let db_path = dir.path.join("VRCX-0.sqlite3");
    let upgrade_dir = dir.path.join("db-upgrade");
    let empty = HashMap::new();
    for (path, value) in [
        (db_path.clone(), "current"),
        (upgrade_dir.join("VRCX-0-before-upgrade.sqlite3"), "stale"),
    ] {
        std::fs::create_dir_all(path.parent().unwrap())?;
        let db = DatabaseService::new(&path)?;
        db.execute_non_query("CREATE TABLE recovery_items (value TEXT NOT NULL)", &empty)?;
        db.execute_non_query(
            &format!("INSERT INTO recovery_items (value) VALUES ('{value}')"),
            &empty,
        )?;
    }
    std::fs::write(upgrade_dir.join("upgrade-active.json"), "{")?;

    let db = DatabaseService::new(&db_path)?;

    let rows = db.execute("SELECT value FROM recovery_items", &empty)?;
    assert_eq!(rows, vec![vec![serde_json::json!("current")]]);
    Ok(())
}

#[test]
fn discarding_failed_upgrade_preserves_main_database_and_allows_retry() -> Result<(), Error> {
    let dir = TestDir::new("database-upgrade-discard-failed");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let empty = HashMap::new();
    db.execute_non_query("CREATE TABLE recovery_items (value TEXT NOT NULL)", &empty)?;
    db.execute_non_query(
        "INSERT INTO recovery_items (value) VALUES ('original')",
        &empty,
    )?;
    db.begin_upgrade(17, 18)?;
    db.execute_non_query("UPDATE recovery_items SET value = 'upgraded'", &empty)?;
    db.fail_upgrade("injected failure".into())?;

    let failed = db.get_failed_upgrade()?.expect("failed upgrade status");
    assert!(Path::new(&failed.work_db_path).exists());

    db.discard_failed_upgrade()?;

    assert!(db.get_failed_upgrade()?.is_none());
    assert!(!dir.path.join("db-upgrade").exists());
    assert_eq!(
        db.execute("SELECT value FROM recovery_items", &empty)?,
        vec![vec![serde_json::json!("original")]]
    );

    db.begin_upgrade(17, 18)?;
    db.fail_upgrade("test cleanup".into())?;
    Ok(())
}

#[test]
fn set_upgrade_context_persists_the_in_flight_operation_for_diagnosing_a_crash() -> Result<(), Error>
{
    let dir = TestDir::new("database-upgrade-stage-crash");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    db.begin_upgrade(17, 18)?;

    db.set_upgrade_context(
        "legacySchemaMigration",
        "database_maintenance_run:fixNegativeGPS",
    )?;

    let blocked = db.get_failed_upgrade()?.expect("unfinished upgrade status");
    assert_eq!(blocked.stage.as_deref(), Some("legacySchemaMigration"));
    assert_eq!(
        blocked.operation.as_deref(),
        Some("database_maintenance_run:fixNegativeGPS")
    );
    let reason = blocked.reason.expect("reason for the unfinished upgrade");
    assert!(
        reason.contains("during 'legacySchemaMigration'"),
        "{reason}"
    );

    db.fail_upgrade("test cleanup".into())?;
    Ok(())
}

#[test]
fn get_failed_upgrade_reports_no_stage_when_the_process_died_before_the_first_stage(
) -> Result<(), Error> {
    let dir = TestDir::new("database-upgrade-stage-missing");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    db.begin_upgrade(17, 18)?;

    let blocked = db.get_failed_upgrade()?.expect("unfinished upgrade status");
    assert_eq!(blocked.stage, None);
    let reason = blocked.reason.expect("reason for the unfinished upgrade");
    assert!(
        reason.contains("before its first stage finished"),
        "{reason}"
    );

    db.fail_upgrade("test cleanup".into())?;
    Ok(())
}

#[test]
fn set_upgrade_context_fails_when_no_upgrade_is_running() -> Result<(), Error> {
    let dir = TestDir::new("database-upgrade-stage-no-session");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;

    assert!(db
        .set_upgrade_context("preflight", "database_upgrade_preflight")
        .is_err());
    Ok(())
}

#[test]
fn fresh_database_archives_the_main_database_and_failed_work_copy() -> Result<(), Error> {
    let dir = TestDir::new("database-upgrade-fresh-start");
    let db_path = dir.path.join("VRCX-0.sqlite3");
    let db = DatabaseService::new(&db_path)?;
    let empty = HashMap::new();
    db.execute_non_query("CREATE TABLE recovery_items (value TEXT NOT NULL)", &empty)?;
    db.execute_non_query(
        "INSERT INTO recovery_items (value) VALUES ('original')",
        &empty,
    )?;
    db.begin_upgrade(17, 18)?;
    db.fail_upgrade("injected failure".into())?;

    let recovery_dir = db.archive_main_database_and_create_fresh_database()?;

    assert!(db.is_main_mode());
    assert!(db_path.is_file());
    assert!(recovery_dir.join("VRCX-0.sqlite3").is_file());
    assert!(recovery_dir.join("db-upgrade").is_dir());
    assert!(db.get_failed_upgrade()?.is_none());
    let tables = db.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'recovery_items'",
        &empty,
    )?;
    assert!(tables.is_empty());
    let archived = Connection::open_with_flags(
        recovery_dir.join("VRCX-0.sqlite3"),
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|error| Error::Database(error.to_string()))?;
    let value: String = archived
        .query_row("SELECT value FROM recovery_items", [], |row| row.get(0))
        .map_err(|error| Error::Database(error.to_string()))?;
    assert_eq!(value, "original");
    Ok(())
}

#[test]
fn fresh_database_open_failure_restores_the_original_database() -> Result<(), Error> {
    let dir = TestDir::new("database-upgrade-fresh-start-rollback");
    let db_path = dir.path.join("VRCX-0.sqlite3");
    let db = DatabaseService::new(&db_path)?;
    let empty = HashMap::new();
    db.execute_non_query("CREATE TABLE recovery_items (value TEXT NOT NULL)", &empty)?;
    db.execute_non_query(
        "INSERT INTO recovery_items (value) VALUES ('original')",
        &empty,
    )?;
    db.begin_upgrade(17, 18)?;
    db.fail_upgrade("injected failure".into())?;
    let mut open_attempts = 0;

    let result = db.archive_main_database_with_open(|path| {
        open_attempts += 1;
        if open_attempts == 1 {
            Err(Error::Database(
                "injected fresh database open failure".into(),
            ))
        } else {
            open_main_database(path)
        }
    });

    assert!(result.is_err());
    assert_eq!(open_attempts, 2);
    assert!(db.is_main_mode());
    assert!(db.get_failed_upgrade()?.is_some());
    assert_eq!(
        db.execute("SELECT value FROM recovery_items", &empty)?,
        vec![vec![serde_json::json!("original")]]
    );
    assert!(!dir.path.join("database-upgrade-recovery").exists());
    Ok(())
}

#[test]
fn fresh_database_can_recover_while_the_database_service_is_closed() -> Result<(), Error> {
    let dir = TestDir::new("database-upgrade-fresh-start-closed");
    let db_path = dir.path.join("VRCX-0.sqlite3");
    let db = DatabaseService::new(&db_path)?;
    let empty = HashMap::new();
    db.execute_non_query("CREATE TABLE recovery_items (value TEXT NOT NULL)", &empty)?;
    db.execute_non_query(
        "INSERT INTO recovery_items (value) VALUES ('original')",
        &empty,
    )?;
    db.freeze_for_migration()?;

    let recovery_dir = db.archive_main_database_and_create_fresh_database()?;

    assert!(db.is_main_mode());
    assert!(recovery_dir.join("VRCX-0.sqlite3").is_file());
    assert!(db
        .execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'recovery_items'",
            &empty,
        )?
        .is_empty());
    Ok(())
}

#[test]
fn failed_status_write_keeps_active_journal_for_recovery() -> Result<(), Error> {
    let dir = TestDir::new("database-upgrade-failed-status-write");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let empty = HashMap::new();
    db.execute_non_query(
        "CREATE TABLE configs (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        &empty,
    )?;
    db.execute_non_query(
        "INSERT INTO configs (key, value) VALUES ('config:vrcx_0_databaseversion', '17')",
        &empty,
    )?;
    db.begin_upgrade(17, 18)?;
    db.execute_non_query(
        "UPDATE configs SET value = '18' WHERE key = 'config:vrcx_0_databaseversion'",
        &empty,
    )?;
    fs::create_dir(db.failed_status_path())?;

    let mut reopen_attempts = 0;
    let result = db.commit_upgrade_with_reopen(|path| {
        reopen_attempts += 1;
        if reopen_attempts == 1 {
            Err(Error::Database(
                "injected upgraded database reopen failure".into(),
            ))
        } else {
            open_main_database(path)
        }
    });

    assert!(result.as_ref().is_err_and(|error| error
        .to_string()
        .contains("Writing the failure status failed")));
    assert!(db.active_status_path().exists());
    fs::remove_dir(db.failed_status_path())?;
    let failed = db.get_failed_upgrade()?.expect("active upgrade status");
    assert!(Path::new(&failed.work_db_path).exists());
    Ok(())
}

#[test]
fn status_reader_recovers_a_synced_temporary_journal() -> Result<(), Error> {
    let dir = TestDir::new("database-upgrade-temporary-status");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    db.begin_upgrade_with_progress(
        17,
        18,
        Some("2.23.0"),
        Some("createWorkCopy"),
        Some("begin_upgrade_with_progress"),
        |_, _| {},
    )?;
    let active_path = db.active_status_path();
    let temporary_path = status_temporary_path(&active_path)?;
    fs::rename(&active_path, &temporary_path)?;

    let status = db.get_failed_upgrade()?.expect("temporary active status");

    assert_eq!(status.from_version, 17);
    assert_eq!(status.to_version, 18);
    assert_eq!(status.app_version.as_deref(), Some("2.23.0"));
    assert_eq!(status.stage.as_deref(), Some("createWorkCopy"));
    assert_eq!(
        status.operation.as_deref(),
        Some("begin_upgrade_with_progress")
    );
    assert!(Path::new(&status.work_db_path).exists());
    db.fail_upgrade("test complete".into())?;
    Ok(())
}

fn count_schema_runs(db: &DatabaseService, key: &str, runs: &mut i64) -> Result<(), Error> {
    db.ensure_schema_once(key, || {
        *runs += 1;
        Ok(())
    })
}

#[test]
fn schema_bootstrap_runs_once_per_key() -> Result<(), Error> {
    let dir = TestDir::new("schema-once");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let mut runs = 0;
    let mut other_runs = 0;

    count_schema_runs(&db, "alpha", &mut runs)?;
    count_schema_runs(&db, "alpha", &mut runs)?;
    count_schema_runs(&db, "beta", &mut other_runs)?;

    assert_eq!(runs, 1);
    assert_eq!(other_runs, 1);
    Ok(())
}

#[test]
fn schema_bootstrap_does_not_cache_a_failed_run() -> Result<(), Error> {
    let dir = TestDir::new("schema-once-failure");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;

    assert!(db
        .ensure_schema_once("alpha", || Err(Error::Database("bootstrap failed".into())))
        .is_err());

    let mut runs = 0;
    count_schema_runs(&db, "alpha", &mut runs)?;
    assert_eq!(runs, 1);
    Ok(())
}

#[test]
fn schema_bootstrap_retries_until_stable() -> Result<(), Error> {
    let dir = TestDir::new("schema-until-stable");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let mut runs = 0;

    db.ensure_schema_until_stable("alpha", || {
        runs += 1;
        Ok(false)
    })?;
    db.ensure_schema_until_stable("alpha", || {
        runs += 1;
        Ok(true)
    })?;
    db.ensure_schema_until_stable("alpha", || {
        runs += 1;
        Ok(false)
    })?;

    assert_eq!(runs, 2);
    Ok(())
}

#[test]
fn schema_bootstrap_memo_does_not_survive_a_new_connection_generation() -> Result<(), Error> {
    let dir = TestDir::new("schema-once-generation");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let mut runs = 0;

    count_schema_runs(&db, "alpha", &mut runs)?;
    db.freeze_for_migration()?;
    db.reopen_after_migration_abort()?;
    count_schema_runs(&db, "alpha", &mut runs)?;

    assert_eq!(runs, 2);
    Ok(())
}

#[test]
fn schema_bootstrap_memo_is_isolated_between_main_and_upgrade_copies() -> Result<(), Error> {
    let dir = TestDir::new("schema-once-upgrade");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let mut runs = 0;

    count_schema_runs(&db, "alpha", &mut runs)?;
    db.begin_upgrade(17, 18)?;
    count_schema_runs(&db, "alpha", &mut runs)?;
    db.fail_upgrade("test complete".into())?;
    count_schema_runs(&db, "alpha", &mut runs)?;

    assert_eq!(runs, 3);
    Ok(())
}

#[test]
fn schema_bootstrap_is_unavailable_while_the_database_is_closed() -> Result<(), Error> {
    let dir = TestDir::new("schema-once-closed");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    db.freeze_for_migration()?;

    let mut runs = 0;
    assert!(count_schema_runs(&db, "alpha", &mut runs).is_err());
    assert_eq!(runs, 0);

    db.reopen_after_migration_abort()?;
    Ok(())
}

#[test]
fn profile_backup_maps_sqlite_disk_full_to_storage_full_io() {
    let sqlite_error =
        rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_FULL), None);

    assert!(matches!(
        map_profile_backup_sqlite_error(sqlite_error),
        Error::Io(error) if error.kind() == std::io::ErrorKind::StorageFull
    ));
}
