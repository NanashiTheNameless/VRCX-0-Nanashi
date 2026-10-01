use serde_json::{Map, Value};

use super::state::RealtimeCurrentUserStateSnapshot;

pub(super) fn map_from_json(value: Value) -> Map<String, Value> {
    value.as_object().cloned().unwrap_or_default()
}

pub(super) fn first_positive(values: impl IntoIterator<Item = i64>) -> i64 {
    values.into_iter().find(|value| *value > 0).unwrap_or(0)
}

pub(super) fn has_remote_current_user_presence(
    snapshot: &RealtimeCurrentUserStateSnapshot,
) -> bool {
    let location = snapshot.location.trim().to_ascii_lowercase();
    !location.is_empty()
        && !location.starts_with("local")
        && !matches!(location.as_str(), ":" | "offline" | "offline:offline")
}
