use vrcx_0_application_game::PresenceAutomationRuleKind;
use vrcx_0_composition::Result;
use vrcx_0_core::json::RawJson;
use vrcx_0_host_desktop::auto_launch::{
    normalize_app_launcher_entries, AppLauncherEntry, AppLauncherFolderSource, AppLauncherSnapshot,
    APP_LAUNCHER_APP_FOLDER_ENABLED_CONFIG_KEY, APP_LAUNCHER_ENABLED_CONFIG_KEY,
    APP_LAUNCHER_ENTRIES_CONFIG_KEY, APP_LAUNCHER_VRCX_FOLDER_ENABLED_CONFIG_KEY,
};

use super::DesktopRuntimeHostState;

impl DesktopRuntimeHostState {
    pub fn presence_automation_rules(
        &self,
        kind: PresenceAutomationRuleKind,
    ) -> Result<Vec<RawJson>> {
        let config = self.runtime.desktop_assembly().config_store();
        Ok(vrcx_0_application_game::presence_automation_rules_get(
            config.as_ref(),
            kind,
        )?)
    }

    pub fn set_presence_automation_rules(
        &self,
        kind: PresenceAutomationRuleKind,
        rules: Vec<RawJson>,
    ) -> Result<Vec<RawJson>> {
        let config = self.runtime.desktop_assembly().config_store();
        Ok(vrcx_0_application_game::presence_automation_rules_set(
            config.as_ref(),
            kind,
            rules,
        )?)
    }

    pub fn set_presence_automation_rule_enabled(
        &self,
        kind: PresenceAutomationRuleKind,
        rule_id: &str,
        enabled: bool,
    ) -> Result<Vec<RawJson>> {
        let config = self.runtime.desktop_assembly().config_store();
        Ok(
            vrcx_0_application_game::presence_automation_rule_enabled_set(
                config.as_ref(),
                kind,
                rule_id,
                enabled,
            )?,
        )
    }

    pub fn app_launcher_snapshot(&self) -> AppLauncherSnapshot {
        self.game.auto_launch.snapshot()
    }

    pub fn set_app_launcher_enabled(&self, enabled: bool) -> Result<AppLauncherSnapshot> {
        self.runtime
            .desktop_assembly()
            .config_store()
            .set_bool(APP_LAUNCHER_ENABLED_CONFIG_KEY, enabled)?;
        Ok(self.game.auto_launch.set_enabled(enabled))
    }

    pub fn set_app_launcher_entries(
        &self,
        entries: Vec<AppLauncherEntry>,
    ) -> Result<AppLauncherSnapshot> {
        let entries = normalize_app_launcher_entries(entries);
        self.runtime.desktop_assembly().config_store().set_json(
            APP_LAUNCHER_ENTRIES_CONFIG_KEY,
            &serde_json::to_value(&entries)?,
        )?;
        Ok(self.game.auto_launch.set_entries(entries))
    }

    pub fn set_app_launcher_entry_enabled(
        &self,
        entry_id: &str,
        enabled: bool,
    ) -> Result<AppLauncherSnapshot> {
        let config = self.runtime.desktop_assembly().config_store();
        Ok(self
            .game
            .auto_launch
            .set_entry_enabled(entry_id, enabled, |entries| {
                config.set_json(
                    APP_LAUNCHER_ENTRIES_CONFIG_KEY,
                    &serde_json::to_value(entries)?,
                )
            })?)
    }

    pub fn set_app_launcher_folder_enabled(
        &self,
        source: AppLauncherFolderSource,
        enabled: bool,
    ) -> Result<AppLauncherSnapshot> {
        let key = match source {
            AppLauncherFolderSource::App => APP_LAUNCHER_APP_FOLDER_ENABLED_CONFIG_KEY,
            AppLauncherFolderSource::Vrcx => APP_LAUNCHER_VRCX_FOLDER_ENABLED_CONFIG_KEY,
        };
        self.runtime
            .desktop_assembly()
            .config_store()
            .set_bool(key, enabled)?;
        Ok(self.game.auto_launch.set_folder_enabled(source, enabled))
    }

    /// Creates this app's own startup folder on demand. VRCX's folder is only
    /// returned when VRCX already created it.
    pub fn app_launcher_folder_for_open(
        &self,
        source: AppLauncherFolderSource,
    ) -> Result<Option<std::path::PathBuf>> {
        let Some(path) = self.game.auto_launch.folder_path(source) else {
            return Ok(None);
        };
        if source == AppLauncherFolderSource::App {
            for dir in [path.clone(), path.join("desktop"), path.join("vr")] {
                std::fs::create_dir_all(&dir).map_err(|error| {
                    vrcx_0_composition::Error::from(vrcx_0_application_core::Error::Custom(
                        format!("create {}: {error}", dir.display()),
                    ))
                })?;
            }
        }
        Ok(path.is_dir().then_some(path))
    }

    pub fn test_app_launcher_entry(&self, entry_id: &str) -> Result<AppLauncherSnapshot> {
        self.game
            .auto_launch
            .test_entry(entry_id)
            .map_err(|error| vrcx_0_application_core::Error::Custom(error).into())
    }

    pub fn stop_app_launcher_test_run(&self, run_id: &str) -> Result<AppLauncherSnapshot> {
        self.game
            .auto_launch
            .stop_test_run(run_id)
            .map_err(|error| vrcx_0_application_core::Error::Custom(error).into())
    }
}
