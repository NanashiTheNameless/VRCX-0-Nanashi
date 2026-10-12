use std::path::{Path, PathBuf};
use std::sync::Arc;

use vrcx_0_application::profile::{
    ProfileBackupActionOutcome, ProfileBackupRuntime, ProfileBackupSettings, ProfileBackupStatus,
    ProfileRestoreResult, ProfileRestoreRollbackCleanupOutcome, ProfileRestoreRollbackState,
    ProfileRestoreValidationOutcome,
};
use vrcx_0_platform::app_paths::AppPaths;

use crate::feed_logger::{DesktopFeedLoggerRuntime, FeedLoggerError};
use crate::{HostFileAccess, Result};

#[derive(Clone)]
pub struct DesktopProfileBackupRuntime {
    runtime: ProfileBackupRuntime,
    file_access: HostFileAccess,
    app_paths: AppPaths,
    feed_logger: Arc<DesktopFeedLoggerRuntime>,
}

#[derive(Debug, thiserror::Error)]
pub enum ProfileBackupSettingsError {
    #[error(transparent)]
    RecorderNeedsBackups(#[from] FeedLoggerError),
    #[error(transparent)]
    Backup(#[from] crate::Error),
}

pub struct DesktopProfileRestoreRequest {
    pub outcome: ProfileRestoreValidationOutcome,
    pub restart_required: bool,
}

impl DesktopProfileBackupRuntime {
    pub fn new(
        runtime: ProfileBackupRuntime,
        file_access: HostFileAccess,
        app_paths: AppPaths,
        feed_logger: Arc<DesktopFeedLoggerRuntime>,
    ) -> Self {
        Self {
            runtime,
            file_access,
            app_paths,
            feed_logger,
        }
    }

    pub fn settings(&self) -> ProfileBackupSettings {
        self.runtime.settings()
    }

    pub fn set_settings(
        &self,
        settings: ProfileBackupSettings,
    ) -> std::result::Result<ProfileBackupSettings, ProfileBackupSettingsError> {
        self.feed_logger
            .ensure_backup_can_turn_off(settings.auto_enabled)?;
        if let Some(target) = self.runtime.target_dir_requiring_grant(&settings) {
            self.file_access
                .ensure_write_allowed(&target, &self.app_paths)?;
        }
        Ok(self.runtime.set_settings(settings))
    }

    pub fn run_manual(&self, target_path: String) -> Result<ProfileBackupActionOutcome> {
        self.file_access
            .ensure_write_allowed(&target_path, &self.app_paths)?;
        Ok(self.runtime.run_manual(target_path))
    }

    pub fn retry_delivery(&self) -> ProfileBackupActionOutcome {
        self.runtime.retry_delivery()
    }

    pub fn discard_pending(&self) -> ProfileBackupActionOutcome {
        self.runtime.discard_pending()
    }

    pub fn dismiss_error(&self) -> ProfileBackupStatus {
        self.runtime.dismiss_error()
    }

    pub fn current_status(&self) -> ProfileBackupStatus {
        self.runtime.current_status()
    }

    pub fn validate_restore(&self, path: String) -> Result<ProfileRestoreValidationOutcome> {
        let source = PathBuf::from(path);
        self.file_access
            .ensure_read_allowed(&source, &self.app_paths)?;
        Ok(self.runtime.validate_restore(&source))
    }

    pub fn request_restore(&self, expected_sha256: String) -> DesktopProfileRestoreRequest {
        desktop_profile_restore_request(self.runtime.request_restore(&expected_sha256))
    }

    pub fn discard_staged_restore(&self) -> Result<()> {
        Ok(self.runtime.discard_staged_restore()?)
    }

    pub fn take_last_restore_result(&self) -> Result<Option<ProfileRestoreResult>> {
        Ok(self.runtime.take_last_restore_result()?)
    }

    pub fn restore_rollback_state(&self) -> Result<ProfileRestoreRollbackState> {
        Ok(self.runtime.restore_rollback_state()?)
    }

    pub fn clear_restore_rollback(&self) -> ProfileRestoreRollbackCleanupOutcome {
        self.runtime.clear_restore_rollback()
    }

    pub fn register_target_grant(&self, path: &Path) {
        self.file_access.register_path(path);
    }
}

fn desktop_profile_restore_request(
    outcome: ProfileRestoreValidationOutcome,
) -> DesktopProfileRestoreRequest {
    let restart_required = outcome.validation.is_some();
    DesktopProfileRestoreRequest {
        outcome,
        restart_required,
    }
}

#[cfg(test)]
mod tests {
    use vrcx_0_contracts::{
        ProfileBackupKind, ProfileRestoreAppVersionCheck, ProfileRestoreArchiveCheck,
        ProfileRestoreDatabaseCheck, ProfileRestoreDatabaseVersionCheck, ProfileRestoreFailureCode,
        ProfileRestoreManifestSummary, ProfileRestoreValidation, ProfileRestoreValidationOutcome,
    };

    use super::desktop_profile_restore_request;

    #[test]
    fn accepted_restore_requests_require_restart_and_rejections_do_not() {
        let accepted = ProfileRestoreValidationOutcome::accepted(ProfileRestoreValidation {
            manifest: ProfileRestoreManifestSummary {
                app_version: "2.24.3".into(),
                db_version: 18,
                created_at: "2026-08-22T00:00:00.000Z".into(),
                platform: "windows".into(),
                kind: ProfileBackupKind::Manual,
            },
            source_file_name: "profile.vrcx0backup".into(),
            staged_sha256: "hash".into(),
            staged_bytes: 42,
            archive: ProfileRestoreArchiveCheck::Valid,
            app_version: ProfileRestoreAppVersionCheck::Compatible,
            database_version: ProfileRestoreDatabaseVersionCheck::Compatible,
            database: ProfileRestoreDatabaseCheck::Valid,
        });
        let rejected = ProfileRestoreValidationOutcome::rejected(
            ProfileRestoreFailureCode::InvalidArchive,
            Some("profile.vrcx0backup".into()),
        );

        let accepted = desktop_profile_restore_request(accepted);
        let rejected = desktop_profile_restore_request(rejected);

        assert!(accepted.restart_required);
        assert!(accepted.outcome.validation.is_some());
        assert!(!rejected.restart_required);
        assert_eq!(
            rejected.outcome.failure.unwrap().code,
            ProfileRestoreFailureCode::InvalidArchive
        );
    }
}
