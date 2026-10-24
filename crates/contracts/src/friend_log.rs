use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogHistoryEntryInput {
    #[serde(default)]
    pub row_id: Value,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub r#type: String,
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub previous_display_name: String,
    #[serde(default)]
    pub trust_level: String,
    #[serde(default)]
    pub previous_trust_level: String,
    #[serde(default)]
    pub friend_number: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogCurrentEntryInput {
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub trust_level: Option<String>,
    #[serde(default)]
    pub friend_number: Value,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogReplaceOptionsInput {
    #[serde(default)]
    pub history_entries: Vec<FriendLogHistoryEntryInput>,
    #[serde(default)]
    pub added_history_entries: Vec<FriendLogHistoryEntryInput>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogDeleteOptionsInput {
    #[serde(default)]
    pub history_entries: Vec<FriendLogHistoryEntryInput>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogUpsertOptionsInput {
    #[serde(default)]
    pub history_entry: Option<FriendLogHistoryEntryInput>,
    #[serde(default)]
    pub force_history: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogMutationResult {
    pub user_id: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub target_user_id: String,
    pub count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inserted: Option<bool>,
    pub history_count: i64,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogCurrentOutput {
    pub user_id: String,
    pub display_name: String,
    pub trust_level: String,
    pub friend_number: i64,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogHistoryCursor {
    pub created_at: i64,
    pub row_id: i64,
}

#[derive(Clone, Debug, Default, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogHistoryQueryInput {
    pub user_id: String,
    #[serde(default)]
    pub target_user_id: String,
    #[serde(default)]
    pub types: Vec<String>,
    #[serde(default)]
    pub excluded_types: Vec<String>,
    #[serde(default)]
    pub date_from: Option<i64>,
    #[serde(default)]
    pub date_to: Option<i64>,
    pub cursor: Option<FriendLogHistoryCursor>,
    pub limit: Option<u32>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogHistoryOutput {
    pub row_id: i64,
    pub created_at: i64,
    pub r#type: String,
    pub user_id: String,
    pub display_name: String,
    pub previous_display_name: String,
    pub trust_level: String,
    pub previous_trust_level: String,
    pub friend_number: i64,
}
