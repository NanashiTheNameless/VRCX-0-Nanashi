use vrcx_0_composition::Result;

use super::DesktopRuntimeHostState;

impl DesktopRuntimeHostState {
    pub async fn check_for_app_update(
        &self,
    ) -> vrcx_0_application::profile::AppUpdateStatusSnapshot {
        let data_dir = &self.runtime.app_data_dir().current_dir;
        let (status, ()) = tokio::join!(
            self.desktop.app_update.check_now(),
            crate::global_badges::refresh(data_dir)
        );
        status
    }

    pub async fn installable_app_update_releases(
        &self,
    ) -> Result<Vec<vrcx_0_application::profile::AppUpdateReleaseSnapshot>> {
        Ok(self.desktop.app_update.installable_releases().await?)
    }

    pub async fn latest_app_update_release_for_channel(
        &self,
        channel: vrcx_0_application::profile::AppUpdateChannel,
    ) -> Result<Option<vrcx_0_application::profile::AppUpdateReleaseSnapshot>> {
        Ok(self
            .desktop
            .app_update
            .latest_release_for_channel(channel)
            .await?)
    }

    pub fn app_update_download_status(
        &self,
    ) -> vrcx_0_application::profile::AppUpdateDownloadStatusSnapshot {
        self.desktop.app_update.download_status()
    }

    pub(crate) fn app_update_hydration_snapshot(
        &self,
    ) -> vrcx_0_application::profile::AppUpdateStatusSnapshot {
        self.desktop.app_update.hydration_snapshot()
    }

    pub async fn install_app_update(
        &self,
        version: &str,
    ) -> Result<vrcx_0_application_core::UpdaterMetadata> {
        Ok(self.desktop.app_update.install(version).await?)
    }
}
