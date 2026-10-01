use vrcx_0_contracts::realtime::{RealtimePersistenceBatch, SelfProfileField, SelfProfileLogEntry};

use super::state::RealtimeCurrentUserStateSnapshot;
use crate::realtime::event_time::EventTime;

pub(super) fn append_self_profile_log_entries(
    previous: &RealtimeCurrentUserStateSnapshot,
    next: &RealtimeCurrentUserStateSnapshot,
    now: &EventTime,
    persistence: &mut RealtimePersistenceBatch,
) {
    if previous.user_id.is_empty() {
        return;
    }
    for (field, previous_value, value) in [
        (
            SelfProfileField::Status,
            previous.status.as_str(),
            next.status.as_str(),
        ),
        (
            SelfProfileField::StatusDescription,
            previous.status_description.as_str(),
            next.status_description.as_str(),
        ),
        (
            SelfProfileField::Bio,
            previous.bio.as_str(),
            next.bio.as_str(),
        ),
    ] {
        if value == previous_value {
            continue;
        }
        persistence
            .self_profile_log_entries
            .push(SelfProfileLogEntry {
                created_at: now.iso.clone(),
                field,
                value: value.to_string(),
                previous_value: previous_value.to_string(),
            });
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Map, Value};

    use super::*;

    fn snapshot(
        user_id: &str,
        status: &str,
        description: &str,
        bio: &str,
    ) -> RealtimeCurrentUserStateSnapshot {
        let mut raw = Map::new();
        raw.insert("id".into(), Value::String(user_id.into()));
        raw.insert("status".into(), json!(status));
        raw.insert("statusDescription".into(), json!(description));
        raw.insert("bio".into(), json!(bio));
        RealtimeCurrentUserStateSnapshot::from_map(raw, user_id)
    }

    fn event_time() -> EventTime {
        EventTime {
            iso: "2025-01-05T00:00:00Z".into(),
            timestamp_ms: 0,
        }
    }

    #[test]
    fn skips_the_baseline_snapshot() {
        let mut persistence = RealtimePersistenceBatch::default();

        append_self_profile_log_entries(
            &RealtimeCurrentUserStateSnapshot::default(),
            &snapshot("usr_a", "join me", "come vibe", "hello"),
            &event_time(),
            &mut persistence,
        );

        assert!(persistence.self_profile_log_entries.is_empty());
    }

    #[test]
    fn records_only_the_fields_that_changed() {
        let mut persistence = RealtimePersistenceBatch::default();

        append_self_profile_log_entries(
            &snapshot("usr_a", "join me", "come vibe", "hello"),
            &snapshot("usr_a", "ask me", "come vibe", "hello"),
            &event_time(),
            &mut persistence,
        );

        assert_eq!(persistence.self_profile_log_entries.len(), 1);
        let entry = &persistence.self_profile_log_entries[0];
        assert_eq!(entry.field, SelfProfileField::Status);
        assert_eq!(entry.previous_value, "join me");
        assert_eq!(entry.value, "ask me");
    }

    #[test]
    fn records_each_changed_field_separately() {
        let mut persistence = RealtimePersistenceBatch::default();

        append_self_profile_log_entries(
            &snapshot("usr_a", "join me", "come vibe", "hello"),
            &snapshot("usr_a", "busy", "afk", "hello"),
            &event_time(),
            &mut persistence,
        );

        assert_eq!(persistence.self_profile_log_entries.len(), 2);
    }

    #[test]
    fn records_nothing_when_the_snapshot_is_unchanged() {
        let mut persistence = RealtimePersistenceBatch::default();

        append_self_profile_log_entries(
            &snapshot("usr_a", "join me", "come vibe", "hello"),
            &snapshot("usr_a", "join me", "come vibe", "hello"),
            &event_time(),
            &mut persistence,
        );

        assert!(persistence.self_profile_log_entries.is_empty());
    }
}
