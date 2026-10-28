use std::fs;
use std::path::Path;

use super::filesystem::clear_data_dir_migration_staging;
use super::journal::{
    append_data_dir_cleanup_pending, read_data_dir_cleanup_pending,
    remove_pending_data_dir_migration, write_data_dir_cleanup_pending,
    write_data_dir_migration_result,
};
use super::types::{
    DataDirMigrationFinalizeOutcome, DataDirMigrationJournalPhase, DataDirMigrationResult,
    DataDirMigrationResultStatus, DataDirMigrationTargetState, PendingDataDirMigration,
};
use crate::{Error, Result};

const PROFILE_DATABASE_FILE: &str = "VRCX-0-Nanashi.sqlite3";

pub fn inspect_data_dir_migration_target(target_dir: &Path) -> Result<DataDirMigrationTargetState> {
    if !target_dir.is_dir() {
        return Err(Error::InvalidData(format!(
            "Data directory migration target is not a directory: {}",
            target_dir.display()
        )));
    }
    if target_dir.join(PROFILE_DATABASE_FILE).is_file()
        || target_dir.join("VRCX-0.sqlite3").is_file()
    {
        return Ok(DataDirMigrationTargetState::ExistingProfile);
    }
    if fs::read_dir(target_dir)?.next().transpose()?.is_none() {
        Ok(DataDirMigrationTargetState::Empty)
    } else {
        Ok(DataDirMigrationTargetState::ForeignContent)
    }
}

pub fn cleanup_interrupted_data_dir_migration(
    control_dir: &Path,
    journal: &PendingDataDirMigration,
) -> Result<()> {
    journal.validate()?;
    if journal.phase != DataDirMigrationJournalPhase::Copying {
        return Err(Error::InvalidData(
            "Only a copying data directory migration can be interrupted.".into(),
        ));
    }
    clear_data_dir_migration_staging(Path::new(&journal.target_dir))?;
    write_data_dir_migration_result(
        control_dir,
        &DataDirMigrationResult {
            status: DataDirMigrationResultStatus::Interrupted,
            source_dir: journal.source_dir.clone(),
            target_dir: journal.target_dir.clone(),
            warnings: Vec::new(),
        },
    )?;
    remove_pending_data_dir_migration(control_dir)
}

pub fn complete_data_dir_migration(
    control_dir: &Path,
    journal: &PendingDataDirMigration,
    outcome: &DataDirMigrationFinalizeOutcome,
) -> Result<()> {
    append_data_dir_cleanup_pending(control_dir, &outcome.cleanup_pending)?;
    write_data_dir_migration_result(
        control_dir,
        &DataDirMigrationResult {
            status: DataDirMigrationResultStatus::Succeeded,
            source_dir: journal.source_dir.clone(),
            target_dir: journal.target_dir.clone(),
            warnings: outcome.warnings.clone(),
        },
    )?;
    remove_pending_data_dir_migration(control_dir)
}

pub fn record_data_dir_migration_database_open_failure(
    control_dir: &Path,
    journal: &PendingDataDirMigration,
) -> Result<()> {
    remove_pending_data_dir_migration(control_dir)?;
    write_data_dir_migration_result(
        control_dir,
        &DataDirMigrationResult {
            status: DataDirMigrationResultStatus::DatabaseOpenFailed,
            source_dir: journal.source_dir.clone(),
            target_dir: journal.target_dir.clone(),
            warnings: Vec::new(),
        },
    )
}

pub fn dismiss_data_dir_cleanup(control_dir: &Path) -> Result<()> {
    let Some(mut pending) = read_data_dir_cleanup_pending(control_dir)? else {
        return Ok(());
    };
    pending.dismissed = true;
    write_data_dir_cleanup_pending(control_dir, &pending)
}
