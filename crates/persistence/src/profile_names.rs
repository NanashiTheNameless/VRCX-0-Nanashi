use std::fs;
use std::path::Path;

use crate::profile_backup::{create_private_file, replace_file_atomically, sync_directory_durable};
use crate::{Error, Result};

pub const DATABASE_FILE: &str = "VRCX-0-Nanashi.sqlite3";
pub const SETTINGS_FILE: &str = "VRCX-0-Nanashi.json";
const LEGACY_DATABASE: &str = "VRCX-0.sqlite3";
const LEGACY_SETTINGS: &str = "VRCX-0.json";
const STAGING: &str = ".profile-name-migration";

pub fn migrate_profile_names(directory: &Path) -> Result<()> {
    let database = directory.join(DATABASE_FILE);
    let legacy_database = directory.join(LEGACY_DATABASE);
    let settings = directory.join(SETTINGS_FILE);
    let legacy_settings = directory.join(LEGACY_SETTINGS);
    let has_database = database.try_exists()?;
    if has_database {
        require_regular_file(&database)?;
    }
    if settings.try_exists()? {
        require_regular_file(&settings)?;
    }
    if has_database && (settings.try_exists()? || !legacy_settings.try_exists()?) {
        return Ok(());
    }
    if !has_database {
        let legacy_paths = crate::legacy_migration::LegacyMigrationPaths {
            app_data: directory.to_path_buf(),
            db_file: legacy_database.clone(),
            config_file: legacy_settings.clone(),
        };
        crate::legacy_migration::consume_pending_legacy_migration(&legacy_paths)?;
        if let Some(pending) =
            crate::profile_backup::consume_pending_profile_restore(directory, &legacy_database)?
        {
            match crate::DatabaseService::new(&legacy_database) {
                Ok(db) => {
                    drop(db);
                    pending.finalize()?;
                }
                Err(error) => {
                    pending.rollback(
                        crate::profile_backup::ProfileRestoreFailureCode::DatabaseOpenFailed,
                    )?;
                    return Err(error);
                }
            }
        }
    }
    if !legacy_database.try_exists()? && !directory.join(LEGACY_SETTINGS).try_exists()? {
        return Ok(());
    }
    for suffix in ["-wal", "-shm", "-journal"] {
        if !has_database
            && directory
                .join(format!("{DATABASE_FILE}{suffix}"))
                .try_exists()?
        {
            return Err(Error::InvalidData(
                "Database rename found sidecars without their database; preserve these files and recover the profile before retrying.".into(),
            ));
        }
    }
    let staging = directory.join(STAGING);
    if staging.try_exists()? {
        if !fs::symlink_metadata(&staging)?.file_type().is_dir() {
            return Err(Error::InvalidData(
                "Profile rename staging path is not a regular directory.".into(),
            ));
        }
    } else {
        let builder = fs::DirBuilder::new();
        #[cfg(unix)]
        let builder = {
            use std::os::unix::fs::DirBuilderExt;
            let mut builder = builder;
            builder.mode(0o700);
            builder
        };
        builder.create(&staging)?;
        sync_directory_durable(directory)?;
    }
    if !has_database && legacy_database.try_exists()? {
        require_regular_file(&legacy_database)?;
        let snapshot = staging.join(DATABASE_FILE);
        crate::profile_import::copy_verified_database(
            &legacy_database,
            &snapshot,
            &staging.join(".source"),
        )?;
        fs::OpenOptions::new()
            .write(true)
            .open(&snapshot)?
            .sync_all()?;
    }
    if !settings.try_exists()? && legacy_settings.try_exists()? {
        require_regular_file(&legacy_settings)?;
        let (contents, _) = crate::profile_import::read_settings(&legacy_settings)?;
        let temporary = staging.join(SETTINGS_FILE);
        if temporary.try_exists()? {
            fs::remove_file(&temporary)?;
        }
        use std::io::Write;
        let mut output = create_private_file(&temporary)?;
        output.write_all(&contents)?;
        output.sync_all()?;
        drop(output);
        replace_file_atomically(&temporary, &settings)?;
        sync_directory_durable(directory)?;
    }
    if !has_database && legacy_database.try_exists()? {
        replace_file_atomically(&staging.join(DATABASE_FILE), &database)?;
        sync_directory_durable(directory)?;
    }
    Ok(())
}

fn require_regular_file(path: &Path) -> Result<()> {
    if !fs::symlink_metadata(path)?.file_type().is_file() {
        return Err(Error::InvalidData(format!(
            "Profile migration requires a regular file: {}",
            path.display()
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests;
