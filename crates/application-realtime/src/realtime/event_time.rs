use chrono::Utc;
use vrcx_0_core::time::epoch_from_millis;

pub(crate) struct EventTime {
    /// Epoch seconds, the form every stored date takes.
    pub(crate) at: i64,
    pub(crate) timestamp_ms: i64,
}

impl EventTime {
    pub(crate) fn now() -> Self {
        let timestamp_ms = Utc::now().timestamp_millis();
        Self {
            at: epoch_from_millis(timestamp_ms),
            timestamp_ms,
        }
    }

    /// An event stamped on arrival in epoch seconds; 0 means now.
    pub(crate) fn from_received_at(received_at: i64) -> Self {
        if received_at == 0 {
            return Self::now();
        }
        Self {
            at: received_at,
            timestamp_ms: received_at * 1000,
        }
    }
}
