//! Fork: export all profile data and settings to one zip (deflate level 9) and
//! restore from it.
//!
//! Export snapshots the live database (safe while the app runs) and adds every
//! other file in the data directory except caches, logs, backups, the yt-dlp
//! toolchain and internal staging/journal files.
//!
//! Login sessions (the `cookies` table) and saved logins are removed from the
//! exported database; an import keeps the sessions already on this PC.
//!
//! Import never touches live files: it validates and extracts the archive into
//! a staging directory and leaves a marker. On the next start, before the
//! database is opened, [`apply_pending_data_import`] backs up the current
//! database and settings and moves the staged files into place.

use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::legacy_migration::snapshot_database;
use crate::Error;

pub const DATA_EXPORT_FORMAT: &str = "vrcx-0-nanashi-data-export";
const DATA_EXPORT_FORMAT_VERSION: u32 = 1;
const MANIFEST_NAME: &str = "vrcx-0-nanashi-export.json";
const DATABASE_FILE: &str = "VRCX-0.sqlite3";
const SETTINGS_FILE: &str = "VRCX-0.json";
const EXPORT_STAGING_DIR: &str = ".export-staging";
pub const IMPORT_STAGING_DIR: &str = ".import-pending";
const IMPORT_MARKER_FILE: &str = "pending-data-import.json";
const COMPRESSION_LEVEL: i64 = 9;
const MAX_ENTRY_BYTES: u64 = 32 * 1024 * 1024 * 1024;
const SQLITE_HEADER: &[u8] = b"SQLite format 3\0";
const SAVED_CREDENTIALS_CONFIG_KEY: &str = "config:vrcx_savedcredentials";

fn table_exists(conn: &rusqlite::Connection, schema: &str, table: &str) -> Result<bool, Error> {
    conn.query_row(
        &format!("SELECT 1 FROM {schema}.sqlite_master WHERE type = 'table' AND name = ?1"),
        [table],
        |_| Ok(()),
    )
    .map(|_| true)
    .or_else(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => Ok(false),
        error => Err(Error::sqlite(error)),
    })
}

/// Remove login sessions and saved logins from an exported database copy.
fn strip_login_sessions(database: &Path) -> Result<(), Error> {
    let conn = rusqlite::Connection::open(database).map_err(Error::sqlite)?;
    if table_exists(&conn, "main", "cookies")? {
        conn.execute("DELETE FROM cookies", [])
            .map_err(Error::sqlite)?;
    }
    if table_exists(&conn, "main", "configs")? {
        conn.execute(
            "DELETE FROM configs WHERE lower(key) = ?1",
            [SAVED_CREDENTIALS_CONFIG_KEY],
        )
        .map_err(Error::sqlite)?;
    }
    conn.execute_batch("VACUUM").map_err(Error::sqlite)?;
    Ok(())
}

/// Copy this PC's login sessions and saved logins from `previous` into the
/// freshly imported database, so importing does not sign the user out.
fn carry_over_login_sessions(database: &Path, previous: &Path) -> Result<(), Error> {
    let conn = rusqlite::Connection::open(database).map_err(Error::sqlite)?;
    conn.execute(
        "ATTACH DATABASE ?1 AS previous",
        [previous.to_string_lossy().as_ref()],
    )
    .map_err(Error::sqlite)?;
    let result = (|| {
        if table_exists(&conn, "previous", "cookies")? && table_exists(&conn, "main", "cookies")? {
            conn.execute(
                "INSERT OR REPLACE INTO main.cookies (key, value) SELECT key, value FROM previous.cookies",
                [],
            )
            .map_err(Error::sqlite)?;
        }
        if table_exists(&conn, "previous", "configs")? && table_exists(&conn, "main", "configs")? {
            conn.execute(
                "INSERT OR REPLACE INTO main.configs (key, value)
                 SELECT key, value FROM previous.configs WHERE lower(key) = ?1",
                [SAVED_CREDENTIALS_CONFIG_KEY],
            )
            .map_err(Error::sqlite)?;
        }
        Ok(())
    })();
    let _ = conn.execute("DETACH DATABASE previous", []);
    result
}

/// Top-level names that are regenerable, machine-specific or internal.
const EXCLUDED_TOP_LEVEL: &[&str] = &[
    "imagecache",
    "screenshotthumbs",
    "backups",
    "diagnostics",
    "database-maintenance",
    "database-upgrade-recovery",
    "merge-staging",
    "legacy-migration-staging",
    "ytdlp",
    "metadatacache.db",
    "metadatacache.db-wal",
    "metadatacache.db-shm",
    "error-log.txt",
    "runtime.lock",
    "vrcx-0.data-dir.json",
    "vrcx-0.sqlite3",
    "vrcx-0.sqlite3-wal",
    "vrcx-0.sqlite3-shm",
    "vrcx-0.sqlite3-journal",
    "pending_profile_restore.json",
    "last_profile_restore_result.json",
    "pending-data-dir-migration.json",
    "last-data-dir-migration-result.json",
    "data-dir-cleanup-pending.json",
    "pending-data-import.json",
];

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DataExportManifest {
    format: String,
    format_version: u32,
    app_version: String,
    created_at: String,
    files: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DataExportReport {
    pub files: u32,
    pub bytes: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DataImportSummary {
    pub files: u32,
    pub app_version: String,
    pub created_at: String,
}

fn is_excluded(relative: &Path) -> bool {
    let Some(first) = relative.components().next() else {
        return true;
    };
    let name = first.as_os_str().to_string_lossy().to_ascii_lowercase();
    name.starts_with('.') || name.ends_with(".lock") || EXCLUDED_TOP_LEVEL.contains(&name.as_str())
}

fn zip_name(relative: &Path) -> String {
    relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

fn collect_files(root: &Path, dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), Error> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let relative = path.strip_prefix(root).unwrap_or(&path).to_path_buf();
        if is_excluded(&relative) {
            continue;
        }
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            collect_files(root, &path, out)?;
        } else if file_type.is_file() {
            out.push(relative);
        }
    }
    Ok(())
}

fn file_options() -> SimpleFileOptions {
    SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .compression_level(Some(COMPRESSION_LEVEL))
        .large_file(true)
}

/// Write every profile file to `archive` as a level 9 deflate zip.
pub fn export_data_archive(
    db_file: &Path,
    app_data: &Path,
    archive: &Path,
    app_version: &str,
) -> Result<DataExportReport, Error> {
    let staging = app_data.join(EXPORT_STAGING_DIR);
    if staging.exists() {
        fs::remove_dir_all(&staging)?;
    }
    fs::create_dir_all(&staging)?;
    let result = (|| {
        let snapshot = staging.join(DATABASE_FILE);
        snapshot_database(db_file, &snapshot)?;
        strip_login_sessions(&snapshot)?;

        let mut files = Vec::new();
        collect_files(app_data, app_data, &mut files)?;
        files.sort();

        if let Some(parent) = archive.parent() {
            fs::create_dir_all(parent)?;
        }
        let partial = archive.with_extension("zip.partial");
        let mut writer = ZipWriter::new(File::create(&partial)?);
        let manifest = DataExportManifest {
            format: DATA_EXPORT_FORMAT.into(),
            format_version: DATA_EXPORT_FORMAT_VERSION,
            app_version: app_version.into(),
            created_at: chrono::Utc::now().to_rfc3339(),
            files: files.len() as u32 + 1,
        };
        writer
            .start_file(MANIFEST_NAME, file_options())
            .map_err(zip_error)?;
        writer.write_all(&serde_json::to_vec_pretty(&manifest)?)?;

        let mut bytes = 0;
        writer
            .start_file(DATABASE_FILE, file_options())
            .map_err(zip_error)?;
        bytes += io::copy(&mut File::open(&snapshot)?, &mut writer)?;
        for relative in &files {
            writer
                .start_file(zip_name(relative), file_options())
                .map_err(zip_error)?;
            bytes += io::copy(&mut File::open(app_data.join(relative))?, &mut writer)?;
        }
        writer.finish().map_err(zip_error)?.sync_all()?;
        if archive.exists() {
            fs::remove_file(archive)?;
        }
        fs::rename(&partial, archive)?;
        Ok(DataExportReport {
            files: files.len() as u32 + 1,
            bytes,
        })
    })();
    let _ = fs::remove_dir_all(&staging);
    result
}

/// Validate `archive` and extract it into the import staging directory. The
/// files replace the live ones on the next start.
pub fn stage_data_import(archive: &Path, app_data: &Path) -> Result<DataImportSummary, Error> {
    let mut zip = ZipArchive::new(File::open(archive)?).map_err(zip_error)?;
    let manifest: DataExportManifest = {
        let entry = zip
            .by_name(MANIFEST_NAME)
            .map_err(|_| Error::InvalidData("This is not a VRCX-0-Nanashi data export.".into()))?;
        serde_json::from_reader(entry.take(1024 * 1024))?
    };
    if manifest.format != DATA_EXPORT_FORMAT || manifest.format_version > DATA_EXPORT_FORMAT_VERSION
    {
        return Err(Error::InvalidData(
            "This data export was made by an unsupported version.".into(),
        ));
    }

    let staging = app_data.join(IMPORT_STAGING_DIR);
    if staging.exists() {
        fs::remove_dir_all(&staging)?;
    }
    fs::create_dir_all(&staging)?;
    let _ = fs::remove_file(app_data.join(IMPORT_MARKER_FILE));

    let result = (|| {
        let mut files = 0;
        for index in 0..zip.len() {
            let mut entry = zip.by_index(index).map_err(zip_error)?;
            if entry.is_dir() {
                continue;
            }
            let relative = entry.enclosed_name().ok_or_else(|| {
                Error::InvalidData(format!("Unsafe path in data export: {}", entry.name()))
            })?;
            if relative == Path::new(MANIFEST_NAME) {
                continue;
            }
            let is_database = relative == Path::new(DATABASE_FILE);
            if !is_database && is_excluded(&relative) {
                continue;
            }
            if entry.size() > MAX_ENTRY_BYTES {
                return Err(Error::InvalidData(format!(
                    "Data export entry is too large: {}",
                    entry.name()
                )));
            }
            let target = staging.join(&relative);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut out = File::create(&target)?;
            io::copy(&mut (&mut entry).take(MAX_ENTRY_BYTES), &mut out)?;
            out.sync_all()?;
            if is_database {
                let mut header = [0_u8; 16];
                File::open(&target)?.read_exact(&mut header)?;
                if header != SQLITE_HEADER {
                    return Err(Error::InvalidData(
                        "The database in this data export is not valid.".into(),
                    ));
                }
            }
            files += 1;
        }
        if !staging.join(DATABASE_FILE).is_file() {
            return Err(Error::InvalidData(
                "This data export does not contain a database.".into(),
            ));
        }
        fs::write(
            app_data.join(IMPORT_MARKER_FILE),
            serde_json::to_vec_pretty(&manifest)?,
        )?;
        Ok(DataImportSummary {
            files,
            app_version: manifest.app_version.clone(),
            created_at: manifest.created_at.clone(),
        })
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

/// Whether an import is staged and waiting for the next start.
pub fn has_pending_data_import(app_data: &Path) -> bool {
    app_data.join(IMPORT_MARKER_FILE).is_file()
}

/// Discard a staged import that has not been applied yet.
pub fn discard_pending_data_import(app_data: &Path) -> Result<(), Error> {
    let _ = fs::remove_file(app_data.join(IMPORT_MARKER_FILE));
    let staging = app_data.join(IMPORT_STAGING_DIR);
    if staging.exists() {
        fs::remove_dir_all(staging)?;
    }
    Ok(())
}

/// Apply a staged import. Must run before the database or settings are opened.
/// Returns whether an import was applied.
pub fn apply_pending_data_import(app_data: &Path) -> Result<bool, Error> {
    let marker = app_data.join(IMPORT_MARKER_FILE);
    let staging = app_data.join(IMPORT_STAGING_DIR);
    if !marker.is_file() {
        if staging.exists() {
            let _ = fs::remove_dir_all(&staging);
        }
        return Ok(false);
    }
    // Remove the marker first so a failure can never loop on every start.
    fs::remove_file(&marker)?;
    if !staging.join(DATABASE_FILE).is_file() {
        let _ = fs::remove_dir_all(&staging);
        return Err(Error::InvalidData(
            "Staged data import is incomplete; it was discarded.".into(),
        ));
    }

    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let backup = app_data
        .join("backups")
        .join(format!("before-data-import-{stamp}"));
    fs::create_dir_all(&backup)?;
    for name in [
        DATABASE_FILE,
        "VRCX-0.sqlite3-wal",
        "VRCX-0.sqlite3-shm",
        SETTINGS_FILE,
    ] {
        let source = app_data.join(name);
        if source.is_file() {
            fs::copy(&source, backup.join(name))?;
        }
    }
    for name in [
        "VRCX-0.sqlite3-wal",
        "VRCX-0.sqlite3-shm",
        "VRCX-0.sqlite3-journal",
    ] {
        let _ = fs::remove_file(app_data.join(name));
    }

    let mut staged = Vec::new();
    collect_staged(&staging, &staging, &mut staged)?;
    for relative in staged {
        let from = staging.join(&relative);
        let to = app_data.join(&relative);
        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent)?;
        }
        if fs::rename(&from, &to).is_err() {
            fs::copy(&from, &to)?;
        }
    }
    fs::remove_dir_all(&staging)?;
    let previous_database = backup.join(DATABASE_FILE);
    if previous_database.is_file() {
        if let Err(error) =
            carry_over_login_sessions(&app_data.join(DATABASE_FILE), &previous_database)
        {
            tracing::warn!(error = %error, "could not keep login sessions after data import");
        }
    }
    tracing::info!(backup = %backup.display(), "applied staged data import");
    Ok(true)
}

fn collect_staged(root: &Path, dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), Error> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            collect_staged(root, &path, out)?;
        } else if file_type.is_file() {
            out.push(path.strip_prefix(root).unwrap_or(&path).to_path_buf());
        }
    }
    Ok(())
}

fn zip_error(error: zip::result::ZipError) -> Error {
    Error::InvalidData(format!("Zip error: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "vrcx-0-nanashi-data-export-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn make_db(path: &Path, value: &str) {
        let conn = rusqlite::Connection::open(path).unwrap();
        conn.execute_batch(&format!(
            "CREATE TABLE configs (key TEXT PRIMARY KEY, value TEXT);
             CREATE TABLE cookies (key TEXT PRIMARY KEY, value TEXT);
             INSERT INTO configs VALUES ('theme', '{value}');
             INSERT INTO configs VALUES ('config:vrcx_savedcredentials', 'creds-{value}');
             INSERT INTO cookies VALUES ('auth', 'session-{value}');"
        ))
        .unwrap();
    }

    #[test]
    fn export_then_import_round_trips_data_and_skips_caches() {
        let source = temp_dir("source");
        make_db(&source.join(DATABASE_FILE), "dark");
        fs::write(source.join(SETTINGS_FILE), r#"{"zoom":"110"}"#).unwrap();
        fs::create_dir_all(source.join("locales")).unwrap();
        fs::write(source.join("locales/en_pt.json"), "{}").unwrap();
        fs::create_dir_all(source.join("ImageCache")).unwrap();
        fs::write(source.join("ImageCache/big.png"), "cache").unwrap();
        fs::write(source.join("error-log.txt"), "log").unwrap();

        let archive = temp_dir("out").join("export.zip");
        let report =
            export_data_archive(&source.join(DATABASE_FILE), &source, &archive, "3.0.0").unwrap();
        assert_eq!(report.files, 3);
        assert!(!source.join(EXPORT_STAGING_DIR).exists());

        let target = temp_dir("target");
        make_db(&target.join(DATABASE_FILE), "light");
        fs::write(target.join(SETTINGS_FILE), r#"{"zoom":"90"}"#).unwrap();
        fs::write(target.join("VRCX-0.sqlite3-wal"), "stale").unwrap();

        let staged = temp_dir("inspect");
        stage_data_import(&archive, &staged).unwrap();
        let exported =
            rusqlite::Connection::open(staged.join(IMPORT_STAGING_DIR).join(DATABASE_FILE))
                .unwrap();
        let count = |sql: &str| -> i64 { exported.query_row(sql, [], |row| row.get(0)).unwrap() };
        assert_eq!(count("SELECT COUNT(*) FROM cookies"), 0);
        assert_eq!(
            count("SELECT COUNT(*) FROM configs WHERE key = 'config:vrcx_savedcredentials'"),
            0
        );
        drop(exported);

        let summary = stage_data_import(&archive, &target).unwrap();
        assert_eq!(summary.files, 3);
        assert_eq!(summary.app_version, "3.0.0");
        assert!(has_pending_data_import(&target));

        assert!(apply_pending_data_import(&target).unwrap());
        assert!(!has_pending_data_import(&target));
        assert!(!target.join("VRCX-0.sqlite3-wal").exists());
        assert!(!target.join("ImageCache").exists());
        assert_eq!(
            fs::read_to_string(target.join(SETTINGS_FILE)).unwrap(),
            r#"{"zoom":"110"}"#
        );
        assert!(target.join("locales/en_pt.json").is_file());
        let conn = rusqlite::Connection::open(target.join(DATABASE_FILE)).unwrap();
        let theme: String = conn
            .query_row("SELECT value FROM configs WHERE key = 'theme'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(theme, "dark");
        // The export carried no sessions; the importing PC keeps its own.
        let cookie: String = conn
            .query_row("SELECT value FROM cookies WHERE key = 'auth'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(cookie, "session-light");
        let creds: String = conn
            .query_row(
                "SELECT value FROM configs WHERE key = 'config:vrcx_savedcredentials'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(creds, "creds-light");
        assert!(fs::read_dir(target.join("backups"))
            .unwrap()
            .any(|entry| entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("before-data-import-")));
        assert!(!apply_pending_data_import(&target).unwrap());
    }

    #[test]
    fn rejects_archives_that_are_not_exports() {
        let dir = temp_dir("reject");
        let archive = dir.join("other.zip");
        let mut writer = ZipWriter::new(File::create(&archive).unwrap());
        writer
            .start_file("hello.txt", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"hi").unwrap();
        writer.finish().unwrap();

        assert!(stage_data_import(&archive, &dir).is_err());
        assert!(!has_pending_data_import(&dir));
    }
}
