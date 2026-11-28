use crate::desktop_widget::is_desktop_widget_config_key;
use vrcx_0_composition::Result;

use super::DesktopRuntimeHostState;

impl DesktopRuntimeHostState {
    pub fn proxy_url(&self) -> Option<&str> {
        self.runtime.web_client().proxy_url()
    }

    pub fn try_config_bool(&self, key: &str, fallback: bool) -> Option<bool> {
        self.runtime
            .desktop_assembly()
            .config_store()
            .get_bool(key, fallback)
            .ok()
    }

    pub fn config_string(&self, key: &str, fallback: &str) -> String {
        self.runtime
            .desktop_assembly()
            .config_store()
            .get_string(key, fallback)
            .unwrap_or_else(|_| fallback.to_string())
    }

    pub fn storage_get(&self, key: &str) -> Option<String> {
        self.runtime.storage().get(key)
    }

    pub fn storage_set(&self, key: String, value: String) {
        self.runtime.storage().set(key, value);
    }

    pub fn storage_flush(&self) -> Result<()> {
        Ok(self.runtime.storage().save()?)
    }

    pub fn storage_remove(&self, key: &str) -> Option<String> {
        self.runtime.storage().remove(key)
    }

    pub fn storage_snapshot(&self) -> std::collections::HashMap<String, String> {
        self.runtime.storage().get_all()
    }

    pub fn config_bool(&self, key: &str, fallback: bool) -> bool {
        self.runtime
            .desktop_assembly()
            .config_store()
            .get_bool(key, fallback)
            .unwrap_or(fallback)
    }

    pub fn set_config_bool(&self, key: &str, value: bool) -> Result<()> {
        Ok(self
            .runtime
            .desktop_assembly()
            .config_store()
            .set_bool(key, value)?)
    }

    pub fn remote_sync_secret_get(&self, key: &str) -> Result<Option<String>> {
        let stored = self
            .runtime
            .desktop_assembly()
            .config_store()
            .get_string(key, "")?;
        if stored.is_empty() {
            return Ok(None);
        }
        let credentials = self.runtime.desktop_assembly().auth_credentials();
        Ok(credentials.open_secret(&stored))
    }

    pub fn remote_sync_secret_exists(&self, key: &str) -> Result<bool> {
        Ok(!self
            .runtime
            .desktop_assembly()
            .config_store()
            .get_string(key, "")?
            .is_empty())
    }

    pub fn remote_sync_secret_set(&self, key: &str, plaintext: &str) -> Result<()> {
        let credentials = self.runtime.desktop_assembly().auth_credentials();
        if !credentials.is_encrypting_writes() {
            return Err(crate::Error::from(vrcx_0_application_core::Error::Custom(
                "RemoteSync secrets cannot be saved because protected credential storage is unavailable.".into(),
            )));
        }
        let previous = self
            .runtime
            .desktop_assembly()
            .config_store()
            .get_string(key, "")?;
        let sealed = credentials.seal_secret(
            (!previous.is_empty()).then_some(previous.as_str()),
            plaintext,
        );
        if !sealed.encrypted {
            return Err(crate::Error::from(vrcx_0_application_core::Error::Custom(
                "RemoteSync secrets cannot be saved without encryption.".into(),
            )));
        }
        self.runtime
            .desktop_assembly()
            .config_store()
            .set_string(key, &sealed.stored)?;
        Ok(())
    }

    pub fn remote_sync_secret_remove(&self, key: &str) -> Result<()> {
        self.runtime.desktop_assembly().config_store().remove(key)?;
        Ok(())
    }

    pub fn config_set_values(
        &self,
        entries: Vec<vrcx_0_contracts::ConfigWriteEntry>,
    ) -> Result<()> {
        let touches_desktop_widget = entries
            .iter()
            .any(|entry| is_desktop_widget_config_key(&entry.key));
        for entry in &entries {
            if entry.key.to_ascii_lowercase().ends_with("dttimezone")
                && vrcx_0_core::time::parse_display_zone_setting(&entry.value).is_none()
            {
                return Err(vrcx_0_composition::Error::from(
                    vrcx_0_application_core::Error::Custom(
                        "Enter an IANA timezone or a UTC offset.".into(),
                    ),
                ));
            }
        }
        self.local_data.config_set_values(entries)?;
        vrcx_0_core::time::set_display_zone(
            &self
                .runtime
                .desktop_assembly()
                .config_store()
                .get_string("dtTimeZone", "")?,
        );
        self.desktop.services.reload_overlay_activity_filters();
        self.desktop.vr_overlay_runtime.mark_config_dirty();
        if touches_desktop_widget {
            self.desktop.desktop_widget.reload_settings();
        }
        Ok(())
    }

    pub fn config_remove_value(&self, key: String) -> Result<i64> {
        let touches_desktop_widget = is_desktop_widget_config_key(&key);
        let removed = self.local_data.config_remove_value(key)?;
        vrcx_0_core::time::set_display_zone(
            &self
                .runtime
                .desktop_assembly()
                .config_store()
                .get_string("dtTimeZone", "")?,
        );
        self.desktop.services.reload_overlay_activity_filters();
        self.desktop.vr_overlay_runtime.mark_config_dirty();
        if touches_desktop_widget {
            self.desktop.desktop_widget.reload_settings();
        }
        Ok(removed)
    }
}
