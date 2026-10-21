use serde::Deserialize;
use vrcx_0_application::remote::InstanceCreateRequest;

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatInstanceIdentityInput {
    #[serde(default)]
    pub(crate) world_id: String,
    #[serde(default)]
    pub(crate) instance_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatInstanceShortNameInput {
    #[serde(default)]
    pub(crate) world_id: String,
    #[serde(default)]
    pub(crate) instance_id: String,
    #[serde(default)]
    pub(crate) short_name: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatInstanceCreateInput {
    pub(crate) params: InstanceCreateRequest,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatInstanceSelfInviteInput {
    #[serde(default)]
    pub(crate) world_id: String,
    #[serde(default)]
    pub(crate) instance_id: String,
    #[serde(default)]
    pub(crate) short_name: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatInstanceDisplayNameInput {
    pub(crate) location: String,
    pub(crate) display_name: Option<String>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatInstanceCalendarLinkInput {
    pub(crate) location: String,
    pub(crate) calendar_entry_id: Option<String>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatInstanceCloseInput {
    #[serde(default)]
    pub(crate) location: String,
    #[serde(default)]
    pub(crate) hard_close: bool,
}
