use serde::{Deserialize, Serialize};

pub use vrcx_0_contracts::{CommunityThemeAuthor, CommunityThemeCatalog, CommunityThemeManifest};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CommunityThemeInstallMetadata {
    pub theme_id: String,
    pub theme_name: String,
    pub version: String,
    pub source_url: String,
    pub sha256: String,
    pub installed_at: String,
    pub updated_at: String,
    pub dark_mode: bool,
    pub accent_mode: bool,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CommunityThemeProjection {
    pub revision: u64,
    pub catalog_url: String,
    pub enabled: bool,
    pub installed_theme: Option<CommunityThemeInstallMetadata>,
    pub installed_themes: Vec<CommunityThemeInstallMetadata>,
    pub installed_css_snapshot: String,
    pub override_css: String,
    pub override_css_enabled: bool,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CommunityThemeConfigureInput {
    #[serde(rename_all = "camelCase")]
    Install {
        theme_id: String,
    },
    #[serde(rename_all = "camelCase")]
    Enable {
        theme_id: Option<String>,
    },
    Disable,
    #[serde(rename_all = "camelCase")]
    Delete {
        theme_id: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    SetOverride {
        css_text: String,
    },
    DisableOverride,
}
