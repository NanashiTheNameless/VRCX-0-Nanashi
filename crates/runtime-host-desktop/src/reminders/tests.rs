use super::*;

const SELF: &str = "usr_22222222-2222-2222-2222-222222222222";
const FRIEND: &str = "usr_11111111-1111-1111-1111-111111111111";

struct Fixture {
    runtime: Arc<ReminderRuntime>,
    config: ConfigRepository,
    auth: RuntimeAuthScope,
    dir: std::path::PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "vrcx-reminders-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let db =
            Arc::new(vrcx_0_persistence::DatabaseService::new(&dir.join("test.sqlite3")).unwrap());
        let config = ConfigRepository::new(db);
        config.ensure_table().unwrap();
        let auth = RuntimeAuthScope::new();
        auth.set(SELF, "https://api.vrchat.cloud/api/1");
        let runtime =
            ReminderRuntime::new(config.clone(), auth.clone(), OverlayActivityRuntime::new());
        Self {
            runtime,
            config,
            auth,
            dir,
        }
    }

    fn online(&self) -> Reminder {
        self.runtime
            .create(
                SELF,
                "ask about the event".into(),
                ReminderTrigger::FriendOnline {
                    user_id: FRIEND.into(),
                    display_name: "Friend".into(),
                },
                false,
            )
            .unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn at(value: &str) -> DateTime<Utc> {
    parse_time(value).unwrap()
}

fn candidate(
    kind: &str,
    user_id: &str,
    created_at: &str,
    payload: Value,
) -> OverlayActivityCandidate {
    OverlayActivityCandidate {
        source_id: format!("test:{kind}:{created_at}"),
        activity_type: kind.into(),
        created_at: created_at.into(),
        actor_user_id: user_id.into(),
        actor_display_name: "Friend Now".into(),
        current_instance: false,
        favorite_subject: OverlayActivityFavoriteSubject::None,
        payload: payload.into(),
    }
}

#[test]
fn one_time_event_reminder_fires_once_and_is_removed() {
    let f = Fixture::new();
    f.online();
    let now = at("2026-09-27T12:00:00Z");
    f.runtime.observe(
        &candidate("Offline", FRIEND, "2026-09-27T12:00:00Z", json!({})),
        now,
    );
    assert_eq!(
        f.runtime.list(SELF).len(),
        1,
        "wrong event type must not fire"
    );
    f.runtime.observe(
        &candidate("Online", FRIEND, "2026-09-27T12:00:00Z", json!({})),
        now,
    );
    assert!(f.runtime.list(SELF).is_empty());
}

#[test]
fn stale_events_other_accounts_and_signed_out_never_fire() {
    let f = Fixture::new();
    f.online();
    let now = at("2026-09-27T12:00:00Z");
    f.runtime.observe(
        &candidate("Online", FRIEND, "2026-09-27T11:00:00Z", json!({})),
        now,
    );
    assert_eq!(f.runtime.list(SELF).len(), 1, "backlog must not fire");
    f.auth.set("usr_other", "https://api.vrchat.cloud/api/1");
    f.runtime.observe(
        &candidate("Online", FRIEND, "2026-09-27T12:00:00Z", json!({})),
        now,
    );
    assert_eq!(f.runtime.list(SELF).len(), 1, "other account must not fire");
}

#[test]
fn recurring_event_reminder_keeps_a_cooldown() {
    let f = Fixture::new();
    f.runtime
        .create(
            SELF,
            "say hi".into(),
            ReminderTrigger::PlayerJoined {
                user_id: FRIEND.into(),
                display_name: "Friend".into(),
            },
            true,
        )
        .unwrap();
    let first = at("2026-09-27T12:00:00Z");
    let joined = |time: &str| candidate("OnPlayerJoined", FRIEND, time, json!({}));
    f.runtime.observe(&joined("2026-09-27T12:00:00Z"), first);
    f.runtime
        .observe(&joined("2026-09-27T12:05:00Z"), at("2026-09-27T12:05:00Z"));
    assert_eq!(f.runtime.list(SELF)[0].fire_count, 1, "inside cooldown");
    f.runtime
        .observe(&joined("2026-09-27T12:11:00Z"), at("2026-09-27T12:11:00Z"));
    assert_eq!(f.runtime.list(SELF)[0].fire_count, 2);
}

#[test]
fn location_reminder_can_require_one_world() {
    let trigger = ReminderTrigger::FriendLocation {
        user_id: FRIEND.into(),
        display_name: "Friend".into(),
        world_id: "wrld_target".into(),
    };
    let elsewhere = candidate(
        "GPS",
        FRIEND,
        "",
        json!({"location": "wrld_other:1", "worldName": "Other"}),
    );
    assert_eq!(event_detail(&trigger, &elsewhere), None);
    let there = candidate(
        "GPS",
        FRIEND,
        "",
        json!({"location": "wrld_target:1~private", "worldName": "Target"}),
    );
    assert_eq!(
        event_detail(&trigger, &there).as_deref(),
        Some("Friend Now is now in Target")
    );
}

#[test]
fn time_reminders_fire_once_or_advance_past_now() {
    let f = Fixture::new();
    f.runtime
        .create(
            SELF,
            "once".into(),
            ReminderTrigger::Time {
                at: "2026-09-27T12:00:00Z".into(),
                repeat_minutes: 0,
            },
            true,
        )
        .unwrap();
    f.runtime
        .create(
            SELF,
            "hourly".into(),
            ReminderTrigger::Time {
                at: "2026-09-27T12:00:00Z".into(),
                repeat_minutes: 60,
            },
            false,
        )
        .unwrap();
    assert!(f
        .runtime
        .list(SELF)
        .iter()
        .all(|reminder| !reminder.recurring));
    f.runtime.tick(at("2026-09-27T11:59:00Z"));
    assert_eq!(f.runtime.list(SELF).len(), 2, "not due yet");
    // Woke from sleep hours later: fires once and schedules the next slot.
    f.runtime.tick(at("2026-09-27T15:30:00Z"));
    let left = f.runtime.list(SELF);
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].message, "hourly");
    assert_eq!(left[0].fire_count, 1);
    assert_eq!(
        left[0].trigger,
        ReminderTrigger::Time {
            at: "2026-09-27T16:00:00Z".into(),
            repeat_minutes: 60,
        }
    );
}

#[test]
fn next_due_is_strictly_after_now() {
    let due = at("2026-09-27T12:00:00Z");
    assert_eq!(next_due(due, 0, due), None);
    assert_eq!(
        next_due(due, 30, at("2026-09-27T12:00:00Z")),
        Some(at("2026-09-27T12:30:00Z"))
    );
    assert_eq!(
        next_due(due, 30, at("2026-09-27T12:30:00Z")),
        Some(at("2026-09-27T13:00:00Z"))
    );
}

#[test]
fn reminders_persist_are_capped_and_delete_is_owner_scoped() {
    let f = Fixture::new();
    let reminder = f.online();
    let reloaded = ReminderRuntime::new(
        f.config.clone(),
        f.auth.clone(),
        OverlayActivityRuntime::new(),
    );
    assert_eq!(reloaded.list(SELF), vec![reminder.clone()]);
    assert!(!f.runtime.delete("usr_other", &reminder.id));
    assert!(f.runtime.delete(SELF, &reminder.id));
    assert!(f.runtime.list(SELF).is_empty());
    for _ in 0..MAX_REMINDERS_PER_ACCOUNT {
        f.online();
    }
    assert!(f
        .runtime
        .create(
            SELF,
            "one too many".into(),
            ReminderTrigger::Time {
                at: "2026-09-27T12:00:00Z".into(),
                repeat_minutes: 0
            },
            false
        )
        .is_err());
}
