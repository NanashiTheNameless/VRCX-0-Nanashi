use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Clone, Debug, Default, Serialize, Deserialize, Type)]
#[serde(default, rename_all = "camelCase")]
pub struct YtdlpSettings {
    pub enabled: bool,
    pub tools_path: String,
    pub browser: String,
    pub profile: String,
    pub use_cookies: bool,
}
impl YtdlpSettings {
    pub fn validate(&self) -> Result<(), String> {
        if ![
            "", "firefox", "chrome", "edge", "brave", "chromium", "vivaldi", "opera", "safari",
        ]
        .contains(&self.browser.as_str())
        {
            return Err("Unsupported cookie browser".into());
        }
        if self.profile.len() > 1024
            || self.profile.chars().any(|c| c.is_control())
            || self.profile.contains("::")
        {
            return Err("Invalid browser profile".into());
        }
        if self.tools_path.len() > 4096 || self.tools_path.chars().any(|c| c.is_control()) {
            return Err("Invalid VRChat Tools folder".into());
        }
        Ok(())
    }
    pub fn browser_spec(&self) -> String {
        if self.profile.is_empty() {
            self.browser.clone()
        } else {
            format!("{}:{}", self.browser, self.profile)
        }
    }
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct Manifest {
    pub version: String,
    pub checked_at: String,
    pub cookies_refreshed_at: String,
    pub cookie_count: usize,
    pub cookie_expiry: i64,
    pub cookie_validated_at: String,
    pub cookie_validation: String,
    pub node_dir: String,
    pub game_node_dir: String,
}
#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct YtdlpStatus {
    pub settings: YtdlpSettings,
    pub supported: bool,
    pub installed: bool,
    pub version: String,
    pub checked_at: String,
    pub cookies_refreshed_at: String,
    pub cookie_count: u32,
    pub cookie_expiry: f64,
    pub cookie_validated_at: String,
    pub cookie_validation: String,
    pub provider_running: bool,
    pub busy: bool,
    pub message: String,
    pub tools_path: String,
}
