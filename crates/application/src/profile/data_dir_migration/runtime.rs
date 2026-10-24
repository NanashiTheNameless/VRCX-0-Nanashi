use std::path::{Path, PathBuf};
use std::sync::Arc;

use vrcx_0_application_core::Result;
use vrcx_0_contracts::{DataDirCleanupPending, DataDirCleanupReport, DataDirMigrationResult};

use super::{
    DataDirMigrationActionOutcome, DataDirMigrationMode, DataDirMigrationPlan,
    DataDirMigrationStatus,
};

pub type DataDirPointerCommitter = Arc<dyn Fn(&Path) -> Result<()> + Send + Sync + 'static>;

pub trait DataDirMigrationPort: Send + Sync {
    fn current_status(&self) -> DataDirMigrationStatus;
    fn request_migration(
        &self,
        plan: DataDirMigrationPlan,
        mode: DataDirMigrationMode,
    ) -> DataDirMigrationActionOutcome;
    fn run_migration(
        &self,
        target_dir: PathBuf,
        replace_existing: bool,
    ) -> DataDirMigrationActionOutcome;
    fn request_cancel(&self) -> DataDirMigrationActionOutcome;
    fn switch_data_dir_pointer(&self, target_dir: PathBuf) -> DataDirMigrationActionOutcome;
    fn take_last_result(&self) -> Result<Option<DataDirMigrationResult>>;
    fn cleanup_pending(&self) -> Result<Option<DataDirCleanupPending>>;
    fn cleanup_migrated_data(&self) -> Result<Option<DataDirCleanupReport>>;
    fn dismiss_cleanup(&self) -> Result<()>;
    fn mark_cleanup_prompted(&self, prompted_at: i64) -> Result<()>;
}

#[derive(Clone)]
pub struct DataDirMigrationRuntime {
    inner: Arc<dyn DataDirMigrationPort>,
}

impl DataDirMigrationRuntime {
    pub fn new(inner: Arc<dyn DataDirMigrationPort>) -> Self {
        Self { inner }
    }

    pub fn current_status(&self) -> DataDirMigrationStatus {
        self.inner.current_status()
    }

    pub fn request_migration(
        &self,
        plan: DataDirMigrationPlan,
        mode: DataDirMigrationMode,
    ) -> DataDirMigrationActionOutcome {
        self.inner.request_migration(plan, mode)
    }

    pub fn run_migration(
        &self,
        target_dir: PathBuf,
        replace_existing: bool,
    ) -> DataDirMigrationActionOutcome {
        self.inner.run_migration(target_dir, replace_existing)
    }

    pub fn request_cancel(&self) -> DataDirMigrationActionOutcome {
        self.inner.request_cancel()
    }

    pub fn switch_data_dir_pointer(&self, target_dir: PathBuf) -> DataDirMigrationActionOutcome {
        self.inner.switch_data_dir_pointer(target_dir)
    }

    pub fn take_last_result(&self) -> Result<Option<DataDirMigrationResult>> {
        self.inner.take_last_result()
    }

    pub fn cleanup_pending(&self) -> Result<Option<DataDirCleanupPending>> {
        self.inner.cleanup_pending()
    }

    pub fn cleanup_migrated_data(&self) -> Result<Option<DataDirCleanupReport>> {
        self.inner.cleanup_migrated_data()
    }

    pub fn dismiss_cleanup(&self) -> Result<()> {
        self.inner.dismiss_cleanup()
    }

    pub fn mark_cleanup_prompted(&self, prompted_at: i64) -> Result<()> {
        self.inner.mark_cleanup_prompted(prompted_at)
    }
}
