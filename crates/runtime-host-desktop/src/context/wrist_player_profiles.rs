use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::Value;
use vrcx_0_application_core::TaskSupervisor;
use vrcx_0_application_realtime::RealtimeHostRuntime;
use vrcx_0_overlay_runtime::CachedUserStatus;

/// How long a fetched profile is reused before it is requested again.
const PROFILE_TTL: Duration = Duration::from_secs(10 * 60);
/// Gap between profile requests so a full instance does not burst the API.
const REQUEST_GAP: Duration = Duration::from_millis(500);
/// Pause after VRChat answers 429 before the queue continues.
const RATE_LIMIT_BACKOFF: Duration = Duration::from_secs(30);
/// A failed request (offline, signed out) is tried again after this long.
const ERROR_RETRY: Duration = Duration::from_secs(60);
const MAX_ENTRIES: usize = 500;

struct Entry {
    status: CachedUserStatus,
    fetched_at: Instant,
}

#[derive(Default)]
struct Inner {
    entries: HashMap<String, Entry>,
    queue: VecDeque<String>,
    queued: HashSet<String>,
    running: bool,
}

/// Fork: profiles of the players in the current instance, fetched for the
/// wrist Players/Notes pages so players who are not friends show their
/// platform, status text and 18+ badge. Requests go through the realtime
/// runtime's user cache, so profiles the Player List page already loaded are
/// reused, and only while those pages are being built.
#[derive(Clone, Default)]
pub(crate) struct WristPlayerProfiles {
    inner: Arc<Mutex<Inner>>,
}

impl WristPlayerProfiles {
    /// Cached statuses for `user_ids`; ids without a fresh entry are queued
    /// and fetched in the background.
    pub(crate) fn statuses(
        &self,
        user_ids: &[String],
        runtime: &Arc<RealtimeHostRuntime>,
        tasks: &TaskSupervisor,
    ) -> HashMap<String, CachedUserStatus> {
        let now = Instant::now();
        let mut found = HashMap::new();
        let start = {
            let mut inner = self.lock();
            for user_id in user_ids.iter().filter(|id| !id.trim().is_empty()) {
                let fresh = inner
                    .entries
                    .get(user_id)
                    .filter(|entry| now.saturating_duration_since(entry.fetched_at) < PROFILE_TTL);
                if let Some(entry) = inner.entries.get(user_id) {
                    found.insert(user_id.clone(), entry.status.clone());
                }
                if fresh.is_none() && inner.queued.insert(user_id.clone()) {
                    inner.queue.push_back(user_id.clone());
                }
            }
            let start = !inner.running && !inner.queue.is_empty();
            if start {
                inner.running = true;
            }
            start
        };
        if start {
            let profiles = self.clone();
            let runtime = Arc::clone(runtime);
            tasks.spawn_cancellable(move |stop_token| async move {
                profiles
                    .drain(&runtime, || stop_token.is_stop_requested())
                    .await;
            });
        }
        found
    }

    async fn drain(&self, runtime: &Arc<RealtimeHostRuntime>, stop_requested: impl Fn() -> bool) {
        loop {
            let Some(user_id) = self.next_queued(&stop_requested) else {
                return;
            };
            let is_friend = runtime.is_current_friend(&user_id);
            let response = runtime
                .get_user_via_cache(
                    vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT.into(),
                    user_id.clone(),
                    false,
                    false,
                    Some(is_friend),
                )
                .await;
            let delay = match response {
                Ok(response) if response.status == 429 => {
                    self.requeue(user_id);
                    RATE_LIMIT_BACKOFF
                }
                Ok(response) => {
                    let status = if (200..300).contains(&response.status) {
                        serde_json::from_str::<Value>(&response.data)
                            .map(|profile| status_from_profile(&profile))
                            .unwrap_or_default()
                    } else {
                        CachedUserStatus::default()
                    };
                    self.store(user_id, status, Instant::now());
                    REQUEST_GAP
                }
                Err(error) => {
                    tracing::debug!(error = %error, "wrist player profile fetch failed");
                    let now = Instant::now();
                    let retry_at = now.checked_sub(PROFILE_TTL - ERROR_RETRY).unwrap_or(now);
                    self.store(user_id, CachedUserStatus::default(), retry_at);
                    REQUEST_GAP
                }
            };
            tokio::time::sleep(delay).await;
        }
    }

    fn next_queued(&self, stop_requested: &impl Fn() -> bool) -> Option<String> {
        let mut inner = self.lock();
        let next = if stop_requested() {
            None
        } else {
            inner.queue.pop_front()
        };
        match &next {
            Some(user_id) => {
                inner.queued.remove(user_id);
            }
            None => inner.running = false,
        }
        next
    }

    fn requeue(&self, user_id: String) {
        let mut inner = self.lock();
        if inner.queued.insert(user_id.clone()) {
            inner.queue.push_front(user_id);
        }
    }

    fn store(&self, user_id: String, status: CachedUserStatus, fetched_at: Instant) {
        let mut inner = self.lock();
        if inner.entries.len() >= MAX_ENTRIES && !inner.entries.contains_key(&user_id) {
            inner.entries.clear();
        }
        inner.entries.insert(user_id, Entry { status, fetched_at });
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
}

pub(crate) fn status_from_profile(profile: &Value) -> CachedUserStatus {
    let text = |key: &str| {
        profile
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default()
    };
    // VRChat reports "offline" or "web" as the platform of players who are
    // not friends; their last game platform is the useful one.
    CachedUserStatus {
        platform: vrcx_0_core::trust::compute_user_platform(
            text("platform"),
            text("last_platform"),
        ),
        status_description: text("statusDescription").to_string(),
        age_verified: text("ageVerificationStatus") == "18+",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn profile_status_prefers_a_game_platform_and_reads_the_18_plus_badge() {
        let status = status_from_profile(&json!({
            "platform": "web",
            "last_platform": "android",
            "statusDescription": " chilling ",
            "ageVerificationStatus": "18+"
        }));
        assert_eq!(
            status,
            CachedUserStatus {
                platform: "android".into(),
                status_description: "chilling".into(),
                age_verified: true,
            }
        );

        let status = status_from_profile(&json!({
            "platform": "offline",
            "last_platform": "standalonewindows",
            "ageVerificationStatus": "18+"
        }));
        assert_eq!(status.platform, "standalonewindows");
        assert!(status.age_verified);

        let status = status_from_profile(&json!({
            "platform": "standalonewindows",
            "last_platform": "android",
            "ageVerificationStatus": "hidden"
        }));
        assert_eq!(status.platform, "standalonewindows");
        assert!(status.status_description.is_empty());
        assert!(!status.age_verified);
    }
}
