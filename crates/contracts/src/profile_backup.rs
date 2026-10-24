use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileBackupKind {
    Auto,
    Manual,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileRestoreArchiveCheck {
    Valid,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileRestoreAppVersionCheck {
    Compatible,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileRestoreDatabaseVersionCheck {
    Compatible,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileRestoreDatabaseCheck {
    Valid,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRestoreManifestSummary {
    pub app_version: String,
    pub db_version: i64,
    #[serde(deserialize_with = "crate::epoch::de")]
    pub created_at: i64,
    pub platform: String,
    pub kind: ProfileBackupKind,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRestoreValidation {
    pub manifest: ProfileRestoreManifestSummary,
    pub source_file_name: String,
    pub staged_sha256: String,
    pub staged_bytes: u64,
    pub archive: ProfileRestoreArchiveCheck,
    pub app_version: ProfileRestoreAppVersionCheck,
    pub database_version: ProfileRestoreDatabaseVersionCheck,
    pub database: ProfileRestoreDatabaseCheck,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileRestoreFailureCode {
    OperationBusy,
    PendingRestore,
    PendingDataDirMigration,
    InvalidArchive,
    InvalidEntries,
    UnsupportedManifestVersion,
    InvalidAppVersion,
    NewerAppVersion,
    NewerDatabaseVersion,
    ContentSizeMismatch,
    ContentHashMismatch,
    ValidationExpired,
    DatabaseCheckFailed,
    NotProfileDatabase,
    DatabaseVersionMismatch,
    StagingCorrupted,
    DatabaseOpenFailed,
    Io,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRestoreFailure {
    pub code: ProfileRestoreFailureCode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRestoreValidationOutcome {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validation: Option<ProfileRestoreValidation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<ProfileRestoreFailure>,
}

impl ProfileRestoreValidationOutcome {
    pub fn accepted(validation: ProfileRestoreValidation) -> Self {
        Self {
            validation: Some(validation),
            failure: None,
        }
    }

    pub fn rejected(code: ProfileRestoreFailureCode, path: Option<String>) -> Self {
        Self {
            validation: None,
            failure: Some(ProfileRestoreFailure { code, path }),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileRestoreResultStatus {
    Succeeded,
    Failed,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileRestoreDataDisposition {
    Replaced,
    RolledBack,
    Unchanged,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRestoreResult {
    pub status: ProfileRestoreResultStatus,
    pub data_disposition: ProfileRestoreDataDisposition,
    pub source_file_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<ProfileRestoreFailure>,
}
