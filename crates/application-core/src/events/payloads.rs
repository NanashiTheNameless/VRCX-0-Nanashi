use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FriendProfileBulkLoadStatus {
    #[default]
    Idle,
    Running,
    Cancelling,
    Completed,
    Cancelled,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendProfileLoadStatusPayload {
    pub run_id: u64,
    pub status: FriendProfileBulkLoadStatus,
    pub total: u32,
    pub processed: u32,
    pub loaded: u32,
    pub failed: u32,
    #[serde(default, deserialize_with = "vrcx_0_contracts::epoch::de")]
    pub started_at: i64,
    pub finished_at: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeEconomyBalancePayload {
    pub user_id: String,
    pub wallet_balance: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PrintAutoCleanupEvent {
    pub deleted: u32,
    pub remaining: u32,
    pub warning: Option<String>,
}
