use serde::{Deserialize, Serialize};

pub const DATA_DIR_MIGRATION_SPACE_MARGIN_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum DataDirMigrationTargetState {
    Empty,
    ExistingProfile,
    ForeignContent,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum DataDirMigrationResultStatus {
    Succeeded,
    Interrupted,
    DatabaseOpenFailed,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum DataDirMigrationWarning {
    ConfigCopyFailed,
    GalleryCopyFailed,
    CacheCleanupFailed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DataDirMigrationResult {
    pub status: DataDirMigrationResultStatus,
    pub source_dir: String,
    pub target_dir: String,
    pub warnings: Vec<DataDirMigrationWarning>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DataDirCleanupPending {
    pub old_dir: String,
    pub bytes: u64,
    #[serde(deserialize_with = "crate::epoch::de")]
    pub migrated_at: i64,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::epoch::de_opt"
    )]
    pub last_prompted_at: Option<i64>,
    pub dismissed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replaced_dir: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DataDirCleanupReport {
    pub freed_bytes: u64,
    pub skipped: Vec<String>,
}
