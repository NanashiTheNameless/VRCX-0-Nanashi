//! Fork: assistant reminders (upstream #479). Reminders are created by the
//! assistant tools, persisted in config, and fired here from live activity
//! (every overlay activity candidate is observed before filtering) or from a
//! timer. A fired reminder becomes a `Reminder` activity, so desktop, VR, sound
//! and TTS delivery follow the user's normal notification filters and do not
//! need the chat to be open.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::{json, Value};
use vrcx_0_application_activity::{
    OverlayActivityCandidate, OverlayActivityFavoriteSubject, OverlayActivityRuntime,
};
use vrcx_0_application_core::{RuntimeAuthScope, TaskSupervisor};
use vrcx_0_contracts::reminders::{Reminder, ReminderTrigger};
use vrcx_0_persistence::config::ConfigRepository;

pub const REMINDERS_KEY: &str = "assistantReminders";
pub const MAX_REMINDERS_PER_ACCOUNT: usize = 50;
/// A recurring event reminder stays quiet this long after firing.
const RECURRING_COOLDOWN_SECS: i64 = 10 * 60;
/// Events older than this are backlog (log replay, reconnect) and never fire.
const STALE_EVENT_SECS: i64 = 5 * 60;
const TICK: Duration = Duration::from_secs(15);
static NEXT_ID: AtomicU32 = AtomicU32::new(0);

pub struct ReminderRuntime {
    config: ConfigRepository,
    auth: RuntimeAuthScope,
    overlay: OverlayActivityRuntime,
    reminders: Mutex<Vec<Reminder>>,
}

impl ReminderRuntime {
    pub(crate) fn new(
        config: ConfigRepository,
        auth: RuntimeAuthScope,
        overlay: OverlayActivityRuntime,
    ) -> Arc<Self> {
        let reminders = config
            .get_json(REMINDERS_KEY, json!([]))
            .ok()
            .and_then(|value| serde_json::from_value(value).ok())
            .unwrap_or_default();
        let runtime = Arc::new(Self {
            config,
            auth,
            overlay,
            reminders: Mutex::new(reminders),
        });
        // Weak: the overlay runtime lives as long as the app and must not keep
        // this runtime alive through its observer.
        let weak: Weak<Self> = Arc::downgrade(&runtime);
        runtime
            .overlay
            .set_candidate_observer(Arc::new(move |candidate| {
                if let Some(runtime) = weak.upgrade() {
                    runtime.observe(candidate, Utc::now());
                }
            }));
        runtime
    }

    pub(crate) fn start(self: &Arc<Self>, tasks: &TaskSupervisor) {
        let runtime = Arc::clone(self);
        tasks.spawn_cancellable(move |stop| async move {
            while !stop.is_stop_requested() {
                runtime.tick(Utc::now());
                tokio::time::sleep(TICK).await;
            }
        });
    }

    pub fn list(&self, owner_user_id: &str) -> Vec<Reminder> {
        self.reminders
            .lock()
            .unwrap()
            .iter()
            .filter(|reminder| reminder.owner_user_id == owner_user_id)
            .cloned()
            .collect()
    }

    pub fn create(
        &self,
        owner_user_id: &str,
        message: String,
        trigger: ReminderTrigger,
        recurring: bool,
    ) -> Result<Reminder, String> {
        let owner_user_id = owner_user_id.trim();
        if owner_user_id.is_empty() {
            return Err("Sign in to create reminders.".into());
        }
        let now = Utc::now();
        let reminder = Reminder {
            id: format!(
                "rem_{:x}{:04x}",
                now.timestamp_millis(),
                NEXT_ID.fetch_add(1, Ordering::Relaxed) & 0xffff
            ),
            owner_user_id: owner_user_id.to_string(),
            message,
            // Time reminders repeat through repeat_minutes, not the event flag.
            recurring: recurring && !matches!(trigger, ReminderTrigger::Time { .. }),
            trigger,
            created_at: now.to_rfc3339_opts(SecondsFormat::Secs, true),
            last_fired_at: String::new(),
            fire_count: 0,
        };
        let mut reminders = self.reminders.lock().unwrap();
        let owned = reminders
            .iter()
            .filter(|existing| existing.owner_user_id == owner_user_id)
            .count();
        if owned >= MAX_REMINDERS_PER_ACCOUNT {
            return Err(format!(
                "At most {MAX_REMINDERS_PER_ACCOUNT} reminders; delete one first."
            ));
        }
        reminders.push(reminder.clone());
        self.persist(&reminders);
        Ok(reminder)
    }

    pub fn delete(&self, owner_user_id: &str, id: &str) -> bool {
        let mut reminders = self.reminders.lock().unwrap();
        let before = reminders.len();
        reminders
            .retain(|reminder| !(reminder.id == id && reminder.owner_user_id == owner_user_id));
        let deleted = reminders.len() != before;
        if deleted {
            self.persist(&reminders);
        }
        deleted
    }

    /// Reminders of the signed-in account (Settings list).
    pub fn list_current(&self) -> Vec<Reminder> {
        self.current_owner()
            .map(|owner| self.list(&owner))
            .unwrap_or_default()
    }

    /// Fork: create a reminder for the signed-in account (Settings form).
    pub fn create_current(
        &self,
        message: String,
        trigger: ReminderTrigger,
        recurring: bool,
    ) -> Result<Reminder, String> {
        let owner = self
            .current_owner()
            .ok_or_else(|| "Sign in to create reminders.".to_string())?;
        match &trigger {
            ReminderTrigger::Time { at, .. } => {
                if chrono::DateTime::parse_from_rfc3339(at).is_err() {
                    return Err("Pick a valid date and time.".into());
                }
            }
            ReminderTrigger::FriendOnline { user_id, .. }
            | ReminderTrigger::FriendOffline { user_id, .. }
            | ReminderTrigger::FriendLocation { user_id, .. }
            | ReminderTrigger::PlayerJoined { user_id, .. } => {
                if user_id.trim().is_empty() {
                    return Err("Pick a friend.".into());
                }
            }
        }
        self.create(&owner, message, trigger, recurring)
    }

    pub fn delete_current(&self, id: &str) -> bool {
        self.current_owner()
            .is_some_and(|owner| self.delete(&owner, id))
    }

    fn persist(&self, reminders: &[Reminder]) {
        match serde_json::to_value(reminders) {
            Ok(value) => {
                if let Err(error) = self.config.set_json(REMINDERS_KEY, &value) {
                    tracing::warn!(%error, "failed to persist reminders");
                }
            }
            Err(error) => tracing::warn!(%error, "failed to serialize reminders"),
        }
    }

    fn current_owner(&self) -> Option<String> {
        let scope = self.auth.snapshot();
        let owner = scope.current_user_id.trim();
        (scope.active && !owner.is_empty()).then(|| owner.to_string())
    }

    fn observe(&self, candidate: &OverlayActivityCandidate, now: DateTime<Utc>) {
        if candidate.activity_type == "Reminder" || is_stale(&candidate.created_at, now) {
            return;
        }
        let Some(owner) = self.current_owner() else {
            return;
        };
        let fired = {
            let mut reminders = self.reminders.lock().unwrap();
            let mut fired = Vec::new();
            for reminder in reminders.iter_mut() {
                if reminder.owner_user_id != owner || in_cooldown(reminder, now) {
                    continue;
                }
                if let Some(detail) = event_detail(&reminder.trigger, candidate) {
                    mark_fired(reminder, now);
                    fired.push((reminder.clone(), detail));
                }
            }
            if !fired.is_empty() {
                reminders.retain(|reminder| reminder.recurring || reminder.fire_count == 0);
                self.persist(&reminders);
            }
            fired
        };
        // Deliver with no lock held: ingesting re-enters the observer.
        for (reminder, detail) in fired {
            self.deliver(&reminder, &detail, candidate.actor_user_id.clone(), now);
        }
    }

    fn tick(&self, now: DateTime<Utc>) {
        let Some(owner) = self.current_owner() else {
            return;
        };
        let fired = {
            let mut reminders = self.reminders.lock().unwrap();
            let mut fired = Vec::new();
            let mut remove = Vec::new();
            for reminder in reminders.iter_mut() {
                if reminder.owner_user_id != owner {
                    continue;
                }
                let ReminderTrigger::Time { at, repeat_minutes } = &mut reminder.trigger else {
                    continue;
                };
                let Some(due) = parse_time(at) else {
                    remove.push(reminder.id.clone());
                    continue;
                };
                if due > now {
                    continue;
                }
                // Fires once even after a long sleep, then moves past `now`.
                let next = next_due(due, *repeat_minutes, now);
                match next {
                    Some(next) => *at = next.to_rfc3339_opts(SecondsFormat::Secs, true),
                    None => remove.push(reminder.id.clone()),
                }
                mark_fired(reminder, now);
                fired.push(reminder.clone());
            }
            if !fired.is_empty() || !remove.is_empty() {
                reminders.retain(|reminder| !remove.contains(&reminder.id));
                self.persist(&reminders);
            }
            fired
        };
        for reminder in fired {
            self.deliver(&reminder, "", String::new(), now);
        }
    }

    fn deliver(
        &self,
        reminder: &Reminder,
        detail: &str,
        actor_user_id: String,
        now: DateTime<Utc>,
    ) {
        let message = if detail.is_empty() {
            reminder.message.clone()
        } else {
            format!("{detail}: {}", reminder.message)
        };
        let created_at = now.to_rfc3339_opts(SecondsFormat::Millis, true);
        self.overlay.ingest_candidate(OverlayActivityCandidate {
            source_id: format!("reminder:{}:{}", reminder.id, reminder.fire_count),
            activity_type: "Reminder".into(),
            created_at,
            actor_display_name: trigger_display_name(&reminder.trigger).to_string(),
            favorite_subject: if actor_user_id.is_empty() {
                OverlayActivityFavoriteSubject::None
            } else {
                OverlayActivityFavoriteSubject::UserId(actor_user_id.clone())
            },
            actor_user_id,
            current_instance: false,
            payload: json!({"title": "Reminder", "message": message, "reminderId": reminder.id})
                .into(),
        });
    }
}

fn parse_time(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value.trim())
        .ok()
        .map(|time| time.with_timezone(&Utc))
}

fn is_stale(created_at: &str, now: DateTime<Utc>) -> bool {
    // Unknown timestamps count as live; the source already decided to emit.
    parse_time(created_at).is_some_and(|time| (now - time).num_seconds() > STALE_EVENT_SECS)
}

fn in_cooldown(reminder: &Reminder, now: DateTime<Utc>) -> bool {
    parse_time(&reminder.last_fired_at)
        .is_some_and(|time| (now - time).num_seconds() < RECURRING_COOLDOWN_SECS)
}

fn mark_fired(reminder: &mut Reminder, now: DateTime<Utc>) {
    reminder.last_fired_at = now.to_rfc3339_opts(SecondsFormat::Secs, true);
    reminder.fire_count = reminder.fire_count.saturating_add(1);
}

/// Next due time strictly after `now`, or None for a one-shot reminder.
fn next_due(due: DateTime<Utc>, repeat_minutes: u32, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
    if repeat_minutes == 0 {
        return None;
    }
    let step = chrono::Duration::minutes(i64::from(repeat_minutes));
    let behind = (now - due).num_minutes() / i64::from(repeat_minutes) + 1;
    Some(due + step * i32::try_from(behind).unwrap_or(i32::MAX))
}

fn trigger_display_name(trigger: &ReminderTrigger) -> &str {
    match trigger {
        ReminderTrigger::FriendOnline { display_name, .. }
        | ReminderTrigger::FriendOffline { display_name, .. }
        | ReminderTrigger::FriendLocation { display_name, .. }
        | ReminderTrigger::PlayerJoined { display_name, .. } => display_name,
        ReminderTrigger::Time { .. } => "",
    }
}

fn payload_text<'a>(candidate: &'a OverlayActivityCandidate, key: &str) -> &'a str {
    candidate
        .payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default()
}

/// What happened, when `candidate` satisfies `trigger`.
fn event_detail(trigger: &ReminderTrigger, candidate: &OverlayActivityCandidate) -> Option<String> {
    let (user_id, stored_name, wanted) = match trigger {
        ReminderTrigger::FriendOnline {
            user_id,
            display_name,
        } => (user_id, display_name, "Online"),
        ReminderTrigger::FriendOffline {
            user_id,
            display_name,
        } => (user_id, display_name, "Offline"),
        ReminderTrigger::FriendLocation {
            user_id,
            display_name,
            ..
        } => (user_id, display_name, "GPS"),
        ReminderTrigger::PlayerJoined {
            user_id,
            display_name,
        } => (user_id, display_name, "OnPlayerJoined"),
        ReminderTrigger::Time { .. } => return None,
    };
    if candidate.activity_type != wanted || candidate.actor_user_id != *user_id {
        return None;
    }
    let name = if candidate.actor_display_name.trim().is_empty() {
        stored_name.as_str()
    } else {
        candidate.actor_display_name.trim()
    };
    let world_name = payload_text(candidate, "worldName");
    Some(match trigger {
        ReminderTrigger::FriendOnline { .. } => format!("{name} is online"),
        ReminderTrigger::FriendOffline { .. } => format!("{name} went offline"),
        ReminderTrigger::FriendLocation { world_id, .. } => {
            if !world_id.is_empty() {
                let location = payload_text(candidate, "location");
                let actual = vrcx_0_core::location::world_id_from_location(location);
                if actual != *world_id {
                    return None;
                }
            }
            if world_name.is_empty() {
                format!("{name} changed location")
            } else {
                format!("{name} is now in {world_name}")
            }
        }
        ReminderTrigger::PlayerJoined { .. } => format!("{name} joined your instance"),
        ReminderTrigger::Time { .. } => return None,
    })
}

#[cfg(test)]
mod tests;
