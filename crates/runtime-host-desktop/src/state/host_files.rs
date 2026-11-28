use std::sync::Arc;

use vrcx_0_composition::Result;

use super::DesktopRuntimeHostState;

impl DesktopRuntimeHostState {
    pub fn register_host_file_access(&self, path: impl AsRef<std::path::Path>) {
        self.desktop.host_file_access.register_path(path);
    }

    pub fn ensure_host_read_allowed(&self, path: impl AsRef<std::path::Path>) -> Result<()> {
        self.desktop
            .host_file_access
            .ensure_read_allowed(path, self.runtime.paths())
    }

    pub fn ensure_host_write_allowed(&self, path: impl AsRef<std::path::Path>) -> Result<()> {
        self.desktop
            .host_file_access
            .ensure_write_allowed(path, self.runtime.paths())
    }

    pub fn is_known_runtime_root_path(&self, path: impl AsRef<std::path::Path>) -> bool {
        crate::is_known_root_path(path, self.runtime.paths())
    }

    pub fn is_screenshot_thumbnail_path(&self, path: impl AsRef<std::path::Path>) -> bool {
        vrcx_0_platform::path_utils::is_path_inside_directory(
            path.as_ref(),
            &self.runtime.paths().screenshot_thumbs,
        )
    }

    pub fn app_data_path(&self) -> &std::path::Path {
        &self.runtime.paths().app_data
    }

    pub fn start_screenshot_library_scan(
        &self,
        force: bool,
    ) -> vrcx_0_core::screenshots::ScreenshotLibraryScanStatus {
        vrcx_0_outbound_adapters::screenshots::start_screenshot_library_scan(
            &self.game.screenshot_cache,
            self.screenshots.screenshot_favorites().clone(),
            self.runtime.paths().screenshot_thumbs.clone(),
            self.runtime.desktop_assembly().event_bus().clone(),
            self.runtime.desktop_assembly().tasks().clone(),
            force,
            vrcx_0_host_desktop::vrchat_paths::vrchat_photos_location(),
        )
    }

    pub fn append_error_log(&self, entry: &str) {
        vrcx_0_platform::error_log::append_error_log_entry(&self.runtime.paths().app_data, entry);
    }

    pub fn profile_merge_sources(&self) -> vrcx_0_outbound_adapters::ProfileMergeSources {
        vrcx_0_outbound_adapters::profile_merge_sources()
    }

    /// Fork: non-destructively merge VRCX or upstream VRCX-0 data into this profile.
    /// Fork (VRCX's DB Merger): merge a profile database file the user picked.
    pub async fn run_profile_merge_file(
        &self,
        path: std::path::PathBuf,
    ) -> Result<vrcx_0_persistence::profile_merge::ProfileMergeReport> {
        self.ensure_host_read_allowed(&path)?;
        let database = Arc::clone(self.runtime.database());
        let app_data = self.runtime.paths().app_data.clone();
        tokio::task::spawn_blocking(move || {
            vrcx_0_outbound_adapters::run_profile_merge_file(&database, &app_data, path)
        })
        .await
        .map_err(|error| {
            vrcx_0_composition::Error::from(vrcx_0_application_core::Error::Custom(format!(
                "import task failed: {error}"
            )))
        })?
        .map_err(|error| {
            vrcx_0_composition::Error::from(vrcx_0_application_core::Error::Custom(
                error.to_string(),
            ))
        })
    }

    pub async fn run_profile_merge(
        &self,
        kind: vrcx_0_outbound_adapters::ProfileMergeSourceKind,
    ) -> Result<vrcx_0_persistence::profile_merge::ProfileMergeReport> {
        let database = Arc::clone(self.runtime.database());
        let storage = Arc::clone(self.runtime.storage());
        let app_data = self.runtime.paths().app_data.clone();
        tokio::task::spawn_blocking(move || {
            vrcx_0_outbound_adapters::run_profile_merge(&database, &storage, &app_data, kind)
        })
        .await
        .map_err(|error| {
            vrcx_0_composition::Error::from(vrcx_0_application_core::Error::Custom(format!(
                "import task failed: {error}"
            )))
        })?
        .map_err(|error| {
            vrcx_0_composition::Error::from(vrcx_0_application_core::Error::Custom(
                error.to_string(),
            ))
        })
    }

    /// Fork: export all profile data and settings to one level 9 zip.
    pub async fn run_data_export(
        &self,
        archive: std::path::PathBuf,
        app_version: String,
    ) -> Result<vrcx_0_outbound_adapters::DataExportReport> {
        self.ensure_host_write_allowed(&archive)?;
        let database = Arc::clone(self.runtime.database());
        let storage = Arc::clone(self.runtime.storage());
        let app_data = self.runtime.paths().app_data.clone();
        tokio::task::spawn_blocking(move || {
            vrcx_0_outbound_adapters::run_data_export(
                &database,
                &storage,
                &app_data,
                &archive,
                &app_version,
            )
        })
        .await
        .map_err(|error| {
            vrcx_0_composition::Error::from(vrcx_0_application_core::Error::Custom(format!(
                "export task failed: {error}"
            )))
        })?
        .map_err(|error| {
            vrcx_0_composition::Error::from(vrcx_0_application_core::Error::Custom(
                error.to_string(),
            ))
        })
    }

    /// Fork: validate a data export and stage it for the next start.
    pub async fn stage_data_import(
        &self,
        archive: std::path::PathBuf,
    ) -> Result<vrcx_0_outbound_adapters::DataImportSummary> {
        self.ensure_host_read_allowed(&archive)?;
        let app_data = self.runtime.paths().app_data.clone();
        tokio::task::spawn_blocking(move || {
            vrcx_0_outbound_adapters::stage_data_import(&app_data, &archive)
        })
        .await
        .map_err(|error| {
            vrcx_0_composition::Error::from(vrcx_0_application_core::Error::Custom(format!(
                "import task failed: {error}"
            )))
        })?
        .map_err(|error| {
            vrcx_0_composition::Error::from(vrcx_0_application_core::Error::Custom(
                error.to_string(),
            ))
        })
    }

    /// Fork: drop a staged data import.
    pub fn discard_data_import(&self) -> Result<()> {
        vrcx_0_outbound_adapters::discard_data_import(&self.runtime.paths().app_data).map_err(
            |error| {
                vrcx_0_composition::Error::from(vrcx_0_application_core::Error::Custom(
                    error.to_string(),
                ))
            },
        )
    }

    /// Fork: import only settings from VRCX or upstream VRCX-0, replacing ours.
    pub async fn run_profile_settings_import(
        &self,
        kind: vrcx_0_outbound_adapters::ProfileMergeSourceKind,
    ) -> Result<vrcx_0_persistence::profile_merge::ProfileSettingsImportReport> {
        let database = Arc::clone(self.runtime.database());
        let storage = Arc::clone(self.runtime.storage());
        let app_data = self.runtime.paths().app_data.clone();
        tokio::task::spawn_blocking(move || {
            vrcx_0_outbound_adapters::run_profile_settings_import(
                &database, &storage, &app_data, kind,
            )
        })
        .await
        .map_err(|error| {
            vrcx_0_composition::Error::from(vrcx_0_application_core::Error::Custom(format!(
                "import task failed: {error}"
            )))
        })?
        .map_err(|error| {
            vrcx_0_composition::Error::from(vrcx_0_application_core::Error::Custom(
                error.to_string(),
            ))
        })
    }
}
