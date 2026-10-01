use chrono::{DateTime, Utc};

pub(crate) struct EventTime {
    pub(crate) iso: String,
    pub(crate) timestamp_ms: i64,
}

impl EventTime {
    pub(crate) fn now() -> Self {
        let now = Utc::now();
        Self {
            iso: now.to_rfc3339(),
            timestamp_ms: now.timestamp_millis(),
        }
    }

    pub(crate) fn from_received_at(received_at: &str) -> Self {
        let timestamp_ms = DateTime::parse_from_rfc3339(received_at)
            .map(|value| value.timestamp_millis())
            .unwrap_or_else(|_| Utc::now().timestamp_millis());
        Self {
            iso: received_at.to_string(),
            timestamp_ms,
        }
    }
}
