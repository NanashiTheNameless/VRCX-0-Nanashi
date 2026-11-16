use std::collections::HashMap;

use serde::Deserialize;

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExternalApiAvatarSearchInput {
    #[serde(default)]
    pub(crate) url: String,
    #[serde(default)]
    pub(crate) vrcx_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExternalApiYoutubeVideoInput {
    #[serde(default)]
    pub(crate) video_id: String,
    #[serde(default)]
    pub(crate) api_key: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExternalApiCodeSearchInput {
    pub(crate) provider: vrcx_0_runtime_host_desktop::CodeSearchProvider,
    #[serde(default)]
    pub(crate) query: String,
    #[serde(default)]
    pub(crate) api_key: String,
    #[serde(default)]
    pub(crate) search_engine_id: String,
    #[serde(default)]
    pub(crate) endpoint: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExternalApiUrlInput {
    #[serde(default)]
    pub(crate) url: String,
    #[serde(default)]
    pub(crate) headers: HashMap<String, String>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExternalApiImageInput {
    #[serde(default)]
    pub(crate) url: String,
}
