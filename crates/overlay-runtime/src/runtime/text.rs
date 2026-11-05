use std::time::{SystemTime, UNIX_EPOCH};

use chrono::Timelike;

use crate::surfaces::wrist::{clock_text, compact_duration};

pub(super) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

pub(super) fn local_time_text(hour12: bool) -> String {
    let now = vrcx_0_core::time::display_now();
    clock_text(now.hour(), now.minute(), hour12)
}

pub(super) fn instance_duration_text(location: &str, started_at: i64, now_ms: i64) -> String {
    if !is_world_instance_location(location) {
        return String::new();
    }
    elapsed_minutes_text(started_at, now_ms)
}

pub(super) fn elapsed_minutes_text(started_at: i64, now_ms: i64) -> String {
    if started_at <= 0 {
        return String::new();
    }
    let started_at_ms = started_at.saturating_mul(1000);
    if now_ms < started_at_ms {
        return String::new();
    }
    let minute_start_ms = now_ms - now_ms.rem_euclid(60_000);
    compact_duration((minute_start_ms - started_at_ms).max(0))
}

fn is_world_instance_location(location: &str) -> bool {
    let location = location.trim().to_ascii_lowercase();
    location.starts_with("wrld_") && location.contains(':')
}
