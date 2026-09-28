//! Fork: globally hide (VRChat avatar-block) every avatar on opted-in lists.
//!
//! Deliberately slow so VRChat is never hammered: one request at a time, at
//! least `MIN_INTERVAL` plus jitter apart, at most `DAILY_CAP` new blocks per
//! UTC day, exponential backoff on 429/5xx/network errors, and a stop for the
//! rest of the day after repeated errors. Turning the option off (or an ID
//! leaving a list) only stops future blocks. Unblocking is a separate,
//! user-started, reviewed action that touches only blocks this app made.

use super::*;

const MIN_INTERVAL: Duration = Duration::from_secs(10);
const MAX_JITTER_MS: u64 = 5_000;
const DAILY_CAP: u32 = 300;
const BACKOFF_BASE_SECS: i64 = 300;
const BACKOFF_MAX_SECS: i64 = 6 * 3600;
const MAX_CONSECUTIVE_ERRORS: u32 = 5;
const EXISTING_BLOCKS_TTL: Duration = Duration::from_secs(6 * 3600);
const IDLE: Duration = Duration::from_secs(60);
const REVIEW_TTL: Duration = Duration::from_secs(300);

fn jittered_interval() -> Duration {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64)
        .unwrap_or(0);
    MIN_INTERVAL + Duration::from_millis(nanos % MAX_JITTER_MS)
}

fn today() -> String {
    Utc::now().format("%Y-%m-%d").to_string()
}

fn in_backoff(state: &GlobalHideAccountState) -> bool {
    chrono::DateTime::parse_from_rfc3339(&state.backoff_until)
        .is_ok_and(|until| until.with_timezone(&Utc) > Utc::now())
}

/// Backoff after `errors` consecutive failures: 5 min doubling, capped at 6 h;
/// from `MAX_CONSECUTIVE_ERRORS` on, wait until the next UTC day.
fn backoff_until(errors: u32) -> String {
    let now = Utc::now();
    let until = if errors >= MAX_CONSECUTIVE_ERRORS {
        (now.date_naive() + chrono::Days::new(1))
            .and_hms_opt(0, 0, 0)
            .map(|midnight| midnight.and_utc())
            .unwrap_or(now + chrono::Duration::seconds(BACKOFF_MAX_SECS))
    } else {
        let exponent = errors.saturating_sub(1).min(10);
        let secs = (BACKOFF_BASE_SECS << exponent).min(BACKOFF_MAX_SECS);
        now + chrono::Duration::seconds(secs)
    };
    until.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn roll_day(state: &mut GlobalHideAccountState) {
    let today = today();
    if state.day != today {
        state.day = today;
        state.day_count = 0;
        if state.consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
            state.consecutive_errors = 0;
        }
    }
}

enum Attempt {
    Done,
    Skip,
    Retry(String),
}

/// `result` = (timeout ok?) (request ok?) HTTP status.
fn classify(result: Result<Result<i32, String>, ()>) -> Attempt {
    match result {
        Ok(Ok(status)) if (200..300).contains(&status) => Attempt::Done,
        Ok(Ok(400 | 404)) => Attempt::Skip,
        Ok(Ok(status)) => Attempt::Retry(format!("HTTP {status}")),
        Ok(Err(error)) => Attempt::Retry(error),
        Err(()) => Attempt::Retry("request timed out".into()),
    }
}

impl SafetyRuntime {
    fn global_hide_sources(&self) -> (Vec<String>, BTreeSet<String>) {
        let state = self.state.lock().unwrap();
        if !state.settings.enabled {
            return (Vec::new(), BTreeSet::new());
        }
        let mut names = Vec::new();
        let mut listed = BTreeSet::new();
        for source in state.settings.sources.iter().filter(|s| {
            s.enabled
                && s.global_hide
                && matches!(
                    s.format,
                    SourceFormat::AvatarIds | SourceFormat::GithubAvatars
                )
        }) {
            names.push(source.name.clone());
            if let Some(cache) = state
                .caches
                .iter()
                .find(|c| cache_matches(c, source) && cache_is_fresh(c))
            {
                listed.extend(cache.entries.iter().cloned());
            }
        }
        (names, listed)
    }

    fn persist_global_hide(&self) {
        let value = serde_json::to_value(&*self.global_hide.lock().unwrap());
        if let Ok(value) = value {
            if let Err(error) = self.config.set_json(GLOBAL_HIDE_KEY, &value) {
                tracing::warn!(%error, "failed to persist global hide state");
            }
        }
    }

    fn global_hide_job(&self, scope: &RuntimeAuthScopeSnapshot, avatar_id: &str) -> SafetyJob {
        SafetyJob {
            queued_at: Instant::now(),
            scope: scope.clone(),
            epoch: 0,
            player_revision: 0,
            policy_revision: 0,
            is_join: false,
            location: String::new(),
            created_at: now(),
            user_id: String::new(),
            display_name: String::new(),
            avatar_name: String::new(),
            url: String::new(),
            log_kind: String::new(),
            avatar_id: avatar_id.to_string(),
        }
    }

    /// Still allowed to block `id` for `account` right now (checked just before sending).
    fn global_hide_allowed(&self, account: &str, id: &str) -> bool {
        let (_, listed) = self.global_hide_sources();
        listed.contains(id)
            && self
                .global_hide
                .lock()
                .unwrap()
                .get(account)
                .is_none_or(|state| !state.paused)
    }

    async fn load_existing_avatar_blocks(
        &self,
        scope: &RuntimeAuthScopeSnapshot,
    ) -> Result<BTreeSet<String>, String> {
        {
            let cached = self.existing_avatar_blocks.lock().unwrap();
            if let Some((account, fetched, ids)) = cached.as_ref() {
                if account == &scope.current_user_id && fetched.elapsed() < EXISTING_BLOCKS_TTL {
                    return Ok(ids.clone());
                }
            }
        }
        let (api, _) = self.api.get().ok_or("Safety API is not ready")?;
        let request = vrcx_0_vrchat_client::http_api::api_input(
            scope.endpoint.clone(),
            "GET",
            "auth/user/avatarmoderations",
            None,
        );
        let response = tokio::time::timeout(
            Duration::from_secs(15),
            api.execute_guarded(scope, request, VrchatScope::Vrchat, || true),
        )
        .await
        .map_err(|_| "Loading existing avatar blocks timed out".to_string())?
        .map_err(|e| e.to_string())?;
        if !(200..300).contains(&response.status) {
            return Err(format!(
                "Loading existing avatar blocks: HTTP {}",
                response.status
            ));
        }
        let values: Vec<Value> = serde_json::from_str(&response.data)
            .map_err(|_| "Invalid avatar moderation response".to_string())?;
        let ids: BTreeSet<String> = values
            .iter()
            .filter(|v| v.get("avatarModerationType").and_then(Value::as_str) == Some("block"))
            .filter_map(|v| {
                v.get("targetAvatarId")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .collect();
        *self.existing_avatar_blocks.lock().unwrap() =
            Some((scope.current_user_id.clone(), Instant::now(), ids.clone()));
        Ok(ids)
    }

    fn note_failure(&self, account: &str, error: String) {
        let mut all = self.global_hide.lock().unwrap();
        let state = all.entry(account.to_string()).or_default();
        state.consecutive_errors = state.consecutive_errors.saturating_add(1);
        state.backoff_until = backoff_until(state.consecutive_errors);
        state.last_error = error;
        drop(all);
        self.persist_global_hide();
    }

    /// One unit of work; returns how long to wait before the next step.
    pub(super) async fn global_hide_step(&self) -> Duration {
        let Some((api, moderation)) = self.api.get() else {
            return IDLE;
        };
        let scope = self.auth.snapshot();
        if !scope.active || scope.current_user_id.is_empty() {
            return IDLE;
        }
        let account = scope.current_user_id.clone();
        {
            let mut all = self.global_hide.lock().unwrap();
            let state = all.entry(account.clone()).or_default();
            roll_day(state);
            if state.paused || in_backoff(state) {
                return IDLE;
            }
        }

        // A user-started unblock runs first, at the same pace.
        let unblock_next = {
            let queue = self.unblock_queue.lock().unwrap();
            queue
                .as_ref()
                .filter(|(queued_account, _)| queued_account == &account)
                .and_then(|(_, ids)| ids.first().cloned())
        };
        if let Some(id) = unblock_next {
            return self.unblock_one(api, moderation, &scope, &id).await;
        }

        let (names, listed) = self.global_hide_sources();
        if listed.is_empty() {
            return IDLE;
        }
        let existing = match self.load_existing_avatar_blocks(&scope).await {
            Ok(existing) => existing,
            Err(error) => {
                self.note_failure(&account, error);
                return IDLE;
            }
        };
        let next = {
            let all = self.global_hide.lock().unwrap();
            let state = all.get(&account).cloned().unwrap_or_default();
            if state.day_count >= DAILY_CAP {
                return IDLE * 5;
            }
            listed
                .iter()
                .find(|id| {
                    !state.blocked_by_app.contains(*id)
                        && !state.skipped.contains(*id)
                        && !existing.contains(*id)
                })
                .cloned()
        };
        let Some(id) = next else {
            return IDLE * 5;
        };
        let source = names.join(", ");
        let job = self.global_hide_job(&scope, &id);
        let message = format!("Global hide from community list: {id}");
        self.record(
            &job,
            "SafetyCommunity",
            &source,
            &message,
            "global hide avatar",
            "attempting",
        );
        let Ok((_, request)) = vrcx_0_vrchat_client::avatars::avatar_moderation_send_input(
            scope.endpoint.clone(),
            id.clone(),
        ) else {
            return IDLE;
        };
        let result = tokio::time::timeout(
            Duration::from_secs(15),
            api.execute_guarded(&scope, request, VrchatScope::Vrchat, || {
                self.global_hide_allowed(&account, &id)
            }),
        )
        .await
        .map(|response| response.map(|r| r.status).map_err(|e| e.to_string()))
        .map_err(|_| ());
        let outcome = match classify(result) {
            Attempt::Done => {
                moderation.invalidate();
                let mut all = self.global_hide.lock().unwrap();
                let state = all.entry(account.clone()).or_default();
                state.blocked_by_app.insert(id.clone());
                state.day_count += 1;
                state.consecutive_errors = 0;
                state.last_error.clear();
                state.last_block_at = now();
                drop(all);
                self.persist_global_hide();
                "success".to_string()
            }
            Attempt::Skip => {
                let mut all = self.global_hide.lock().unwrap();
                all.entry(account.clone())
                    .or_default()
                    .skipped
                    .insert(id.clone());
                drop(all);
                self.persist_global_hide();
                "skipped: avatar missing or invalid".to_string()
            }
            Attempt::Retry(error) => {
                self.note_failure(&account, error.clone());
                format!("failed: {error}; backing off")
            }
        };
        self.record(
            &job,
            "SafetyCommunity",
            &source,
            &message,
            "global hide avatar",
            &outcome,
        );
        jittered_interval()
    }

    async fn unblock_one(
        &self,
        api: &VrchatApiRuntime,
        moderation: &vrcx_0_application::avatars::AvatarModerationRuntime,
        scope: &RuntimeAuthScopeSnapshot,
        id: &str,
    ) -> Duration {
        let account = scope.current_user_id.clone();
        let job = self.global_hide_job(scope, id);
        let message = format!("User-requested unblock of app-made block: {id}");
        let Ok((_, request)) = vrcx_0_vrchat_client::avatars::avatar_moderation_delete_input(
            scope.endpoint.clone(),
            id.to_string(),
        ) else {
            return IDLE;
        };
        self.record(
            &job,
            "SafetyCommunity",
            "",
            &message,
            "unblock avatar",
            "attempting",
        );
        let result = tokio::time::timeout(
            Duration::from_secs(15),
            api.execute_guarded(scope, request, VrchatScope::Vrchat, || {
                self.unblock_queue
                    .lock()
                    .unwrap()
                    .as_ref()
                    .is_some_and(|(queued, ids)| queued == &account && ids.iter().any(|i| i == id))
            }),
        )
        .await
        .map(|response| response.map(|r| r.status).map_err(|e| e.to_string()))
        .map_err(|_| ());
        let outcome = match classify(result) {
            Attempt::Done | Attempt::Skip => {
                moderation.invalidate();
                {
                    let mut all = self.global_hide.lock().unwrap();
                    all.entry(account.clone())
                        .or_default()
                        .blocked_by_app
                        .remove(id);
                }
                self.persist_global_hide();
                let mut queue = self.unblock_queue.lock().unwrap();
                if let Some((_, ids)) = queue.as_mut() {
                    ids.retain(|queued| queued != id);
                    if ids.is_empty() {
                        *queue = None;
                    }
                }
                *self.existing_avatar_blocks.lock().unwrap() = None;
                "success".to_string()
            }
            Attempt::Retry(error) => {
                self.note_failure(&account, error.clone());
                format!("failed: {error}; backing off")
            }
        };
        self.record(
            &job,
            "SafetyCommunity",
            "",
            &message,
            "unblock avatar",
            &outcome,
        );
        jittered_interval()
    }

    pub fn global_hide_status(&self) -> GlobalHideStatus {
        let scope = self.auth.snapshot();
        let (source_names, listed) = self.global_hide_sources();
        let mut status = GlobalHideStatus {
            signed_in: scope.active,
            source_names,
            listed: listed.len() as u32,
            daily_cap: DAILY_CAP,
            ..Default::default()
        };
        if !scope.active {
            return status;
        }
        let unblock_remaining = self
            .unblock_queue
            .lock()
            .unwrap()
            .as_ref()
            .filter(|(account, _)| account == &scope.current_user_id)
            .map_or(0, |(_, ids)| ids.len() as u32);
        let existing = self
            .existing_avatar_blocks
            .lock()
            .unwrap()
            .as_ref()
            .filter(|(account, _, _)| account == &scope.current_user_id)
            .map(|(_, _, ids)| ids.clone())
            .unwrap_or_default();
        let mut all = self.global_hide.lock().unwrap();
        let state = all.entry(scope.current_user_id.clone()).or_default();
        roll_day(state);
        status.blocked_by_app = state.blocked_by_app.len() as u32;
        status.skipped = state.skipped.len() as u32;
        status.already_blocked = listed
            .iter()
            .filter(|id| existing.contains(*id) && !state.blocked_by_app.contains(*id))
            .count() as u32;
        status.pending = listed
            .iter()
            .filter(|id| {
                !state.blocked_by_app.contains(*id)
                    && !state.skipped.contains(*id)
                    && !existing.contains(*id)
            })
            .count() as u32;
        status.today = state.day_count;
        status.paused = state.paused;
        status.backoff_until = if in_backoff(state) {
            state.backoff_until.clone()
        } else {
            String::new()
        };
        status.last_error = state.last_error.clone();
        status.unblock_remaining = unblock_remaining;
        status
    }

    pub fn global_hide_set_paused(&self, paused: bool) -> GlobalHideStatus {
        let scope = self.auth.snapshot();
        if scope.active {
            let mut all = self.global_hide.lock().unwrap();
            let state = all.entry(scope.current_user_id.clone()).or_default();
            state.paused = paused;
            if !paused {
                // Resuming is an explicit user choice: clear any error backoff.
                state.backoff_until.clear();
                state.consecutive_errors = 0;
            }
            drop(all);
            self.persist_global_hide();
        }
        self.global_hide_status()
    }

    /// Step 1 of the explicit unblock action: list the app-made blocks and
    /// return a short-lived token that must be confirmed.
    pub fn global_hide_unblock_preview(&self) -> Result<GlobalHideUnblockPreview, String> {
        let scope = self.auth.snapshot();
        if !scope.active {
            return Err("Sign in first".into());
        }
        let ids: Vec<String> = self
            .global_hide
            .lock()
            .unwrap()
            .get(&scope.current_user_id)
            .map(|state| state.blocked_by_app.iter().cloned().collect())
            .unwrap_or_default();
        let token = format!("{}-{}", scope.generation, Utc::now().timestamp_micros());
        *self.unblock_review.lock().unwrap() =
            Some((token.clone(), scope.current_user_id.clone(), Instant::now()));
        Ok(GlobalHideUnblockPreview {
            token,
            account_user_id: scope.current_user_id,
            ids,
        })
    }

    /// Step 2: start unblocking every app-made block (throttled like blocking).
    pub fn global_hide_unblock_start(&self, token: &str) -> Result<GlobalHideStatus, String> {
        let scope = self.auth.snapshot();
        let review = self.unblock_review.lock().unwrap().take();
        let valid = review.is_some_and(|(expected, account, created)| {
            expected == token && account == scope.current_user_id && created.elapsed() < REVIEW_TTL
        });
        if !valid || !scope.active {
            return Err("Review the unblock list again; it expired or the account changed".into());
        }
        let ids: Vec<String> = self
            .global_hide
            .lock()
            .unwrap()
            .get(&scope.current_user_id)
            .map(|state| state.blocked_by_app.iter().cloned().collect())
            .unwrap_or_default();
        *self.unblock_queue.lock().unwrap() =
            (!ids.is_empty()).then(|| (scope.current_user_id.clone(), ids));
        Ok(self.global_hide_status())
    }

    pub fn global_hide_unblock_cancel(&self) -> GlobalHideStatus {
        *self.unblock_queue.lock().unwrap() = None;
        *self.unblock_review.lock().unwrap() = None;
        self.global_hide_status()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_grows_and_caps_then_waits_for_the_next_day() {
        let parse = |value: String| {
            chrono::DateTime::parse_from_rfc3339(&value)
                .unwrap()
                .with_timezone(&Utc)
        };
        let now = Utc::now();
        let first = parse(backoff_until(1)) - now;
        assert!((290..=310).contains(&first.num_seconds()));
        let third = parse(backoff_until(3)) - now;
        assert!((1190..=1210).contains(&third.num_seconds()));
        let capped = parse(backoff_until(4)) - now;
        assert!(capped.num_seconds() <= BACKOFF_MAX_SECS + 5);
        let stopped = parse(backoff_until(MAX_CONSECUTIVE_ERRORS));
        assert_eq!(
            stopped.date_naive(),
            now.date_naive() + chrono::Days::new(1)
        );
    }

    #[test]
    fn new_day_resets_the_daily_count_and_error_stop() {
        let mut state = GlobalHideAccountState {
            day: "2000-01-01".into(),
            day_count: DAILY_CAP,
            consecutive_errors: MAX_CONSECUTIVE_ERRORS,
            ..Default::default()
        };
        roll_day(&mut state);
        assert_eq!(state.day, today());
        assert_eq!(state.day_count, 0);
        assert_eq!(state.consecutive_errors, 0);
    }

    #[test]
    fn jitter_stays_within_bounds() {
        let interval = jittered_interval();
        assert!(interval >= MIN_INTERVAL);
        assert!(interval < MIN_INTERVAL + Duration::from_millis(MAX_JITTER_MS));
    }
}
