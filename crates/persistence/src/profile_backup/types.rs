use serde::{Deserialize, Serialize};
pub use vrcx_0_contracts::{
    ProfileBackupKind, ProfileRestoreAppVersionCheck, ProfileRestoreArchiveCheck,
    ProfileRestoreDataDisposition, ProfileRestoreDatabaseCheck, ProfileRestoreDatabaseVersionCheck,
    ProfileRestoreFailure, ProfileRestoreFailureCode, ProfileRestoreManifestSummary,
    ProfileRestoreResult, ProfileRestoreResultStatus, ProfileRestoreValidation,
    ProfileRestoreValidationOutcome,
};

pub const BACKUP_STAGING_DIRECTORY: &str = ".backup-staging";
pub const DATABASE_FILE_NAME: &str = "VRCX-0.sqlite3";
pub const MANIFEST_FILE_NAME: &str = "manifest.json";
pub(crate) const MAX_PROFILE_DATABASE_BYTES: u64 = 16 * 1024 * 1024 * 1024;
pub const RESTORE_JOURNAL_FILE_NAME: &str = "pending_profile_restore.json";
pub const RESTORE_PENDING_DIRECTORY: &str = ".restore-pending";
pub const RESTORE_RESULT_FILE_NAME: &str = "last_profile_restore_result.json";
pub const RESTORE_ROLLBACK_DIRECTORY: &str = ".restore-rollback";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileBackupContent {
    pub path: String,
    pub sha256: String,
    pub bytes: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileBackupManifest {
    pub manifest_version: u32,
    pub app_version: String,
    pub db_version: i64,
    #[serde(deserialize_with = "vrcx_0_contracts::epoch::de")]
    pub created_at: i64,
    pub platform: String,
    pub kind: ProfileBackupKind,
    pub contents: Vec<ProfileBackupContent>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProfileBackupManifestMetadata {
    pub app_version: String,
    pub db_version: i64,
    pub created_at: i64,
    pub platform: String,
    pub kind: ProfileBackupKind,
}
