use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::profile_backup::{create_private_file, hash_file_with_progress, sync_directory_durable};
use crate::{Error, Result};

const STAGING: &str = ".profile-auto-import";
const READY: &str = ".ready.json";
const DATABASE: &str = "VRCX-0.sqlite3";
const SETTINGS: &str = "VRCX-0.json";

#[derive(Clone, Debug)]
struct Source {
    directory: PathBuf,
    database: PathBuf,
    settings: Option<PathBuf>,
    original_vrcx: bool,
}

#[derive(Serialize, Deserialize)]
struct Ready {
    database_hash: String,
}

pub fn import_first_run_profile(target: &Path) -> Result<()> {
    import_with_sources(target, discover_source)
}

fn import_with_sources(
    target: &Path,
    discover: impl FnOnce() -> Result<Option<Source>>,
) -> Result<()> {
    let staging = target.join(STAGING);
    if target
        .join(crate::profile_names::DATABASE_FILE)
        .try_exists()?
    {
        return Ok(());
    }
    if staging.try_exists()? && !fs::symlink_metadata(&staging)?.file_type().is_dir() {
        return Err(Error::InvalidData(
            "Automatic import staging is not a regular directory.".into(),
        ));
    }
    if staging.join(READY).is_file() {
        return install_staged(target, &staging);
    }
    for name in [
        DATABASE,
        SETTINGS,
        "VRCX-0-Nanashi.sqlite3",
        "VRCX-0-Nanashi.json",
        "pending_vrcx_migration",
        "pending_profile_restore.json",
        "pending-data-import.json",
    ] {
        if target.join(name).try_exists()? {
            return Ok(());
        }
    }
    let Some(source) = discover()? else {
        return Ok(());
    };
    let source_directory = source.directory.canonicalize()?;
    let target_directory = target.canonicalize()?;
    if vrcx_0_platform::app_paths::app_data_paths_match(&source_directory, &target_directory)
        || source_directory.starts_with(&target_directory)
        || target_directory.starts_with(&source_directory)
    {
        return Err(Error::InvalidData(
            "Import source and destination must be separate directories.".into(),
        ));
    }
    if staging.try_exists()? {
        if !fs::symlink_metadata(&staging)?.file_type().is_dir() {
            return Err(Error::InvalidData(
                "Automatic import staging is not a regular directory.".into(),
            ));
        }
        fs::remove_dir_all(&staging)?;
    }
    create_directory(&staging)?;
    let snapshot = staging.join(DATABASE);
    copy_verified_database(&source.database, &snapshot, &staging.join(".source"))?;
    let version =
        crate::legacy_vrcx::read_legacy_database_version(&snapshot).map_err(Error::InvalidData)?;
    if source.original_vrcx {
        crate::legacy_vrcx::validate_legacy_source(&crate::legacy_vrcx::LegacyVrcxSource {
            db_path: snapshot.clone(),
            config_path: None,
            version,
        })
        .map_err(Error::InvalidData)?;
    }
    if let Some(settings) = &source.settings {
        let (contents, _) = read_settings(settings)?;
        write_private(&staging.join(SETTINGS), &contents)?;
    }
    let mut excluded: Vec<PathBuf> = ["", "-wal", "-shm", "-journal"]
        .into_iter()
        .map(|suffix| sibling(&source.database, suffix))
        .collect();
    excluded.extend(source.settings.iter().cloned());
    copy_profile_files(&source.directory, &staging, true, &excluded)?;
    let (database_hash, _) = hash_file_with_progress(&snapshot, |_, _| {})?;
    let marker = staging.join(".ready.tmp");
    write_private(&marker, &serde_json::to_vec(&Ready { database_hash })?)?;
    fs::rename(marker, staging.join(READY))?;
    sync_directory_durable(&staging)?;
    sync_directory_durable(target)?;
    install_staged(target, &staging)
}

fn discover_source() -> Result<Option<Source>> {
    let upstream = dirs::config_dir().map(|config| config.join("VRCX-0"));
    discover_source_from_dirs(upstream.as_deref(), &crate::legacy_vrcx::legacy_vrcx_dirs())
}

fn discover_source_from_dirs(
    upstream: Option<&Path>,
    original_directories: &[PathBuf],
) -> Result<Option<Source>> {
    if let Some(upstream) = upstream {
        let configured =
            vrcx_0_platform::app_paths::read_persisted_app_data_dir_from_default(upstream)
                .map_err(|error| {
                    Error::InvalidData(format!(
                        "Could not read upstream VRCX-0 data-directory settings: {error}"
                    ))
                })?;
        let has_custom_directory = configured.is_some();
        let directory = configured
            .map(|path| {
                if path.is_absolute() {
                    path
                } else {
                    upstream.join(path)
                }
            })
            .unwrap_or_else(|| upstream.to_path_buf());
        let database = directory.join(DATABASE);
        if database.try_exists()? {
            let settings = directory.join(SETTINGS);
            return Ok(Some(Source {
                directory,
                database,
                settings: settings.try_exists()?.then_some(settings),
                original_vrcx: false,
            }));
        }
        if has_custom_directory || directory.join(SETTINGS).try_exists()? {
            return Err(Error::InvalidData(format!(
                "An upstream VRCX-0 profile was found but its database is missing: {}",
                database.display()
            )));
        }
    }
    for directory in original_directories {
        let settings = crate::legacy_vrcx::resolve_legacy_config_path(directory);
        let mut database = directory.join("VRCX.sqlite3");
        if let Some(settings) = &settings {
            let (_, values) = read_settings(settings)?;
            if let Some(location) = values
                .get("VRCX_DatabaseLocation")
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
            {
                database = resolve_database_location(directory, location);
            }
        }
        if database.try_exists()? {
            return Ok(Some(Source {
                directory: directory.clone(),
                database,
                settings,
                original_vrcx: true,
            }));
        }
        if settings.is_some() {
            return Err(Error::InvalidData(format!(
                "A VRCX profile was found but its database is missing: {}",
                database.display()
            )));
        }
    }
    Ok(None)
}

fn resolve_database_location(directory: &Path, location: &str) -> PathBuf {
    #[cfg(not(windows))]
    {
        let bytes = location.as_bytes();
        if bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && matches!(bytes[2], b'\\' | b'/')
        {
            if let Some(drive_c) = directory
                .ancestors()
                .find(|path| path.file_name().is_some_and(|name| name == "drive_c"))
            {
                if let Some(prefix) = drive_c.parent() {
                    let mapped = prefix
                        .join("dosdevices")
                        .join(format!("{}:", (bytes[0] as char).to_ascii_lowercase()));
                    let root = if mapped.exists() {
                        Some(mapped)
                    } else if bytes[0].eq_ignore_ascii_case(&b'c') {
                        Some(drive_c.to_path_buf())
                    } else {
                        None
                    };
                    if let Some(root) = root {
                        return root.join(location[3..].replace('\\', "/"));
                    }
                }
            }
        }
    }
    let location = PathBuf::from(location);
    if location.is_absolute() {
        location
    } else {
        directory.join(location)
    }
}

pub(crate) fn copy_verified_database(source: &Path, target: &Path, raw: &Path) -> Result<()> {
    if raw.try_exists()? {
        if !fs::symlink_metadata(raw)?.file_type().is_dir() {
            return Err(Error::InvalidData(
                "Database import staging is not a regular directory.".into(),
            ));
        }
        fs::remove_dir_all(raw)?;
    }
    create_directory(raw)?;
    let raw_database = raw.join(DATABASE);
    copy_database_family(source, &raw_database)?;
    let recovered = rusqlite::Connection::open_with_flags(
        &raw_database,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE,
    )
    .map_err(Error::sqlite)?;
    check_integrity(&recovered)?;
    drop(recovered);
    crate::legacy_migration::copy_database_snapshot(&raw_database, target, |_, _| {})?;
    verify_database(target)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(target, fs::Permissions::from_mode(0o600))?;
        fs::OpenOptions::new()
            .write(true)
            .open(target)?
            .sync_all()?;
    }
    fs::remove_dir_all(raw)?;
    Ok(())
}

fn copy_database_family(source: &Path, target: &Path) -> Result<()> {
    let mut last_error = None;
    for _ in 0..3 {
        let attempt = (|| {
            let before = family_hashes(source)?;
            if before[0].is_none() {
                return Err(Error::InvalidData(format!(
                    "The source database disappeared: {}",
                    source.display()
                )));
            }
            for (suffix, expected) in ["", "-wal", "-journal"].iter().zip(&before) {
                let destination = sibling(target, suffix);
                if destination.try_exists()? {
                    fs::remove_file(&destination)?;
                }
                if expected.is_some() {
                    copy_verified(&sibling(source, suffix), &destination)?;
                }
            }
            if before != family_hashes(source)? || before != family_hashes(target)? {
                return Err(Error::InvalidData(
                    "The source database changed during the copy.".into(),
                ));
            }
            Ok(())
        })();
        match attempt {
            Ok(()) => return Ok(()),
            Err(error) => last_error = Some(error),
        }
    }
    Err(Error::InvalidData(format!("Could not safely copy {}. Close the source app and restart VRCX-0-Nanashi to retry. Originals have been preserved. {}", source.display(), last_error.unwrap())))
}

fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

fn family_hashes(database: &Path) -> Result<Vec<Option<(String, u64)>>> {
    ["", "-wal", "-journal"]
        .into_iter()
        .map(|suffix| {
            let path = sibling(database, suffix);
            if !path.try_exists()? {
                return Ok(None);
            }
            require_regular_file(&path)?;
            hash_file_with_progress(&path, |_, _| {}).map(Some)
        })
        .collect()
}

fn copy_verified(source: &Path, target: &Path) -> Result<()> {
    require_regular_file(source)?;
    let before = hash_file_with_progress(source, |_, _| {})?;
    let mut input = fs::File::open(source)?;
    let mut output = create_private_file(target)?;
    std::io::copy(&mut input, &mut output)?;
    output.sync_all()?;
    drop(output);
    if before != hash_file_with_progress(source, |_, _| {})?
        || before != hash_file_with_progress(target, |_, _| {})?
    {
        return Err(Error::InvalidData(format!(
            "A profile file changed during import. Close the source app and retry: {}",
            source.display()
        )));
    }
    Ok(())
}

fn copy_profile_files(
    source: &Path,
    target: &Path,
    top_level: bool,
    excluded: &[PathBuf],
) -> Result<()> {
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        if excluded
            .iter()
            .any(|path| vrcx_0_platform::app_paths::app_data_paths_match(&entry.path(), path))
        {
            continue;
        }
        let name = entry.file_name();
        let lower = name.to_string_lossy().to_ascii_lowercase();
        if top_level
            && (lower.ends_with(".lock")
                || matches!(
                    lower.as_str(),
                    "imagecache"
                        | "screenshotthumbs"
                        | "runtime.lock"
                        | "pending_vrcx_migration"
                        | "pending_profile_restore.json"
                        | "pending-data-import.json"
                        | "pending-data-dir-migration.json"
                        | "data-dir-cleanup-pending.json"
                        | "last-data-dir-migration-result.json"
                        | "last_profile_restore_result.json"
                        | "metadatacache.db"
                        | "metadatacache.db-wal"
                        | "metadatacache.db-shm"
                        | "ws-events.jsonl"
                        | "error-log.txt"
                        | "startup"
                        | "db-upgrade"
                        | "database-upgrade-recovery"
                        | "legacy-migration-staging"
                        | "merge-staging"
                        | "diagnostics"
                        | ".adoption-census-id"
                        | ".profile-name-migration"
                        | ".profile-auto-import"
                        | ".restore-pending"
                        | ".restore-rollback"
                        | ".export-staging"
                        | ".import-pending"
                        | ".migrate-staging"
                        | ".backup-staging"
                        | "vrcx-0.data-dir.json"
                        | "vrcx-0-nanashi.data-dir.json"
                        | "vrcx-0.sqlite3"
                        | "vrcx-0.sqlite3-wal"
                        | "vrcx-0.sqlite3-shm"
                        | "vrcx-0.sqlite3-journal"
                        | "vrcx-0.json"
                        | "vrcx.sqlite3"
                        | "vrcx.sqlite3-wal"
                        | "vrcx.sqlite3-shm"
                        | "vrcx.sqlite3-journal"
                        | "vrcx.json"
                        | "vrcx"
                        | "vrcx-0-nanashi.sqlite3"
                        | "vrcx-0-nanashi.sqlite3-wal"
                        | "vrcx-0-nanashi.sqlite3-shm"
                        | "vrcx-0-nanashi.sqlite3-journal"
                        | "vrcx-0-nanashi.json"
                ))
        {
            continue;
        }
        let destination = target.join(&name);
        if entry.file_type()?.is_dir() {
            create_directory(&destination)?;
            copy_profile_files(&entry.path(), &destination, false, excluded)?;
        } else {
            copy_verified(&entry.path(), &destination)?;
            fs::set_permissions(&destination, entry.metadata()?.permissions())?;
        }
    }
    Ok(())
}

fn install_staged(target: &Path, staging: &Path) -> Result<()> {
    if target
        .join(crate::profile_names::DATABASE_FILE)
        .try_exists()?
    {
        return Err(Error::InvalidData("An existing fork database takes priority over a pending automatic import. The staged snapshot and originals have been preserved.".into()));
    }
    let ready: Ready = serde_json::from_slice(&fs::read(staging.join(READY))?)?;
    let database = staging.join(DATABASE);
    if database.is_file() {
        if hash_file_with_progress(&database, |_, _| {})?.0 != ready.database_hash {
            return Err(Error::InvalidData(
                "Automatic import snapshot was damaged; originals have been preserved.".into(),
            ));
        }
    } else if !target.join(DATABASE).is_file()
        || hash_file_with_progress(&target.join(DATABASE), |_, _| {})?.0 != ready.database_hash
    {
        return Err(Error::InvalidData(
            "Automatic import snapshot is missing; originals have been preserved.".into(),
        ));
    }
    install_files(staging, target, true)?;
    if database.is_file() {
        install_file(&database, &target.join(DATABASE))?;
    }
    sync_directory_durable(target)?;
    fs::remove_dir_all(staging)?;
    sync_directory_durable(target)
}

fn install_files(source: &Path, target: &Path, top_level: bool) -> Result<()> {
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let name = entry.file_name();
        if top_level && (name == DATABASE || name == READY) {
            continue;
        }
        let destination = target.join(name);
        if entry.file_type()?.is_dir() {
            create_directory(&destination)?;
            install_files(&entry.path(), &destination, false)?;
        } else {
            install_file(&entry.path(), &destination)?;
        }
    }
    Ok(())
}

fn install_file(source: &Path, target: &Path) -> Result<()> {
    require_regular_file(source)?;
    if target.try_exists()? {
        require_regular_file(target)?;
        if hash_file_with_progress(source, |_, _| {})?
            != hash_file_with_progress(target, |_, _| {})?
        {
            return Err(Error::InvalidData(format!(
                "Automatic import will not overwrite an existing file: {}",
                target.display()
            )));
        }
        #[cfg(windows)]
        {
            let mut permissions = fs::metadata(source)?.permissions();
            if permissions.readonly() {
                permissions.set_readonly(false);
                fs::set_permissions(source, permissions)?;
            }
        }
        fs::remove_file(source)?;
    } else {
        fs::rename(source, target)?;
        if let Some(parent) = target.parent() {
            sync_directory_durable(parent)?;
        }
    }
    Ok(())
}

fn require_regular_file(path: &Path) -> Result<()> {
    if !fs::symlink_metadata(path)?.file_type().is_file() {
        return Err(Error::InvalidData(format!(
            "Import requires a regular file: {}",
            path.display()
        )));
    }
    Ok(())
}

fn create_directory(path: &Path) -> Result<()> {
    if path.try_exists()? {
        if !fs::symlink_metadata(path)?.file_type().is_dir() {
            return Err(Error::InvalidData(format!(
                "Import requires a regular directory: {}",
                path.display()
            )));
        }
        return Ok(());
    }
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path)?;
    Ok(())
}

fn write_private(path: &Path, contents: &[u8]) -> Result<()> {
    use std::io::Write;
    let mut output = create_private_file(path)?;
    output.write_all(contents)?;
    output.sync_all()?;
    Ok(())
}

pub(crate) fn read_settings(path: &Path) -> Result<(Vec<u8>, HashMap<String, String>)> {
    let contents = fs::read(path).map_err(|error| {
        Error::InvalidData(format!(
            "Could not read profile settings at {}: {error}. Originals have been preserved.",
            path.display()
        ))
    })?;
    let values = serde_json::from_slice(&contents).map_err(|error| {
        Error::InvalidData(format!(
            "Invalid profile settings at {}: {error}. Originals have been preserved.",
            path.display()
        ))
    })?;
    Ok((contents, values))
}

pub(crate) fn verify_database(path: &Path) -> Result<()> {
    let conn =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(Error::sqlite)?;
    check_integrity(&conn)
}

fn check_integrity(conn: &rusqlite::Connection) -> Result<()> {
    let result: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(Error::sqlite)?;
    if result != "ok" {
        return Err(Error::InvalidData(format!(
            "Imported database failed integrity checking: {result}"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests;
