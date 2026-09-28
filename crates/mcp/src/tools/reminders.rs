//! Fork: assistant reminders (upstream #479). The tools only store reminders;
//! the desktop host watches live events and fires them through the normal
//! notification pipeline (desktop, VR, sound, TTS per the user's filters), so
//! the chat does not need to stay open.

use chrono::{DateTime, Utc};
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::{schemars, tool, tool_router};
use serde::{Deserialize, Serialize};

use crate::server::VrcxMcpServer;
use crate::{McpReminder, McpReminderTrigger, McpReminders};

use super::common::{
    map_application_query_error, require_current_user_id, resolve_target_or_result,
    structured_result, TargetResolutionOutcome,
};

const MAX_MESSAGE_CHARS: usize = 200;
const MIN_REPEAT_MINUTES: u32 = 5;
const MAX_REPEAT_MINUTES: u32 = 7 * 24 * 60;
const MAX_IN_MINUTES: u32 = 366 * 24 * 60;

#[tool_router(router = reminders_tool_router, vis = "pub(crate)")]
impl VrcxMcpServer {
    #[tool(
        description = "[write·local] Create a reminder that fires later as a normal VRCX-0-Nanashi notification (desktop, VR, sound per the user's notification settings), even with this chat closed. Triggers: friend_online, friend_offline, friend_location (optionally one worldId), player_joined (joins the user's current instance), or time (at = RFC 3339 time, or inMinutes). Event reminders fire once unless recurring=true; time reminders repeat when repeatMinutes is set. Confirm the wording with the user before creating."
    )]
    async fn create_reminder(
        &self,
        Parameters(input): Parameters<CreateReminderParams>,
    ) -> Result<CallToolResult, String> {
        let reminders = self.reminders()?;
        let owner_user_id = require_current_user_id(&self.runtime)?;
        let message = input.message.trim().to_string();
        if message.is_empty() {
            return Err("message is required".into());
        }
        if message.chars().count() > MAX_MESSAGE_CHARS {
            return Err(format!(
                "message is limited to {MAX_MESSAGE_CHARS} characters"
            ));
        }
        let trigger = match input.trigger {
            ReminderTriggerKind::Time => McpReminderTrigger::Time {
                at: reminder_time(input.at.as_deref(), input.in_minutes, Utc::now())?,
                repeat_minutes: repeat_minutes(input.repeat_minutes)?,
            },
            kind => {
                let Some(user) = input
                    .user
                    .as_deref()
                    .map(str::trim)
                    .filter(|v| !v.is_empty())
                else {
                    return Err("user is required for this trigger".into());
                };
                let user_id = match resolve_target_or_result(&self.runtime, user)? {
                    TargetResolutionOutcome::Resolved(target) => target.user_id,
                    TargetResolutionOutcome::ToolResult(result) => return Ok(result),
                };
                let display_name = self
                    .runtime
                    .friend_local_data
                    .friend_display_names(owner_user_id.clone(), std::slice::from_ref(&user_id))
                    .ok()
                    .and_then(|names| names.get(&user_id).cloned())
                    .filter(|name| !name.trim().is_empty())
                    .unwrap_or_else(|| user.to_string());
                match kind {
                    ReminderTriggerKind::FriendOnline => McpReminderTrigger::FriendOnline {
                        user_id,
                        display_name,
                    },
                    ReminderTriggerKind::FriendOffline => McpReminderTrigger::FriendOffline {
                        user_id,
                        display_name,
                    },
                    ReminderTriggerKind::FriendLocation => McpReminderTrigger::FriendLocation {
                        user_id,
                        display_name,
                        world_id: world_id(input.world_id.as_deref())?,
                    },
                    ReminderTriggerKind::PlayerJoined => McpReminderTrigger::PlayerJoined {
                        user_id,
                        display_name,
                    },
                    ReminderTriggerKind::Time => unreachable!(),
                }
            }
        };
        let reminder = reminders
            .create(&owner_user_id, message, trigger, input.recurring)
            .map_err(map_application_query_error)?;
        structured_result(ReminderOutput { reminder })
    }

    #[tool(
        description = "[L1·query] List the user's active reminders (id, message, trigger, recurring, last fired)."
    )]
    async fn list_reminders(
        &self,
        Parameters(_input): Parameters<ListRemindersParams>,
    ) -> Result<CallToolResult, String> {
        let reminders = self.reminders()?;
        let owner_user_id = require_current_user_id(&self.runtime)?;
        let reminders = reminders
            .list(&owner_user_id)
            .map_err(map_application_query_error)?;
        structured_result(ReminderListOutput { reminders })
    }

    #[tool(description = "[write·local] Delete one reminder by id (from list_reminders).")]
    async fn delete_reminder(
        &self,
        Parameters(input): Parameters<DeleteReminderParams>,
    ) -> Result<CallToolResult, String> {
        let reminders = self.reminders()?;
        let owner_user_id = require_current_user_id(&self.runtime)?;
        let deleted = reminders
            .delete(&owner_user_id, input.id.trim())
            .map_err(map_application_query_error)?;
        structured_result(DeleteReminderOutput { deleted })
    }
}

impl VrcxMcpServer {
    fn reminders(&self) -> Result<&McpReminders, String> {
        self.runtime
            .reminders
            .as_ref()
            .ok_or_else(|| "Reminders are not available in this host.".into())
    }
}

fn reminder_time(
    at: Option<&str>,
    in_minutes: Option<u32>,
    now: DateTime<Utc>,
) -> Result<String, String> {
    let when = match (at.map(str::trim).filter(|v| !v.is_empty()), in_minutes) {
        (Some(at), _) => DateTime::parse_from_rfc3339(at)
            .map_err(|_| "at must be an RFC 3339 time with an offset".to_string())?
            .with_timezone(&Utc),
        (None, Some(minutes)) if (1..=MAX_IN_MINUTES).contains(&minutes) => {
            now + chrono::Duration::minutes(i64::from(minutes))
        }
        (None, Some(_)) => return Err(format!("inMinutes must be 1-{MAX_IN_MINUTES}")),
        (None, None) => return Err("time reminders need at or inMinutes".into()),
    };
    if when <= now {
        return Err("reminder time is in the past".into());
    }
    Ok(when.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

fn repeat_minutes(value: Option<u32>) -> Result<u32, String> {
    match value.unwrap_or(0) {
        0 => Ok(0),
        minutes if (MIN_REPEAT_MINUTES..=MAX_REPEAT_MINUTES).contains(&minutes) => Ok(minutes),
        _ => Err(format!(
            "repeatMinutes must be 0 or {MIN_REPEAT_MINUTES}-{MAX_REPEAT_MINUTES}"
        )),
    }
}

fn world_id(value: Option<&str>) -> Result<String, String> {
    let value = value.map(str::trim).unwrap_or_default();
    if value.is_empty() || value.starts_with("wrld_") {
        Ok(value.to_string())
    } else {
        Err("worldId must be a wrld_ id".into())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
enum ReminderTriggerKind {
    FriendOnline,
    FriendOffline,
    FriendLocation,
    PlayerJoined,
    Time,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct CreateReminderParams {
    /// Text shown in the notification, e.g. "ask about the event".
    message: String,
    trigger: ReminderTriggerKind,
    /// Display name or usr_ id; required for every trigger except time.
    user: Option<String>,
    /// friend_location only: fire only for this wrld_ id.
    world_id: Option<String>,
    /// time only: RFC 3339 time with offset.
    at: Option<String>,
    /// time only: minutes from now (alternative to at).
    in_minutes: Option<u32>,
    /// time only: repeat every N minutes (0 = once).
    repeat_minutes: Option<u32>,
    /// Event triggers: keep the reminder after it fires.
    #[serde(default)]
    recurring: bool,
}

#[derive(Clone, Debug, Default, Deserialize, schemars::JsonSchema)]
struct ListRemindersParams {}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct DeleteReminderParams {
    id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReminderOutput {
    reminder: McpReminder,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReminderListOutput {
    reminders: Vec<McpReminder>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeleteReminderOutput {
    deleted: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-09-27T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn time_accepts_rfc3339_or_minutes_and_rejects_the_past() {
        assert_eq!(
            reminder_time(Some("2026-09-27T14:00:00+02:00"), None, now()).unwrap_err(),
            "reminder time is in the past"
        );
        assert_eq!(
            reminder_time(Some("2026-09-27T15:30:00+02:00"), None, now()).unwrap(),
            "2026-09-27T13:30:00Z"
        );
        assert_eq!(
            reminder_time(None, Some(30), now()).unwrap(),
            "2026-09-27T12:30:00Z"
        );
        assert!(reminder_time(None, None, now()).is_err());
        assert!(reminder_time(None, Some(0), now()).is_err());
        assert!(reminder_time(Some("tomorrow"), None, now()).is_err());
    }

    #[test]
    fn repeat_and_world_are_bounded() {
        assert_eq!(repeat_minutes(None), Ok(0));
        assert_eq!(repeat_minutes(Some(60)), Ok(60));
        assert!(repeat_minutes(Some(1)).is_err());
        assert!(repeat_minutes(Some(MAX_REPEAT_MINUTES + 1)).is_err());
        assert_eq!(world_id(None), Ok(String::new()));
        assert_eq!(world_id(Some(" wrld_1 ")), Ok("wrld_1".into()));
        assert!(world_id(Some("usr_1")).is_err());
    }
}
