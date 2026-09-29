use crate::text::first_non_empty;
use crate::trust::trust_level_changed;

#[derive(Clone, Copy, Debug)]
pub struct FriendLogUpsertInput<'a> {
    pub target_user_id: &'a str,
    pub display_name: &'a str,
    pub trust_level: &'a str,
    pub friend_number: i64,
    pub force_history: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct FriendLogCurrent<'a> {
    pub display_name: &'a str,
    pub trust_level: &'a str,
    pub friend_number: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FriendLogHistoryPlan {
    pub entry_type: &'static str,
    pub previous_display_name: String,
    pub previous_trust_level: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FriendLogUpsertPlan {
    pub user_id: String,
    pub display_name: String,
    pub trust_level: String,
    pub friend_number: i64,
    pub history: Vec<FriendLogHistoryPlan>,
}

pub fn plan_friend_log_upsert<E>(
    entry: FriendLogUpsertInput<'_>,
    existing: Option<FriendLogCurrent<'_>>,
    next_friend_number: impl FnOnce() -> Result<i64, E>,
) -> Result<Option<FriendLogUpsertPlan>, E> {
    let user_id = entry.target_user_id.trim();
    if user_id.is_empty() {
        return Ok(None);
    }
    let friend_number = match existing {
        _ if entry.friend_number > 0 => entry.friend_number,
        Some(existing) => existing.friend_number,
        None => next_friend_number()?,
    };
    let existing_display_name = existing.map_or("", |existing| existing.display_name.trim());
    let entry_display_name = entry.display_name.trim();
    let display_name = if !entry_display_name.is_empty() && entry_display_name != "Unknown" {
        entry_display_name
    } else if !existing_display_name.is_empty() && existing_display_name != "Unknown" {
        existing_display_name
    } else {
        "Unknown"
    };
    let existing_trust_level = existing.map_or("", |existing| existing.trust_level.trim());
    let trust_level = first_non_empty([entry.trust_level, existing_trust_level, "Visitor"]);
    let history_row = |entry_type, previous_display_name: &str, previous_trust_level: &str| {
        FriendLogHistoryPlan {
            entry_type,
            previous_display_name: previous_display_name.to_string(),
            previous_trust_level: previous_trust_level.to_string(),
        }
    };
    let mut history = Vec::new();
    if existing.is_some() {
        let renamed = !existing_display_name.is_empty()
            && existing_display_name != "Unknown"
            && display_name != "Unknown"
            && display_name != existing_display_name;
        if renamed {
            history.push(history_row("DisplayName", existing_display_name, ""));
        }
        if trust_level_changed(existing_trust_level, trust_level) {
            history.push(history_row("TrustLevel", "", existing_trust_level));
        }
        if entry.force_history {
            history.push(history_row("Friend", "", ""));
        }
    } else {
        history.push(history_row("Friend", "", ""));
    }
    Ok(Some(FriendLogUpsertPlan {
        user_id: user_id.to_string(),
        display_name: display_name.to_string(),
        trust_level: trust_level.to_string(),
        friend_number,
        history,
    }))
}

#[cfg(test)]
mod tests;
