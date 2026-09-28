//! Fork: "Import from VRCX / VRCX-0" - non-destructive merge into this profile.
//!
//! 1. Snapshot the source database (safe while the other app runs).
//! 2. Upgrade the snapshot to this app's schema with the normal upgrade
//!    pipeline (which also converts VRCX's schema).
//! 3. Back up this profile's database.
//! 4. Merge rows (see `vrcx_0_persistence::profile_merge`).

use std::path::{Path, PathBuf};

use vrcx_0_application::profile::DatabaseUpgradeRunStatus;
use vrcx_0_application_core::Error;
use vrcx_0_persistence::legacy_migration::snapshot_database;
use vrcx_0_persistence::profile_merge::{
    import_profile_configs_file, import_settings_file, merge_profile_database_file,
    merge_settings_file, ProfileMergeReport, ProfileSettingsImportReport,
};
use vrcx_0_persistence::DatabaseService;

use crate::map_persistence_error;
use crate::profile_database_upgrade::run_database_upgrade_with_progress;

const MERGE_STAGING_DIR: &str = "merge-staging";
const STAGED_DB_FILE: &str = "source.sqlite3";

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileMergeSourceKind {
    Vrcx,
    Vrcx0,
}

#[derive(Clone, Debug, Default, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileMergeSources {
    pub vrcx: Option<String>,
    pub vrcx0: Option<String>,
}

/// JSON settings file that belongs to the source profile, if any.
fn profile_merge_settings_path(kind: ProfileMergeSourceKind, db: &Path) -> Option<PathBuf> {
    match kind {
        ProfileMergeSourceKind::Vrcx => {
            vrcx_0_persistence::legacy_vrcx::discover_supported_legacy_source()
                .importable_source
                .and_then(|source| source.config_path)
        }
        ProfileMergeSourceKind::Vrcx0 => db.parent().map(|dir| dir.join("VRCX-0.json")),
    }
}

pub fn profile_merge_source_path(kind: ProfileMergeSourceKind) -> Option<PathBuf> {
    match kind {
        ProfileMergeSourceKind::Vrcx => {
            vrcx_0_persistence::legacy_vrcx::discover_supported_legacy_source()
                .importable_source
                .map(|source| source.db_path)
        }
        ProfileMergeSourceKind::Vrcx0 => vrcx_0_platform::app_paths::upstream_vrcx0_profile_db(),
    }
}

pub fn profile_merge_sources() -> ProfileMergeSources {
    let display = |kind| profile_merge_source_path(kind).map(|path| path.display().to_string());
    ProfileMergeSources {
        vrcx: display(ProfileMergeSourceKind::Vrcx),
        vrcx0: display(ProfileMergeSourceKind::Vrcx0),
    }
}

/// Snapshot the source profile, convert the snapshot to this app's schema,
/// back up this profile's database, then run `apply` with the snapshot and the
/// source database path.
fn with_staged_source<T>(
    db: &DatabaseService,
    app_data: &Path,
    kind: ProfileMergeSourceKind,
    backup_label: &str,
    apply: impl FnOnce(&Path, &Path) -> Result<T, Error>,
) -> Result<T, Error> {
    let source = profile_merge_source_path(kind)
        .ok_or_else(|| Error::Custom("No data found to import from.".into()))?;
    if source == db.db_path() {
        return Err(Error::Custom("That is this profile's own database.".into()));
    }
    let staging = app_data.join(MERGE_STAGING_DIR);
    if staging.exists() {
        std::fs::remove_dir_all(&staging).map_err(|error| Error::Custom(error.to_string()))?;
    }
    std::fs::create_dir_all(&staging).map_err(|error| Error::Custom(error.to_string()))?;
    let result = (|| {
        let snapshot = staging.join(STAGED_DB_FILE);
        snapshot_database(&source, &snapshot).map_err(map_persistence_error)?;
        {
            let staged = DatabaseService::new(&snapshot).map_err(map_persistence_error)?;
            let upgrade = run_database_upgrade_with_progress(&staged, |_| {});
            if !matches!(
                upgrade.status,
                DatabaseUpgradeRunStatus::Current | DatabaseUpgradeRunStatus::Upgraded
            ) {
                return Err(Error::Custom(format!(
                    "The source data could not be converted ({:?}){}",
                    upgrade.status,
                    upgrade
                        .error
                        .map(|error| format!(": {error}"))
                        .unwrap_or_default()
                )));
            }
            staged.checkpoint_wal().map_err(map_persistence_error)?;
        }
        let backups = app_data.join("backups");
        std::fs::create_dir_all(&backups).map_err(|error| Error::Custom(error.to_string()))?;
        let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
        snapshot_database(
            db.db_path(),
            &backups.join(format!("before-{backup_label}-{stamp}.sqlite3")),
        )
        .map_err(map_persistence_error)?;
        apply(&snapshot, &source)
    })();
    let _ = std::fs::remove_dir_all(&staging);
    result
}

pub fn run_profile_merge(
    db: &DatabaseService,
    storage: &vrcx_0_persistence::storage::StorageService,
    app_data: &Path,
    kind: ProfileMergeSourceKind,
) -> Result<ProfileMergeReport, Error> {
    with_staged_source(db, app_data, kind, "merge", |snapshot, source| {
        let mut report =
            merge_profile_database_file(db.db_path(), snapshot).map_err(map_persistence_error)?;
        if let Some(settings) = profile_merge_settings_path(kind, source) {
            report.settings_file_keys_added =
                merge_settings_file(storage, &settings).map_err(map_persistence_error)?;
        }
        tracing::info!(
            source = %source.display(),
            rows = report.rows_added,
            tables = report.tables_merged,
            "merged external profile data"
        );
        Ok(report)
    })
}

/// Import only settings from VRCX or upstream VRCX-0, replacing the values
/// set in this profile. History, notes and favorites are untouched.
pub fn run_profile_settings_import(
    db: &DatabaseService,
    storage: &vrcx_0_persistence::storage::StorageService,
    app_data: &Path,
    kind: ProfileMergeSourceKind,
) -> Result<ProfileSettingsImportReport, Error> {
    with_staged_source(db, app_data, kind, "settings-import", |snapshot, source| {
        let mut report = ProfileSettingsImportReport {
            configs_imported: import_profile_configs_file(db.db_path(), snapshot)
                .map_err(map_persistence_error)?,
            ..ProfileSettingsImportReport::default()
        };
        if let Some(settings) = profile_merge_settings_path(kind, source) {
            report.settings_file_keys_imported =
                import_settings_file(storage, &settings).map_err(map_persistence_error)?;
        }
        tracing::info!(
            source = %source.display(),
            configs = report.configs_imported,
            settings = report.settings_file_keys_imported,
            "imported external profile settings"
        );
        Ok(report)
    })
}
