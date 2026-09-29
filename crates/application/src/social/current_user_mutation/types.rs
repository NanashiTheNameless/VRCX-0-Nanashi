use serde::Deserialize;
use vrcx_0_contracts::vrchat_requests::{
    CurrentUserProfileUpdateRequest, CurrentUserUpdateRequest,
};

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatCurrentUserProfileUpdateInput {
    pub params: CurrentUserProfileUpdateRequest,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatCurrentUserUpdateInput {
    pub params: CurrentUserUpdateRequest,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatCurrentUserBadgeInput {
    #[serde(default)]
    pub badge_id: String,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub showcased: bool,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatCurrentUserTagsInput {
    #[serde(default)]
    pub tags: Vec<String>,
}
