use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CommunityThemeAuthor {
    pub name: String,
    pub github: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CommunityThemeManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: CommunityThemeAuthor,
    pub description: String,
    pub tags: Vec<String>,
    pub tested_with: String,
    pub remote_assets: bool,
    pub dark_mode: bool,
    pub accent_mode: bool,
    pub preview_url: String,
    pub readme_url: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CommunityThemeCatalog {
    pub source_url: String,
    pub schema_version: u32,
    pub themes: Vec<CommunityThemeManifest>,
}
