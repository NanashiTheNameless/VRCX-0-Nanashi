use chrono::{DateTime, Utc};
use serde_json::{Map, Value};
use vrcx_0_core::friends::StateBucket;
use vrcx_0_core::json::JsonExt;

use super::state::RealtimeCurrentUserStateSnapshot;

pub(super) fn resolve_state_bucket(
    content: &Value,
    patch: &Map<String, Value>,
    previous: Option<&Map<String, Value>>,
) -> Option<String> {
    for value in [
        content.text_field("state"),
        content.text_field("stateBucket"),
        patch.text_field("stateBucket"),
        previous
            .map(|previous| previous.text_field("stateBucket"))
            .unwrap_or_default(),
        previous
            .map(|previous| previous.text_field("state"))
            .unwrap_or_default(),
    ] {
        if let Some(bucket) = StateBucket::normalize(&value) {
            return Some(bucket.as_str().into());
        }
    }
    None
}

pub(super) fn map_from_json(value: Value) -> Map<String, Value> {
    value.as_object().cloned().unwrap_or_default()
}

pub(super) fn normalize_id(value: &str) -> String {
    value.trim().to_string()
}

pub(super) fn first_positive(values: impl IntoIterator<Item = i64>) -> i64 {
    values.into_iter().find(|value| *value > 0).unwrap_or(0)
}

pub(super) fn is_offline_location(location: &str) -> bool {
    matches!(
        location.trim().to_ascii_lowercase().as_str(),
        "offline" | "offline:offline"
    )
}

pub(super) fn has_remote_current_user_presence(
    snapshot: &RealtimeCurrentUserStateSnapshot,
) -> bool {
    let location = snapshot.location.trim().to_ascii_lowercase();
    !location.is_empty()
        && !location.starts_with("local")
        && !matches!(location.as_str(), ":" | "offline" | "offline:offline")
}

pub(super) struct EventTime {
    pub(super) iso: String,
    pub(super) timestamp_ms: i64,
}

impl EventTime {
    pub(super) fn now() -> Self {
        let now = Utc::now();
        Self {
            iso: now.to_rfc3339(),
            timestamp_ms: now.timestamp_millis(),
        }
    }

    pub(super) fn from_received_at(received_at: &str) -> Self {
        let timestamp_ms = DateTime::parse_from_rfc3339(received_at)
            .map(|value| value.timestamp_millis())
            .unwrap_or_else(|_| Utc::now().timestamp_millis());
        Self {
            iso: received_at.to_string(),
            timestamp_ms,
        }
    }
}
