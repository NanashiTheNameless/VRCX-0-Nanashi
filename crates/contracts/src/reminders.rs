use serde::{Deserialize, Serialize};

/// Fork: what makes an assistant reminder fire (upstream #479).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ReminderTrigger {
    /// A friend comes online.
    #[serde(rename_all = "camelCase")]
    FriendOnline {
        user_id: String,
        display_name: String,
    },
    /// A friend goes offline.
    #[serde(rename_all = "camelCase")]
    FriendOffline {
        user_id: String,
        display_name: String,
    },
    /// A friend changes location; `world_id` narrows it to one world.
    #[serde(rename_all = "camelCase")]
    FriendLocation {
        user_id: String,
        display_name: String,
        #[serde(default)]
        world_id: String,
    },
    /// A player joins the instance you are in.
    #[serde(rename_all = "camelCase")]
    PlayerJoined {
        user_id: String,
        display_name: String,
    },
    /// A point in time (RFC 3339, UTC); optionally repeats.
    #[serde(rename_all = "camelCase")]
    Time {
        at: String,
        #[serde(default)]
        repeat_minutes: u32,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    pub id: String,
    pub owner_user_id: String,
    pub message: String,
    pub trigger: ReminderTrigger,
    /// Event reminders: keep firing (with a cooldown) instead of once.
    #[serde(default)]
    pub recurring: bool,
    pub created_at: String,
    #[serde(default)]
    pub last_fired_at: String,
    #[serde(default)]
    pub fire_count: u32,
}
