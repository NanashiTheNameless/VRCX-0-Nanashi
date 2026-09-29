//! Fork: turn a plain-language request ("remind me when Alice comes online")
//! into a reminder form draft the user reviews before anything is saved.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::AssistantError;

/// Trigger kinds a draft may name; match `ReminderTrigger`'s `kind` tags.
pub const REMINDER_DRAFT_KINDS: &[&str] = &[
    "friendOnline",
    "friendOffline",
    "friendLocation",
    "playerJoined",
    "time",
];

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct ReminderDraft {
    pub message: String,
    pub kind: String,
    /// Display name as the user wrote it; the app matches it to a friend.
    pub friend_name: String,
    pub world_id: String,
    /// Local wall-clock time, `YYYY-MM-DDTHH:MM`, for `time` reminders.
    pub at_local: String,
    pub repeat_minutes: u32,
    pub recurring: bool,
}

pub(crate) fn reminder_draft_system_prompt(now_local: &str) -> String {
    format!(
        "\
You turn a request for a reminder into JSON for a form. Reply with one JSON object and \
nothing else, with these fields:
- message: short text the reminder shows (e.g. \"Alice is online\"), in the user's words and language.
- kind: one of friendOnline, friendOffline, friendLocation, playerJoined, time.
  friendOnline = a friend comes online; friendOffline = goes offline; friendLocation = a \
friend changes location or goes to a world; playerJoined = someone joins the user's current \
instance; time = at a clock time or after a delay.
- friendName: the person's name exactly as written, or \"\" for time reminders.
- worldId: a wrld_... id only if the user gave one, else \"\".
- atLocal: for time reminders, local time as YYYY-MM-DDTHH:MM, else \"\". The user's local \
time now is {now_local}; resolve \"in 20 minutes\", \"tonight at 9\", \"tomorrow\" from it.
- repeatMinutes: minutes between repeats for time reminders, 0 for once.
- recurring: true only if the user wants an event reminder to keep firing (\"every time\")."
    )
}

/// Parse the model's reply, tolerating code fences or text around the JSON.
pub(crate) fn parse_reminder_draft(reply: &str) -> Result<ReminderDraft, AssistantError> {
    let unreadable =
        || AssistantError::Custom("The AI reply could not be read as a reminder.".into());
    let start = reply.find('{').ok_or_else(unreadable)?;
    let end = reply.rfind('}').ok_or_else(unreadable)?;
    if end < start {
        return Err(unreadable());
    }
    let mut draft: ReminderDraft =
        serde_json::from_str(&reply[start..=end]).map_err(|_| unreadable())?;
    draft.message = draft.message.trim().to_string();
    draft.friend_name = draft.friend_name.trim().to_string();
    draft.world_id = draft.world_id.trim().to_string();
    draft.at_local = draft.at_local.trim().to_string();
    if !REMINDER_DRAFT_KINDS.contains(&draft.kind.as_str()) {
        return Err(AssistantError::Custom(
            "The AI could not tell what should trigger this reminder.".into(),
        ));
    }
    Ok(draft)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_fenced_reply() {
        let draft = parse_reminder_draft(
            "```json\n{\"message\":\"Alice is on\",\"kind\":\"friendOnline\",\"friendName\":\" Alice \"}\n```",
        )
        .unwrap();
        assert_eq!(draft.kind, "friendOnline");
        assert_eq!(draft.friend_name, "Alice");
        assert_eq!(draft.repeat_minutes, 0);
    }

    #[test]
    fn rejects_unknown_kinds_and_non_json() {
        assert!(parse_reminder_draft("{\"kind\":\"weather\"}").is_err());
        assert!(parse_reminder_draft("sorry, I can't").is_err());
    }

    #[test]
    fn prompt_carries_the_local_time() {
        assert!(
            reminder_draft_system_prompt("2026-09-29T21:05 (Tuesday, -05:00)")
                .contains("2026-09-29T21:05")
        );
    }
}
