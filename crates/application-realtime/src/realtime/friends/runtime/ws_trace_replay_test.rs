#[cfg(test)]
mod tests {
    use super::super::*;
    use crate::realtime::event_time::EventTime;
    use crate::realtime::FriendWake;
    use chrono::{TimeZone, Utc};
    use std::collections::{BTreeMap, HashMap};
    use std::env;
    use std::fs;
    use vrcx_0_contracts::feed_live::FeedLiveEntry;
    use vrcx_0_core::presence::PresenceView;

    struct PendingTimer {
        deadline_ms: i64,
        uid: String,
    }

    fn observe_all(runtime: &RealtimeFriendsRuntime) -> BTreeMap<String, Value> {
        let Some(snapshot) = runtime.snapshot() else {
            return BTreeMap::new();
        };
        snapshot
            .presence_by_id
            .iter()
            .map(|(uid, entry)| {
                let view = &entry.view;
                let section = view.section().as_str();
                let location = match view.place().map(|place| place.location.tag.trim()) {
                    None => "",
                    Some("" | "offline" | "offline:offline") => "unknown",
                    Some(location) => location,
                };
                let pending = matches!(view, PresenceView::PendingOffline { .. });
                (
                    uid.clone(),
                    json!({ "section": section, "pending": pending, "location": location }),
                )
            })
            .collect()
    }

    fn fire_timer(runtime: &RealtimeFriendsRuntime, timer: &PendingTimer) -> Vec<FeedLiveEntry> {
        let at = Utc
            .timestamp_millis_opt(timer.deadline_ms)
            .single()
            .map(|time| time.to_rfc3339())
            .unwrap_or_default();
        runtime
            .wake(&timer.uid, &at)
            .map(|output| output.persistence.feed_entries)
            .unwrap_or_default()
    }

    fn feed_summary(entries: &[FeedLiveEntry]) -> Vec<Value> {
        entries
            .iter()
            .map(|entry| {
                let entry = entry.to_json();
                let kind = entry["type"].as_str().unwrap_or("").to_string();
                let time = match kind.as_str() {
                    "GPS" => Value::Null,
                    _ => entry.get("time").cloned().unwrap_or(Value::Null),
                };
                json!({
                    "type": kind,
                    "userId": entry["userId"],
                    "location": entry.get("location").cloned().unwrap_or(Value::Null),
                    "previousLocation": entry.get("previousLocation").cloned().unwrap_or(Value::Null),
                    "time": time,
                })
            })
            .collect()
    }

    fn observable_changes(
        before: &BTreeMap<String, Value>,
        after: &BTreeMap<String, Value>,
    ) -> Value {
        let mut changes = serde_json::Map::new();
        for uid in before.keys().chain(after.keys()) {
            let (old, new) = (before.get(uid), after.get(uid));
            if old != new && !changes.contains_key(uid) {
                changes.insert(
                    uid.clone(),
                    json!({ "before": old.cloned(), "after": new.cloned() }),
                );
            }
        }
        Value::Object(changes)
    }

    fn roster_record(entry: &Value) -> Option<(String, FriendBaselineEntry)> {
        let text = |key: &str| entry.get(key).and_then(Value::as_str).unwrap_or("");
        let uid = text("uid").to_string();
        if uid.is_empty() {
            return None;
        }
        let record = FriendBaselineEntry {
            record: FriendRecord {
                id: uid.clone(),
                display_name: text("dn").into(),
                status: text("status").into(),
                ..FriendRecord::default()
            },
            presence: FriendBaselinePresence {
                state: text("state").into(),
                location: text("loc").to_string(),
                ..FriendBaselinePresence::default()
            },
        };
        Some((uid, record))
    }

    fn schedule(timers: &mut Vec<PendingTimer>, wake: &FriendWake) {
        timers.push(PendingTimer {
            deadline_ms: wake.at_ms,
            uid: wake.user_id.clone(),
        });
    }

    #[test]
    #[ignore = "requires VRCX0_WS_TRACE"]
    fn ws_trace_replay_matches_golden() {
        let path = env::var("VRCX0_WS_TRACE").expect("VRCX0_WS_TRACE must be set");
        let raw = fs::read_to_string(&path).expect("read ws-trace file");
        let dump_path = env::var("VRCX0_REPLAY_DUMP").ok();
        let expected: Option<Vec<String>> = env::var("VRCX0_REPLAY_EXPECT").ok().map(|path| {
            fs::read_to_string(path)
                .expect("read expect file")
                .lines()
                .map(str::to_string)
                .collect()
        });

        let runtime = RealtimeFriendsRuntime::default();
        let mut timers: Vec<PendingTimer> = Vec::new();
        let mut observed = BTreeMap::new();
        let mut lines: Vec<String> = Vec::new();

        let mut emit = |observed: &mut BTreeMap<String, Value>,
                        runtime: &RealtimeFriendsRuntime,
                        kind: &str,
                        at: &str,
                        uid: &str,
                        feeds: &[FeedLiveEntry]| {
            let next = observe_all(runtime);
            let line = json!({
                "i": lines.len(),
                "kind": kind,
                "at": at,
                "uid": uid,
                "changes": observable_changes(observed, &next),
                "feeds": feed_summary(feeds),
            });
            *observed = next;
            lines.push(line.to_string());
        };

        for (index, line) in raw.lines().enumerate() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let entry: Value = serde_json::from_str(line)
                .unwrap_or_else(|error| panic!("line {}: invalid json: {error}", index + 1));
            let kind = entry.get("kind").and_then(Value::as_str).unwrap_or("");
            if kind != "baseline" && kind != "ws" {
                continue;
            }
            let at = entry.get("at").and_then(Value::as_str).unwrap_or("");
            let at_ms = EventTime::from_received_at(at).timestamp_ms;

            timers.sort_by_key(|timer| timer.deadline_ms);
            while timers
                .first()
                .is_some_and(|timer| timer.deadline_ms <= at_ms)
            {
                let timer = timers.remove(0);
                let feeds = fire_timer(&runtime, &timer);
                let timer_at = Utc
                    .timestamp_millis_opt(timer.deadline_ms)
                    .single()
                    .map(|time| time.to_rfc3339())
                    .unwrap_or_default();
                emit(
                    &mut observed,
                    &runtime,
                    "timer",
                    &timer_at,
                    &timer.uid,
                    &feeds,
                );
            }

            if kind == "baseline" {
                let friends_by_id: HashMap<String, FriendBaselineEntry> = entry
                    .get("roster")
                    .and_then(Value::as_array)
                    .map(|rows| rows.iter().filter_map(roster_record).collect())
                    .unwrap_or_default();
                let effects = runtime.set_baseline_with_effects(
                    FriendRosterBaseline {
                        current_user_id: "usr_self".into(),
                        friends_by_id,
                        ..FriendRosterBaseline::default()
                    },
                    entry.get("generation").and_then(Value::as_u64).unwrap_or(0),
                    entry.get("revision").and_then(Value::as_u64).unwrap_or(0),
                    None,
                    at_ms,
                );
                for wake in &effects.schedules {
                    schedule(&mut timers, wake);
                }
                emit(
                    &mut observed,
                    &runtime,
                    "baseline",
                    at,
                    "",
                    &effects.presence_feed_entries,
                );
                continue;
            }

            let uid = entry.get("uid").and_then(Value::as_str).unwrap_or("");
            let payload = RealtimeWsMessagePayload {
                json: entry.get("ws").cloned().unwrap_or(Value::Null),
                raw: "{}".into(),
                received_at: at.to_string(),
            };
            let feeds = match runtime.apply_ws_message(&payload) {
                RealtimeFriendApplyResult::Output(output) => {
                    if let Some(wake) = &output.wake {
                        schedule(&mut timers, wake);
                    }
                    output
                        .persistence
                        .feed_entries
                        .into_iter()
                        .chain(output.joining)
                        .collect()
                }
                _ => Vec::new(),
            };
            emit(&mut observed, &runtime, "ws", at, uid, &feeds);
        }

        if let Some(path) = dump_path.as_ref() {
            fs::write(path, format!("{}\n", lines.join("\n"))).expect("write dump file");
            eprintln!("wrote {} replay lines to {path}", lines.len());
        }

        let Some(expected) = expected else {
            return;
        };
        let mismatches: Vec<usize> = (0..lines.len().max(expected.len()))
            .filter(|index| lines.get(*index) != expected.get(*index))
            .collect();
        for index in mismatches.iter().take(20) {
            eprintln!("--- line {index}");
            eprintln!(
                "golden: {}",
                expected.get(*index).map_or("<none>", String::as_str)
            );
            eprintln!(
                "replay: {}",
                lines.get(*index).map_or("<none>", String::as_str)
            );
        }
        assert!(
            mismatches.is_empty(),
            "{} of {} replay lines differ from golden",
            mismatches.len(),
            lines.len()
        );
    }
}
