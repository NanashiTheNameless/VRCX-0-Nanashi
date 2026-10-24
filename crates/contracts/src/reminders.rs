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
    /// A point in time (epoch seconds); optionally repeats.
    #[serde(rename_all = "camelCase")]
    Time {
        #[serde(deserialize_with = "crate::epoch::de")]
        at: i64,
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
    #[serde(deserialize_with = "crate::epoch::de")]
    pub created_at: i64,
    #[serde(default, deserialize_with = "crate::epoch::de_opt")]
    pub last_fired_at: Option<i64>,
    #[serde(default)]
    pub fire_count: u32,
}
