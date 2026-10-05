//! Local watchlists and opt-in community lists. Observed URLs are never fetched.
use std::collections::{BTreeSet, HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::Utc;
use serde_json::{json, Value};
use vrcx_0_application::remote::VrchatApiRuntime;
use vrcx_0_application_activity::ActivityRouter;
use vrcx_0_application_core::vrchat_api::VrchatScope;
use vrcx_0_application_core::{RuntimeAuthScope, RuntimeAuthScopeSnapshot, TaskSupervisor};
use vrcx_0_application_game::{GameLogEventOrigin, GameLogEventSink, GameLogScanCursor};
use vrcx_0_contracts::activity::{ActivityEvent, ActivityKind};
use vrcx_0_core::game_log_parser::{GameLogEvent, GameLogEventKind};
use vrcx_0_persistence::config::ConfigRepository;

mod avatar_blocks;
mod global_hide;
mod log_badges;
mod model;
pub use model::*;
#[cfg(test)]
mod tests;

struct State {
    settings: SafetySettings,
    caches: Vec<SourceCache>,
    audit: VecDeque<SafetyAuditEntry>,
    global_hide_audit: VecDeque<SafetyAuditEntry>,
    location: String,
    epoch: u64,
    generation: u64,
    players: HashMap<String, (String, u64)>,
    avatars: HashMap<String, String>,
    revision: u64,
    policy_revision: u64,
    seen: HashMap<String, Instant>,
    /// Fork: (epoch, user id, source id) already warned about this instance visit.
    warned_present: std::collections::HashSet<(u64, String, String)>,
    dropped: u32,
    avatar_review: Option<avatar_blocks::AvatarReview>,
}

#[derive(Clone)]
pub(crate) struct SafetyJob {
    queued_at: Instant,
    scope: RuntimeAuthScopeSnapshot,
    epoch: u64,
    player_revision: u64,
    policy_revision: u64,
    is_join: bool,
    location: String,
    created_at: String,
    user_id: String,
    display_name: String,
    avatar_name: String,
    url: String,
    log_kind: String,
    avatar_id: String,
}

pub struct SafetyRuntime {
    config: ConfigRepository,
    db: Arc<vrcx_0_persistence::DatabaseService>,
    auth: RuntimeAuthScope,
    overlay: ActivityRouter,
    state: Mutex<State>,
    sender: tokio::sync::mpsc::Sender<SafetyJob>,
    refresh_lock: tokio::sync::Mutex<()>,
    api: std::sync::OnceLock<(
        VrchatApiRuntime,
        vrcx_0_application::avatars::AvatarModerationRuntime,
    )>,
    block_lock: tokio::sync::Mutex<()>,
    block_revision: std::sync::atomic::AtomicU64,
    /// Fork: `<data dir>/community-lists`, local mirrors of GitHub-hosted lists.
    mirror_root: Option<std::path::PathBuf>,
    /// Fork: last upstream HEAD check per source (in memory, so launch always checks).
    head_checks: Mutex<HashMap<String, Instant>>,
    /// Fork: global-hide progress per account (persisted in `GLOBAL_HIDE_KEY`).
    global_hide: Mutex<HashMap<String, GlobalHideAccountState>>,
    /// Fork: the account's own existing avatar blocks (account, fetched at, ids).
    existing_avatar_blocks: Mutex<Option<(String, Instant, BTreeSet<String>)>>,
    /// Fork: user-started unblock job (account, remaining ids) and its pending review token.
    unblock_queue: Mutex<Option<(String, Vec<String>)>>,
    unblock_review: Mutex<Option<(String, String, Instant)>>,
}

impl SafetyRuntime {
    pub(crate) fn new(
        config: ConfigRepository,
        db: Arc<vrcx_0_persistence::DatabaseService>,
        auth: RuntimeAuthScope,
        overlay: ActivityRouter,
    ) -> (Arc<Self>, tokio::sync::mpsc::Receiver<SafetyJob>) {
        let mut settings: SafetySettings = config
            .get_json(SETTINGS_KEY, json!({}))
            .ok()
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();
        if settings.validate().is_err() {
            settings = SafetySettings::default();
        }
        let caches = config
            .get_json(CACHE_KEY, json!([]))
            .ok()
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();
        let mut audit: VecDeque<SafetyAuditEntry> = config
            .get_json(AUDIT_KEY, json!([]))
            .ok()
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();
        let mut global_hide_audit: VecDeque<SafetyAuditEntry> = config
            .get_json(GLOBAL_HIDE_AUDIT_KEY, json!([]))
            .ok()
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();
        // Fork: move global-hide entries written before the split out of the alert history.
        let (moved, kept): (Vec<_>, Vec<_>) = audit
            .drain(..)
            .partition(|entry| is_global_hide_action(&entry.action));
        audit.extend(kept);
        if !moved.is_empty() {
            for entry in moved.into_iter().rev() {
                global_hide_audit.push_front(entry);
            }
            while global_hide_audit.len() > AUDIT_LIMIT {
                global_hide_audit.pop_front();
            }
            for (key, entries) in [
                (AUDIT_KEY, &audit),
                (GLOBAL_HIDE_AUDIT_KEY, &global_hide_audit),
            ] {
                if let Ok(value) = serde_json::to_value(entries) {
                    let _ = config.set_json(key, &value);
                }
            }
        }
        let global_hide = config
            .get_json(GLOBAL_HIDE_KEY, json!({}))
            .ok()
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();
        let (sender, receiver) = tokio::sync::mpsc::channel(1024);
        let mirror_root = db.db_path().parent().map(|dir| dir.join("community-lists"));
        (
            Arc::new(Self {
                config,
                db,
                auth,
                overlay,
                state: Mutex::new(State {
                    settings,
                    caches,
                    audit,
                    global_hide_audit,
                    location: String::new(),
                    epoch: 0,
                    generation: 0,
                    players: HashMap::new(),
                    avatars: HashMap::new(),
                    revision: 0,
                    policy_revision: 0,
                    seen: HashMap::new(),
                    warned_present: std::collections::HashSet::new(),
                    dropped: 0,
                    avatar_review: None,
                }),
                sender,
                refresh_lock: tokio::sync::Mutex::new(()),
                api: std::sync::OnceLock::new(),
                block_lock: tokio::sync::Mutex::new(()),
                block_revision: std::sync::atomic::AtomicU64::new(0),
                mirror_root,
                head_checks: Mutex::new(HashMap::new()),
                global_hide: Mutex::new(global_hide),
                existing_avatar_blocks: Mutex::new(None),
                unblock_queue: Mutex::new(None),
                unblock_review: Mutex::new(None),
            }),
            receiver,
        )
    }

    pub fn settings(&self) -> SafetySettings {
        self.state.lock().unwrap().settings.clone()
    }

    pub fn save_settings(&self, mut settings: SafetySettings) -> Result<SafetySettings, String> {
        let mut state = self.state.lock().unwrap();
        self.save_locked(&mut state, &mut settings)
    }

    fn save_locked(
        &self,
        state: &mut State,
        settings: &mut SafetySettings,
    ) -> Result<SafetySettings, String> {
        settings.validate()?;
        self.config
            .set_json(
                SETTINGS_KEY,
                &serde_json::to_value(&settings).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
        state.settings = settings.clone();
        // A source URL/format change must never reuse the previous source's data.
        state.caches.retain(|cache| {
            settings
                .sources
                .iter()
                .any(|source| cache_matches(cache, source))
        });
        state.seen.clear();
        state.policy_revision += 1;
        Ok(settings.clone())
    }

    pub fn set_watch(
        &self,
        kind: &str,
        id: String,
        label: String,
        enabled: bool,
    ) -> Result<SafetySettings, String> {
        let mut state = self.state.lock().unwrap();
        let mut settings = state.settings.clone();
        let id = id.trim().to_ascii_lowercase();
        let entries = match kind {
            "group" => &mut settings.groups,
            "avatar" => &mut settings.avatars,
            _ => return Err("Unknown watchlist kind".into()),
        };
        entries.retain(|entry| entry.id != id);
        if enabled {
            entries.push(WatchEntry {
                id,
                label,
                enabled: true,
            });
        }
        self.save_locked(&mut state, &mut settings)
    }

    /// Fork: avatar names seen in the log for players currently in the instance
    /// (display name, avatar name). Names only; IDs are never known from the log.
    pub fn instance_avatars(&self) -> Vec<InstanceAvatar> {
        let state = self.state.lock().unwrap();
        let mut avatars: Vec<InstanceAvatar> = state
            .avatars
            .iter()
            .filter(|(_, avatar_name)| !avatar_name.trim().is_empty())
            .map(|(display_name, avatar_name)| InstanceAvatar {
                display_name: display_name.clone(),
                avatar_name: avatar_name.clone(),
            })
            .collect();
        avatars.sort_by(|a, b| a.display_name.cmp(&b.display_name));
        avatars
    }

    pub fn entry_sources(&self, kind: &str, id: &str) -> Vec<String> {
        let state = self.state.lock().unwrap();
        if !state.settings.enabled {
            return Vec::new();
        }
        state
            .settings
            .sources
            .iter()
            .filter(|s| {
                s.enabled
                    && s.warn
                    && match kind {
                        "avatar" => matches!(
                            s.format,
                            SourceFormat::AvatarIds | SourceFormat::GithubAvatars
                        ),
                        "user" => s.format == SourceFormat::UserIds,
                        _ => false,
                    }
            })
            .filter(|s| {
                state
                    .caches
                    .iter()
                    .any(|c| cache_matches(c, s) && c.entries.contains(id))
            })
            .map(|s| s.name.clone())
            .collect()
    }

    pub fn status(&self) -> SafetyStatus {
        let state = self.state.lock().unwrap();
        SafetyStatus {
            sources: state
                .settings
                .sources
                .iter()
                .map(|source| {
                    let cache = state
                        .caches
                        .iter()
                        .find(|cache| cache_matches(cache, source));
                    SourceStatus {
                        id: source.id.clone(),
                        count: cache.map_or(0, |c| c.entries.len() as u32),
                        updated_at: cache.map_or_else(String::new, |c| c.updated_at.clone()),
                        error: cache.map_or_else(String::new, |c| c.error.clone()),
                    }
                })
                .collect(),
            audit: state.audit.iter().rev().cloned().collect(),
            global_hide_audit: state.global_hide_audit.iter().rev().cloned().collect(),
            dropped_events: state.dropped,
        }
    }

    pub async fn refresh_sources(&self, force: bool) -> Result<(), String> {
        let _guard = self.refresh_lock.lock().await;
        let settings = self.settings();
        if !settings.enabled {
            return Ok(());
        }
        for source in settings.sources.iter().filter(|s| s.enabled) {
            if let (Some(root), Some(location)) =
                (self.mirror_root.as_ref(), github_location(source))
            {
                self.refresh_github_mirror(source, &location, &root.join(&source.id), force)
                    .await?;
                continue;
            }
            let due = {
                let state = self.state.lock().unwrap();
                let cache = state.caches.iter().find(|c| cache_matches(c, source));
                force
                    || cache.is_none_or(|c| {
                        let timestamp = if c.error.is_empty() {
                            &c.updated_at
                        } else {
                            &c.last_attempt
                        };
                        chrono::DateTime::parse_from_rfc3339(timestamp).map_or(true, |time| {
                            (Utc::now() - time.with_timezone(&Utc)).num_seconds()
                                >= if c.error.is_empty() { 86400 } else { 3600 }
                        })
                    })
            };
            if !due {
                continue;
            }
            let result = tokio::time::timeout(Duration::from_secs(60), fetch_source(source))
                .await
                .unwrap_or_else(|_| Err("List refresh exceeded 60 seconds".into()));
            let mut state = self.state.lock().unwrap();
            if !state.settings.enabled
                || !state
                    .settings
                    .sources
                    .iter()
                    .any(|s| s == source && s.enabled)
            {
                continue;
            }
            let mut cache = state
                .caches
                .iter()
                .find(|c| cache_matches(c, source))
                .cloned()
                .unwrap_or_else(|| SourceCache {
                    source_id: source.id.clone(),
                    url: source.url.clone(),
                    format: source.format,
                    ..Default::default()
                });
            cache.last_attempt = now();
            match result {
                Ok(entries) => {
                    cache.entries = entries;
                    cache.updated_at = now();
                    cache.error.clear();
                }
                Err(error) => cache.error = error,
            }
            state.caches.retain(|c| c.source_id != source.id);
            state.caches.push(cache);
            self.config
                .set_json(
                    CACHE_KEY,
                    &serde_json::to_value(&state.caches).map_err(|e| e.to_string())?,
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Fork: GitHub-hosted lists are read from a local mirror. On launch and at
    /// most hourly, check upstream HEAD (ETag, so unchanged repos are cheap);
    /// when it moved, download that commit and swap the mirror. Failures keep
    /// the previous mirror and cached entries.
    async fn refresh_github_mirror(
        &self,
        source: &SafetySource,
        location: &GithubLocation,
        mirror: &std::path::Path,
        force: bool,
    ) -> Result<(), String> {
        use vrcx_0_integrations::github_mirror::{
            github_head, mirror_commit, update_mirror, HeadCheck,
        };
        let due = force
            || self
                .head_checks
                .lock()
                .unwrap()
                .get(&source.id)
                .is_none_or(|checked| checked.elapsed() >= Duration::from_secs(3600));
        if !due {
            return Ok(());
        }
        self.head_checks
            .lock()
            .unwrap()
            .insert(source.id.clone(), Instant::now());
        let (cached_sha, cached_etag, cache_empty) = {
            let state = self.state.lock().unwrap();
            state
                .caches
                .iter()
                .find(|cache| cache_matches(cache, source))
                .map(|cache| {
                    (
                        cache.commit_sha.clone(),
                        cache.etag.clone(),
                        cache.entries.is_empty(),
                    )
                })
                .unwrap_or_default()
        };
        let local_sha = mirror_commit(mirror);
        // Only send the ETag when the mirror on disk is the commit it describes.
        let etag = (local_sha.as_deref() == Some(cached_sha.as_str()) && !cached_sha.is_empty())
            .then_some(cached_etag.as_str());
        let head = tokio::time::timeout(
            Duration::from_secs(30),
            github_head(&location.owner, &location.repo, etag),
        )
        .await
        .unwrap_or_else(|_| Err("GitHub HEAD check exceeded 30 seconds".into()));
        let (sha, new_etag) = match head {
            Ok(HeadCheck::NotModified) => (cached_sha.clone(), cached_etag.clone()),
            Ok(HeadCheck::Commit { sha, etag }) => (sha, etag.unwrap_or_default()),
            Err(error) => {
                // Offline or rate limited: keep using whatever mirror exists.
                let entries = match (&local_sha, cache_empty) {
                    (Some(local), true) => parse_mirror(mirror, location, source.format)
                        .map(|entries| Some((entries, local.clone()))),
                    _ => Ok(None),
                };
                return self.store_mirror_cache(source, entries, &cached_etag, Some(error));
            }
        };
        if mirror_commit(mirror).as_deref() != Some(sha.as_str()) {
            let updated = tokio::time::timeout(
                Duration::from_secs(120),
                update_mirror(&location.owner, &location.repo, &sha, mirror),
            )
            .await
            .unwrap_or_else(|_| Err("Mirror download exceeded 120 seconds".into()));
            if let Err(error) = updated {
                return self.store_mirror_cache(source, Ok(None), &cached_etag, Some(error));
            }
        } else if !cache_empty && cached_sha == sha {
            // Up to date: nothing to parse, just remember the check.
            return self.store_mirror_cache(source, Ok(None), &new_etag, None);
        }
        let entries =
            parse_mirror(mirror, location, source.format).map(|entries| Some((entries, sha)));
        self.store_mirror_cache(source, entries, &new_etag, None)
    }

    fn store_mirror_cache(
        &self,
        source: &SafetySource,
        entries: Result<Option<(BTreeSet<String>, String)>, String>,
        etag: &str,
        error: Option<String>,
    ) -> Result<(), String> {
        let mut state = self.state.lock().unwrap();
        if !state.settings.enabled
            || !state
                .settings
                .sources
                .iter()
                .any(|s| s == source && s.enabled)
        {
            return Ok(());
        }
        let mut cache = state
            .caches
            .iter()
            .find(|c| cache_matches(c, source))
            .cloned()
            .unwrap_or_else(|| SourceCache {
                source_id: source.id.clone(),
                url: source.url.clone(),
                format: source.format,
                ..Default::default()
            });
        cache.last_attempt = now();
        cache.etag = etag.to_string();
        match entries {
            Ok(Some((entries, sha))) => {
                cache.entries = entries;
                cache.commit_sha = sha;
                cache.updated_at = now();
                cache.error = error.unwrap_or_default();
            }
            Ok(None) => match error {
                Some(error) => cache.error = error,
                // A confirmed-unchanged upstream is a successful refresh; without this an
                // inactive repo ages past the freshness window and disables reviews.
                None => {
                    cache.updated_at = now();
                    cache.error.clear();
                }
            },
            Err(parse_error) => cache.error = parse_error,
        }
        state.caches.retain(|c| c.source_id != source.id);
        state.caches.push(cache);
        self.config
            .set_json(
                CACHE_KEY,
                &serde_json::to_value(&state.caches).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())
    }

    pub(crate) fn start(
        self: &Arc<Self>,
        mut receiver: tokio::sync::mpsc::Receiver<SafetyJob>,
        tasks: &TaskSupervisor,
        api: VrchatApiRuntime,
        moderation: vrcx_0_application::avatars::AvatarModerationRuntime,
    ) {
        let _ = self.api.set((api.clone(), moderation));
        let runtime = Arc::clone(self);
        tasks.spawn_cancellable(move |stop| async move {
            let mut memberships: HashMap<String, (Instant, Vec<String>)> = HashMap::new();
            let mut generation = 0;
            loop {
                if stop.is_stop_requested() { break; }
                tokio::select! {
                    job = receiver.recv() => match job {
                        Some(job) => {
                            if generation != job.scope.generation { memberships.clear(); generation = job.scope.generation; }
                            runtime.check(job, &api, &mut memberships).await;
                        }, None => break,
                    },
                    _ = tokio::time::sleep(Duration::from_secs(1)) => {},
                }
            }
        });
        let runtime = Arc::clone(self);
        tasks.spawn_cancellable(move |stop| async move {
            let mut ticks = 0;
            while !stop.is_stop_requested() {
                if ticks % 60 == 0 {
                    if let Err(error) = runtime.refresh_sources(false).await {
                        tracing::warn!(%error, "safety list refresh failed");
                    }
                    runtime.warn_present_players();
                }
                ticks += 1;
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        });
        let runtime = Arc::clone(self);
        tasks.spawn_cancellable(move |stop| async move {
            // Fork: throttled global-hide worker; one request at a time.
            let mut next = Instant::now() + Duration::from_secs(30);
            while !stop.is_stop_requested() {
                if Instant::now() >= next {
                    next = Instant::now() + runtime.global_hide_step().await;
                }
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        });
    }

    /// Fork: warn (never act) about listed players who were already in the
    /// instance when the app started or when a list gained them. Live joins
    /// are handled in `check`; each player is warned once per source and visit.
    fn warn_present_players(&self) {
        let scope = self.auth.snapshot();
        let settings = self.settings();
        if !scope.active || !settings.enabled {
            return;
        }
        let pending: Vec<(SafetyJob, String)> = {
            let mut state = self.state.lock().unwrap();
            if state.location.is_empty() {
                return;
            }
            let epoch = state.epoch;
            state
                .warned_present
                .retain(|(warned, _, _)| *warned == epoch);
            let mut pending = Vec::new();
            for source in settings
                .sources
                .iter()
                .filter(|s| s.enabled && s.warn && s.format == SourceFormat::UserIds)
            {
                let Some(cache) = state.caches.iter().find(|c| cache_matches(c, source)) else {
                    continue;
                };
                for (user_id, (display_name, revision)) in &state.players {
                    let key = (epoch, user_id.clone(), source.id.clone());
                    if !cache.entries.contains(user_id) || state.warned_present.contains(&key) {
                        continue;
                    }
                    let job = SafetyJob {
                        queued_at: Instant::now(),
                        scope: scope.clone(),
                        epoch,
                        player_revision: *revision,
                        policy_revision: state.policy_revision,
                        is_join: false,
                        location: state.location.clone(),
                        created_at: now(),
                        user_id: user_id.clone(),
                        display_name: display_name.clone(),
                        avatar_name: String::new(),
                        url: String::new(),
                        log_kind: "Present".into(),
                        avatar_id: String::new(),
                    };
                    pending.push((key, job, source.name.clone()));
                }
            }
            pending
                .into_iter()
                .map(|(key, job, name)| {
                    state.warned_present.insert(key);
                    (job, name)
                })
                .collect()
        };
        for (job, source_name) in pending {
            let message = format!(
                "{} appears in {} (community claim; verify before acting).",
                job.display_name, source_name
            );
            self.notice(&job, &settings, "SafetyCommunity", &source_name, message);
        }
    }

    fn observe(&self, events: &[GameLogEvent], origin: GameLogEventOrigin) {
        let scope = self.auth.snapshot();
        let mut state = self.state.lock().unwrap();
        if state.generation != scope.generation {
            state.generation = scope.generation;
            state.seen.clear();
            state.epoch += 1;
        }
        for event in events {
            match &event.kind {
                GameLogEventKind::Location { location, .. } => {
                    if state.location != *location {
                        state.location = location.clone();
                        state.players.clear();
                        state.avatars.clear();
                        state.epoch += 1;
                        state.seen.clear();
                    }
                }
                GameLogEventKind::VrcQuit => {
                    state.players.clear();
                    state.avatars.clear();
                    state.location.clear();
                    state.epoch += 1;
                }
                GameLogEventKind::PlayerJoined {
                    user_id,
                    display_name,
                } => {
                    if valid_id(user_id, "usr_") {
                        state.revision += 1;
                        let revision = state.revision;
                        state
                            .players
                            .insert(user_id.clone(), (display_name.clone(), revision));
                    }
                }
                GameLogEventKind::PlayerLeft {
                    user_id,
                    display_name,
                } => {
                    if user_id.is_empty() {
                        state.players.retain(|_, (name, _)| name != display_name);
                    } else {
                        state.players.remove(user_id);
                    }
                    state.avatars.remove(display_name);
                }
                GameLogEventKind::AvatarChange {
                    display_name,
                    avatar_name,
                } => {
                    if state.avatars.len() > 2048 {
                        state.avatars.clear();
                    }
                    state
                        .avatars
                        .insert(display_name.clone(), avatar_name.clone());
                }
                _ => {}
            }
            if origin != GameLogEventOrigin::Live || !scope.active || !state.settings.enabled {
                continue;
            }
            let mut job = SafetyJob {
                queued_at: Instant::now(),
                scope: scope.clone(),
                epoch: state.epoch,
                player_revision: 0,
                policy_revision: state.policy_revision,
                is_join: false,
                location: state.location.clone(),
                created_at: event.created_at.clone(),
                user_id: String::new(),
                display_name: String::new(),
                avatar_name: String::new(),
                url: String::new(),
                avatar_id: String::new(),
                log_kind: match &event.kind {
                    GameLogEventKind::PlayerJoined { .. } => "OnPlayerJoined",
                    GameLogEventKind::AvatarChange { .. } => "AvatarChange",
                    GameLogEventKind::VideoPlay { .. } => "VideoPlay",
                    GameLogEventKind::ResourceLoad { resource_type, .. }
                        if resource_type == "image" =>
                    {
                        "ImageLoad"
                    }
                    GameLogEventKind::ResourceLoad { .. } => "StringLoad",
                    _ => "Event",
                }
                .into(),
            };
            match &event.kind {
                GameLogEventKind::PlayerJoined {
                    user_id,
                    display_name,
                } => {
                    job.user_id = user_id.clone();
                    job.display_name = display_name.clone();
                    job.is_join = true;
                    if state
                        .players
                        .values()
                        .filter(|(name, _)| name == display_name)
                        .count()
                        == 1
                    {
                        job.avatar_name =
                            state.avatars.get(display_name).cloned().unwrap_or_default();
                    }
                }
                GameLogEventKind::AvatarChange {
                    display_name,
                    avatar_name,
                } => {
                    let matches: Vec<_> = state
                        .players
                        .iter()
                        .filter(|(_, (name, _))| name == display_name)
                        .collect();
                    if matches.len() != 1 {
                        continue;
                    }
                    job.user_id = matches[0].0.clone();
                    job.display_name = display_name.clone();
                    job.avatar_name = avatar_name.clone();
                }
                GameLogEventKind::VideoPlay {
                    video_url,
                    display_name,
                } => {
                    job.url = video_url.clone();
                    job.display_name = display_name.clone();
                }
                GameLogEventKind::ResourceLoad { resource_url, .. } => {
                    job.url = resource_url.clone();
                }
                GameLogEventKind::ApiRequest { url } => {
                    job.url = url.clone();
                }
                GameLogEventKind::Event { data } | GameLogEventKind::Vrcx { data }
                    if data.starts_with("VideoURL:")
                        || data.starts_with("VideoError:")
                        || data.starts_with("VideoPlay(") =>
                {
                    for url in logged_urls(data) {
                        let mut url_job = job.clone();
                        url_job.url = url;
                        if self.sender.try_send(url_job).is_err() {
                            state.dropped = state.dropped.saturating_add(1);
                        }
                    }
                    continue;
                }
                _ => continue,
            }
            job.player_revision = state
                .players
                .get(&job.user_id)
                .map_or(0, |(_, revision)| *revision);
            if self.sender.try_send(job).is_err() {
                state.dropped = state.dropped.saturating_add(1);
            }
        }
    }

    fn current(&self, job: &SafetyJob, settings: &SafetySettings) -> bool {
        if job.queued_at.elapsed() > Duration::from_secs(120)
            || !self.auth.snapshot().generation_matches(&job.scope)
        {
            return false;
        }
        let state = self.state.lock().unwrap();
        state.policy_revision == job.policy_revision
            && state.settings == *settings
            && settings.enabled
            && state.epoch == job.epoch
            && state.location == job.location
            && (job.user_id.is_empty()
                || state
                    .players
                    .get(&job.user_id)
                    .is_some_and(|(_, revision)| *revision == job.player_revision))
    }

    fn notice(
        &self,
        job: &SafetyJob,
        settings: &SafetySettings,
        kind: &str,
        source: &str,
        message: String,
    ) {
        if !self.current(job, settings) {
            return;
        }
        let key = format!("{}:{}:{kind}:{source}:{message}", job.epoch, job.user_id);
        {
            let mut state = self.state.lock().unwrap();
            state
                .seen
                .retain(|_, time| time.elapsed() < Duration::from_secs(300));
            if state.seen.contains_key(&key) {
                return;
            }
            if state.seen.len() >= 10_000 {
                state.seen.clear();
            }
            state.seen.insert(key.clone(), Instant::now());
        }
        self.record(job, kind, source, &message, "warn", "shown");
        let Some(kind) = ActivityKind::from_key(kind) else {
            return;
        };
        let mut event = ActivityEvent::new(
            kind,
            format!("safety:{}:{key}", now()),
            job.created_at.clone(),
        );
        event.in_current_instance = true;
        event.actor.user_id = job.user_id.clone();
        event.actor.display_name = job.display_name.clone();
        event.facts.title = "Safety warning".to_string();
        event.facts.message = message.to_string();
        event.facts.location = job.location.clone();
        self.overlay.ingest(event);
    }

    fn record(
        &self,
        job: &SafetyJob,
        kind: &str,
        source: &str,
        message: &str,
        action: &str,
        outcome: &str,
    ) {
        self.record_entry(false, job, kind, source, message, action, outcome);
    }

    /// Fork: global-hide progress goes to its own history (see `GLOBAL_HIDE_AUDIT_KEY`).
    fn record_global_hide(
        &self,
        job: &SafetyJob,
        source: &str,
        message: &str,
        action: &str,
        outcome: &str,
    ) {
        self.record_entry(
            true,
            job,
            "SafetyCommunity",
            source,
            message,
            action,
            outcome,
        );
    }

    #[allow(clippy::too_many_arguments)]
    fn record_entry(
        &self,
        global_hide: bool,
        job: &SafetyJob,
        kind: &str,
        source: &str,
        message: &str,
        action: &str,
        outcome: &str,
    ) {
        let mut state = self.state.lock().unwrap();
        let (audit, key) = if global_hide {
            (&mut state.global_hide_audit, GLOBAL_HIDE_AUDIT_KEY)
        } else {
            (&mut state.audit, AUDIT_KEY)
        };
        audit.push_back(SafetyAuditEntry {
            account_user_id: job.scope.current_user_id.clone(),
            event_created_at: job.created_at.clone(),
            location: job.location.clone(),
            log_kind: job.log_kind.clone(),
            avatar_id: job.avatar_id.clone(),
            created_at: now(),
            event_type: kind.into(),
            user_id: job.user_id.clone(),
            source: source.into(),
            message: message.into(),
            action: action.into(),
            outcome: outcome.into(),
        });
        while audit.len() > AUDIT_LIMIT {
            audit.pop_front();
        }
        if let Ok(value) = serde_json::to_value(&*audit) {
            if let Err(error) = self.config.set_json(key, &value) {
                tracing::warn!(%error, "failed to persist safety history");
            }
        }
    }

    async fn check(
        &self,
        mut job: SafetyJob,
        api: &VrchatApiRuntime,
        memberships: &mut HashMap<String, (Instant, Vec<String>)>,
    ) {
        let settings = self.settings();
        if !self.current(&job, &settings) {
            return;
        }
        if !job.url.is_empty() {
            if settings.url_warnings {
                let matched = log_badges::url_match(&self.state.lock().unwrap(), &job.url);
                if let Some((host, shortened)) = matched {
                    let who = if job.display_name.is_empty() {
                        String::new()
                    } else {
                        format!("Queued by {}. ", job.display_name)
                    };
                    let message = if shortened {
                        format!("{who}URL shortener {host}: destination is unknown. URL was not opened.")
                    } else {
                        format!("{who}Potential IP-logger domain {host} in a game URL. URL was not opened.")
                    };
                    self.notice(&job, &settings, "SafetyUrl", &host, message);
                }
            }
            return;
        }
        // The own-avatar endpoint is the available authoritative ID source. Never query it
        // for another player, infer an ID from an image URL, or trust ID-looking name text.
        if job.user_id == job.scope.current_user_id
            && !job.avatar_name.is_empty()
            && (settings.avatars.iter().any(|entry| entry.enabled)
                || settings.sources.iter().any(|source| {
                    source.enabled
                        && matches!(
                            source.format,
                            SourceFormat::AvatarIds | SourceFormat::GithubAvatars
                        )
                }))
        {
            if let Ok(avatar) = request(
                self,
                api,
                &job,
                &settings,
                ("GET", format!("users/{}/avatar", job.user_id), None),
                None,
            )
            .await
            {
                let id = avatar.get("id").and_then(Value::as_str).unwrap_or_default();
                if valid_id(id, "avtr_")
                    && avatar.get("name").and_then(Value::as_str) == Some(job.avatar_name.as_str())
                {
                    job.avatar_id = id.to_string();
                }
            }
        }
        let avatar_ids = if !job.avatar_id.is_empty() {
            vec![job.avatar_id.clone()]
        } else if job.avatar_name.is_empty() {
            Vec::new()
        } else {
            vrcx_0_persistence::avatars::avatar_cache_ids_by_name(&self.db, &job.avatar_name)
                .unwrap_or_default()
        };
        let sources: Vec<(SafetySource, bool, bool, bool)> = {
            let state = self.state.lock().unwrap();
            settings
                .sources
                .iter()
                .filter(|s| s.enabled)
                .filter_map(|source| {
                    let cache = state.caches.iter().find(|c| cache_matches(c, source))?;
                    let fresh = cache_is_fresh(cache);
                    Some((
                        source.clone(),
                        cache.entries.contains(&job.user_id),
                        avatar_ids.iter().any(|id| cache.entries.contains(id)),
                        fresh,
                    ))
                })
                .collect()
        };
        if !valid_id(&job.user_id, "usr_") {
            return;
        }
        for (source, user_match, _, fresh) in &sources {
            if job.is_join && source.format == SourceFormat::UserIds && *user_match {
                let message = format!(
                    "{} appears in {} (community claim; verify before acting).",
                    job.display_name, source.name
                );
                if source.warn {
                    self.state.lock().unwrap().warned_present.insert((
                        job.epoch,
                        job.user_id.clone(),
                        source.id.clone(),
                    ));
                    self.notice(
                        &job,
                        &settings,
                        "SafetyCommunity",
                        &source.name,
                        message.clone(),
                    );
                }
                if *fresh {
                    self.user_actions(&job, &settings, source, api, &message)
                        .await;
                } else if source.block_users || !source.ban_group_ids.is_empty() {
                    self.record(
                        &job,
                        "SafetyCommunity",
                        &source.name,
                        &message,
                        "automatic actions",
                        "skipped: stale or failed list refresh",
                    );
                }
            }
        }
        // VRChat's switch log exposes a display name, not an authoritative avatar ID.
        // Match local API metadata and explicitly configured labels, but never mutate on this evidence.
        if !job.avatar_name.is_empty()
            && self.state.lock().unwrap().avatars.get(&job.display_name) == Some(&job.avatar_name)
        {
            for entry in settings.avatars.iter().filter(|e| e.enabled) {
                if avatar_ids.contains(&entry.id)
                    || (job.avatar_id.is_empty()
                        && !entry.label.is_empty()
                        && entry.label == job.avatar_name)
                {
                    self.notice(
                        &job,
                        &settings,
                        "SafetyAvatar",
                        &entry.id,
                        format!(
                            "{} is wearing watched avatar {}. {}",
                            job.display_name,
                            if entry.label.is_empty() {
                                &entry.id
                            } else {
                                &entry.label
                            },
                            avatar_evidence(&job)
                        ),
                    );
                }
            }
            for (source, _, avatar_match, _) in &sources {
                if matches!(
                    source.format,
                    SourceFormat::AvatarIds | SourceFormat::GithubAvatars
                ) && source.warn
                    && *avatar_match
                {
                    self.notice(
                        &job,
                        &settings,
                        "SafetyCommunity",
                        &source.name,
                        format!(
                            "{} is wearing {}, matching avatar metadata listed by {}. {}",
                            job.display_name,
                            job.avatar_name,
                            source.name,
                            avatar_evidence(&job)
                        ),
                    );
                }
            }
        }
        if job.is_join && settings.groups.iter().any(|e| e.enabled) {
            let groups = match memberships
                .get(&job.user_id)
                .filter(|(time, _)| time.elapsed() < Duration::from_secs(3600))
            {
                Some((_, groups)) => Ok(groups.clone()),
                None => {
                    let result = request(
                        self,
                        api,
                        &job,
                        &settings,
                        ("GET", format!("users/{}/groups", job.user_id), None),
                        None,
                    )
                    .await
                    .map(|v| {
                        v.as_array()
                            .map(|groups| {
                                groups
                                    .iter()
                                    .filter_map(|g| {
                                        g.get("groupId")
                                            .or_else(|| g.get("id"))
                                            .and_then(Value::as_str)
                                            .map(str::to_string)
                                    })
                                    .collect::<Vec<_>>()
                            })
                            .unwrap_or_default()
                    });
                    if let Ok(groups) = &result {
                        if memberships.len() > 2048 {
                            memberships.clear();
                        }
                        memberships.insert(job.user_id.clone(), (Instant::now(), groups.clone()));
                    }
                    result
                }
            };
            match groups {
                Ok(groups) => {
                    for entry in settings
                        .groups
                        .iter()
                        .filter(|e| e.enabled && groups.contains(&e.id))
                    {
                        self.notice(
                            &job,
                            &settings,
                            "SafetyGroup",
                            &entry.id,
                            format!(
                                "{} joined and belongs to watched group {}.",
                                job.display_name,
                                if entry.label.is_empty() {
                                    &entry.id
                                } else {
                                    &entry.label
                                }
                            ),
                        );
                    }
                }
                Err(error) => self.record(
                    &job,
                    "SafetyGroup",
                    "VRChat",
                    "Could not check public group memberships",
                    "lookup",
                    &error,
                ),
            }
        }
    }

    fn source_action_current(&self, source: &SafetySource, job: &SafetyJob) -> bool {
        let state = self.state.lock().unwrap();
        state.caches.iter().any(|cache| {
            cache_matches(cache, source)
                && cache.entries.contains(&job.user_id)
                && cache_is_fresh(cache)
        })
    }

    async fn user_actions(
        &self,
        job: &SafetyJob,
        settings: &SafetySettings,
        source: &SafetySource,
        api: &VrchatApiRuntime,
        message: &str,
    ) {
        if job.user_id == job.scope.current_user_id {
            return;
        }
        let mut actions = Vec::new();
        if source.block_users {
            actions.push((
                "block user".to_string(),
                "auth/user/playermoderations".to_string(),
                json!({"moderated": job.user_id, "type": "block"}),
            ));
        }
        for group_id in &source.ban_group_ids {
            if !self.current(job, settings) {
                return;
            }
            match request(
                self,
                api,
                job,
                settings,
                ("GET", format!("groups/{group_id}"), None),
                None,
            )
            .await
            {
                Ok(group)
                    if group.get("ownerId").and_then(Value::as_str)
                        == Some(&job.scope.current_user_id) =>
                {
                    actions.push((
                        format!("ban from {group_id}"),
                        format!("groups/{group_id}/bans"),
                        json!({"userId": job.user_id}),
                    ))
                }
                _ => self.record(
                    job,
                    "SafetyCommunity",
                    &source.name,
                    message,
                    &format!("ban from {group_id}"),
                    "skipped: ownership not verified",
                ),
            }
        }
        for (action, path, body) in actions {
            if !self.current(job, settings) {
                return;
            }
            let key = format!("action:{}:{}:{action}", job.scope.generation, job.user_id);
            {
                let mut state = self.state.lock().unwrap();
                if state
                    .seen
                    .get(&key)
                    .is_some_and(|time| time.elapsed() < Duration::from_secs(300))
                {
                    continue;
                }
                state.seen.insert(key, Instant::now());
            }
            // Record the attempt first so even a shutdown during the request is visible.
            self.record(
                job,
                "SafetyCommunity",
                &source.name,
                message,
                &action,
                "attempting",
            );
            let result = request(
                self,
                api,
                job,
                settings,
                ("POST", path, Some(body)),
                Some(source),
            )
            .await;
            self.record(
                job,
                "SafetyCommunity",
                &source.name,
                message,
                &action,
                &match result {
                    Ok(_) => "success".into(),
                    Err(error) => format!("failed: {error}"),
                },
            );
        }
    }
}

const AUDIT_LIMIT: usize = 500;

fn is_global_hide_action(action: &str) -> bool {
    matches!(action, "global hide avatar" | "unblock avatar")
}

fn cache_is_fresh(cache: &SourceCache) -> bool {
    cache.error.is_empty()
        && chrono::DateTime::parse_from_rfc3339(&cache.updated_at).is_ok_and(|time| {
            (0..172800).contains(&(Utc::now() - time.with_timezone(&Utc)).num_seconds())
        })
}

/// Fork: where a GitHub-hosted source lives inside its repository.
#[derive(Clone, Debug, PartialEq, Eq)]
struct GithubLocation {
    owner: String,
    repo: String,
    /// Directory (for `GithubAvatars`) or file path inside the repo; "" = root.
    path: String,
}

/// Recognise `api.github.com/repos/{o}/{r}/contents[/dir]` and
/// `raw.githubusercontent.com/{o}/{r}/{ref}/{file}` source URLs.
fn github_location(source: &SafetySource) -> Option<GithubLocation> {
    let url = url::Url::parse(&source.url).ok()?;
    if url.scheme() != "https" {
        return None;
    }
    let segments: Vec<&str> = url.path_segments()?.filter(|s| !s.is_empty()).collect();
    let (owner, repo, path) = match (url.host_str()?, source.format) {
        ("api.github.com", SourceFormat::GithubAvatars) => match segments.as_slice() {
            ["repos", owner, repo, "contents", rest @ ..] => (*owner, *repo, rest.join("/")),
            _ => return None,
        },
        ("raw.githubusercontent.com", format) if format != SourceFormat::GithubAvatars => {
            match segments.as_slice() {
                [owner, repo, _reference, rest @ ..] if !rest.is_empty() => {
                    (*owner, *repo, rest.join("/"))
                }
                _ => return None,
            }
        }
        _ => return None,
    };
    let safe_path = std::path::Path::new(&path)
        .components()
        .all(|component| matches!(component, std::path::Component::Normal(_)));
    safe_path.then(|| GithubLocation {
        owner: owner.to_string(),
        repo: repo.to_string(),
        path,
    })
}

/// Read a source's entries from its local mirror (same limits as the HTTP path).
fn parse_mirror(
    mirror: &std::path::Path,
    location: &GithubLocation,
    format: SourceFormat,
) -> Result<BTreeSet<String>, String> {
    let target = if location.path.is_empty() {
        mirror.to_path_buf()
    } else {
        mirror.join(&location.path)
    };
    if format != SourceFormat::GithubAvatars {
        let text =
            std::fs::read_to_string(&target).map_err(|e| format!("Mirror file missing: {e}"))?;
        return parse_source(&text, format);
    }
    let mut files: Vec<_> = std::fs::read_dir(&target)
        .map_err(|e| format!("Mirror directory missing: {e}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file() && path.extension().and_then(|ext| ext.to_str()) == Some("txt")
        })
        .collect();
    files.sort();
    if files.is_empty() || files.len() > 120 {
        return Err("Avatar directory has no text lists or exceeds 120 files".into());
    }
    let mut all = BTreeSet::new();
    for file in files {
        let text = std::fs::read_to_string(&file).map_err(|e| e.to_string())?;
        all.extend(parse_source(&text, SourceFormat::AvatarIds)?);
        if all.len() > 100_000 {
            return Err("Combined avatar lists exceed 100000 entries".into());
        }
    }
    Ok(all)
}

fn cache_matches(cache: &SourceCache, source: &SafetySource) -> bool {
    cache.source_id == source.id && cache.url == source.url && cache.format == source.format
}
fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

async fn request(
    runtime: &SafetyRuntime,
    api: &VrchatApiRuntime,
    job: &SafetyJob,
    settings: &SafetySettings,
    input: (&str, String, Option<Value>),
    source: Option<&SafetySource>,
) -> Result<Value, String> {
    tokio::time::sleep(Duration::from_millis(350)).await;
    let (method, path, body) = input;
    let scope = &job.scope;
    let request =
        vrcx_0_vrchat_client::http_api::api_input(scope.endpoint.clone(), method, path, body);
    let response = tokio::time::timeout(
        Duration::from_secs(15),
        api.execute_guarded(scope, request, VrchatScope::Vrchat, || {
            runtime.current(job, settings)
                && source.is_none_or(|source| runtime.source_action_current(source, job))
        }),
    )
    .await
    .map_err(|_| "VRChat request timed out")?
    .map_err(|e| e.to_string())?;
    if !(200..300).contains(&response.status) {
        return Err(format!("VRChat returned HTTP {}", response.status));
    }
    if response.data.is_empty() {
        Ok(Value::Null)
    } else {
        serde_json::from_str(&response.data).map_err(|e| e.to_string())
    }
}

async fn fetch_source(source: &SafetySource) -> Result<BTreeSet<String>, String> {
    use vrcx_0_integrations::safety_lists::fetch_safety_list;
    let raw = fetch_safety_list(&source.url).await?;
    if source.format != SourceFormat::GithubAvatars {
        return parse_source(&raw, source.format);
    }
    let files: Vec<Value> =
        serde_json::from_str(&raw).map_err(|_| "Invalid GitHub directory response")?;
    let mut all = BTreeSet::new();
    let files: Vec<_> = files
        .iter()
        .filter(|file| {
            file.get("type").and_then(Value::as_str) == Some("file")
                && file
                    .get("name")
                    .and_then(Value::as_str)
                    .is_some_and(|name| name.ends_with(".txt"))
        })
        .collect();
    if files.is_empty() || files.len() > 120 {
        return Err("Avatar directory has no text lists or exceeds 120 files".into());
    }
    for file in files {
        let url = file
            .get("download_url")
            .and_then(Value::as_str)
            .ok_or("Missing list download URL")?;
        let parsed = url::Url::parse(url).map_err(|_| "Invalid download URL")?;
        if parsed.host_str() != Some("raw.githubusercontent.com") {
            return Err("Unexpected GitHub download host".into());
        }
        all.extend(parse_source(
            &fetch_safety_list(url).await?,
            SourceFormat::AvatarIds,
        )?);
        if all.len() > 100_000 {
            return Err("Combined avatar lists exceed 100000 entries".into());
        }
    }
    Ok(all)
}

pub(crate) struct SafetyLogSink {
    pub inner: Arc<dyn GameLogEventSink>,
    pub safety: Arc<SafetyRuntime>,
}
impl GameLogEventSink for SafetyLogSink {
    fn retry_pending_game_log(&self) -> vrcx_0_application_core::Result<()> {
        self.inner.retry_pending_game_log()
    }
    fn ingest_game_log_event(&self, event: &GameLogEvent) -> vrcx_0_application_core::Result<()> {
        self.ingest_game_log_events_with_origin(
            std::slice::from_ref(event),
            GameLogEventOrigin::Live,
        )
    }
    fn ingest_game_log_events_with_origin(
        &self,
        events: &[GameLogEvent],
        origin: GameLogEventOrigin,
    ) -> vrcx_0_application_core::Result<()> {
        self.inner
            .ingest_game_log_events_with_origin(events, origin)?;
        self.safety.observe(events, origin);
        Ok(())
    }
    fn ingest_game_log_scan(
        &self,
        events: &[GameLogEvent],
        origin: GameLogEventOrigin,
        cursor: GameLogScanCursor,
        publish: bool,
    ) -> vrcx_0_application_core::Result<()> {
        self.inner
            .ingest_game_log_scan(events, origin, cursor, publish)?;
        self.safety.observe(events, origin);
        Ok(())
    }
}

fn avatar_evidence(job: &SafetyJob) -> String {
    if job.avatar_id.is_empty() {
        "Name-only match; avatar ID is unverified.".into()
    } else {
        format!("Own avatar ID confirmed by VRChat API: {}.", job.avatar_id)
    }
}
