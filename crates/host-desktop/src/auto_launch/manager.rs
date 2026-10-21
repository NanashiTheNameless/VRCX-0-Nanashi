use super::{
    launch_entry, normalize_app_launcher_entries, now_timestamp, refresh_runs, scan_startup_folder,
    scope_matches, stop_close_by_vrcx_session, stop_tracked_run, AppLauncherEntry,
    AppLauncherFolderConfig, AppLauncherFolderSource, AppLauncherRun, AppLauncherRunStatus,
    AppLauncherSession, AppLauncherSnapshot, Arc, Duration, HashSet, Mutex,
};

pub struct AutoAppLaunchManager {
    inner: Arc<Mutex<Inner>>,
    changes: tokio::sync::watch::Sender<u64>,
}

impl Clone for AutoAppLaunchManager {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
            changes: self.changes.clone(),
        }
    }
}

pub(super) struct Inner {
    enabled: bool,
    entries: Vec<AppLauncherEntry>,
    folders: Vec<AppLauncherFolderConfig>,
    pub(super) active_session: Option<AppLauncherSession>,
    pub(super) test_runs: Vec<AppLauncherRun>,
    generation: u64,
    next_id: u64,
}

impl AutoAppLaunchManager {
    pub fn new(enabled: bool, entries: Vec<AppLauncherEntry>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                enabled,
                entries: normalize_app_launcher_entries(entries),
                folders: Vec::new(),
                active_session: None,
                test_runs: Vec::new(),
                generation: 0,
                next_id: 0,
            })),
            changes: tokio::sync::watch::channel(0).0,
        }
    }

    pub fn with_folders(self, folders: Vec<AppLauncherFolderConfig>) -> Self {
        self.inner.lock().unwrap().folders = folders;
        self
    }

    pub fn subscribe_changes(&self) -> tokio::sync::watch::Receiver<u64> {
        self.changes.subscribe()
    }

    pub fn has_running_processes(&self) -> bool {
        let inner = self.inner.lock().unwrap();
        inner
            .active_session
            .iter()
            .flat_map(|session| &session.runs)
            .chain(&inner.test_runs)
            .any(|run| {
                matches!(run.status, AppLauncherRunStatus::Running)
                    && (run.root_pid.is_some() || !run.tracked_pids.is_empty())
            })
    }

    fn notify_changed(&self) {
        self.changes.send_modify(|generation| {
            *generation = generation.wrapping_add(1);
        });
    }

    pub fn snapshot(&self) -> AppLauncherSnapshot {
        let mut inner = self.inner.lock().unwrap();
        refresh_runs(&mut inner);
        inner.snapshot()
    }

    pub fn set_enabled(&self, enabled: bool) -> AppLauncherSnapshot {
        let mut delayed = Vec::new();
        let snapshot = {
            let mut inner = self.inner.lock().unwrap();
            inner.generation = inner.generation.saturating_add(1);
            inner.enabled = enabled;
            if enabled {
                reconcile_active_session_entries(&mut inner, self, &mut delayed);
            } else if let Some(session) = inner.active_session.as_mut() {
                session.runs.clear();
            }
            refresh_runs(&mut inner);
            inner.snapshot()
        };
        self.notify_changed();
        spawn_delayed_launches(delayed);
        snapshot
    }

    pub fn set_entries(&self, entries: Vec<AppLauncherEntry>) -> AppLauncherSnapshot {
        let mut delayed = Vec::new();
        let snapshot = {
            let mut inner = self.inner.lock().unwrap();
            inner.generation = inner.generation.saturating_add(1);
            inner.entries = normalize_app_launcher_entries(entries);
            reconcile_active_session_entries(&mut inner, self, &mut delayed);
            refresh_runs(&mut inner);
            inner.snapshot()
        };
        self.notify_changed();
        spawn_delayed_launches(delayed);
        snapshot
    }

    pub fn set_folder_enabled(
        &self,
        source: AppLauncherFolderSource,
        enabled: bool,
    ) -> AppLauncherSnapshot {
        let mut delayed = Vec::new();
        let snapshot = {
            let mut inner = self.inner.lock().unwrap();
            inner.generation = inner.generation.saturating_add(1);
            for folder in inner
                .folders
                .iter_mut()
                .filter(|folder| folder.source == source)
            {
                folder.enabled = enabled;
            }
            reconcile_active_session_entries(&mut inner, self, &mut delayed);
            refresh_runs(&mut inner);
            inner.snapshot()
        };
        self.notify_changed();
        spawn_delayed_launches(delayed);
        snapshot
    }

    pub fn folder_path(&self, source: AppLauncherFolderSource) -> Option<std::path::PathBuf> {
        self.inner
            .lock()
            .unwrap()
            .folders
            .iter()
            .find(|folder| folder.source == source)
            .map(|folder| folder.path.clone())
    }

    pub fn set_entry_enabled<E>(
        &self,
        entry_id: &str,
        enabled: bool,
        persist: impl FnOnce(&[AppLauncherEntry]) -> Result<(), E>,
    ) -> Result<AppLauncherSnapshot, E> {
        let mut delayed = Vec::new();
        let snapshot = {
            let mut inner = self.inner.lock().unwrap();
            let mut entries = inner.entries.clone();
            for entry in entries.iter_mut().filter(|entry| entry.id == entry_id) {
                entry.enabled = enabled;
            }
            persist(&entries)?;
            inner.generation = inner.generation.saturating_add(1);
            inner.entries = entries;
            reconcile_active_session_entries(&mut inner, self, &mut delayed);
            refresh_runs(&mut inner);
            inner.snapshot()
        };
        self.notify_changed();
        spawn_delayed_launches(delayed);
        Ok(snapshot)
    }

    pub fn on_game_started(&self, is_steamvr_running: bool) {
        let mut delayed = Vec::new();
        {
            let mut inner = self.inner.lock().unwrap();
            inner.generation = inner.generation.saturating_add(1);
            let generation = inner.generation;
            let session_id = inner.next_prefixed_id("session");
            let started_at = now_timestamp();
            if !inner.enabled {
                inner.active_session = Some(AppLauncherSession {
                    id: session_id,
                    steamvr_running: is_steamvr_running,
                    started_at,
                    runs: Vec::new(),
                });
                self.notify_changed();
                return;
            }

            stop_close_by_vrcx_session(&mut inner);

            let entries: Vec<AppLauncherEntry> = inner
                .launchable_entries()
                .into_iter()
                .filter(|entry| entry.enabled && scope_matches(entry.scope, is_steamvr_running))
                .collect();

            inner.active_session = Some(AppLauncherSession {
                id: session_id.clone(),
                steamvr_running: is_steamvr_running,
                started_at,
                runs: Vec::new(),
            });

            for entry in entries {
                schedule_session_entry(
                    &mut inner,
                    self,
                    &mut delayed,
                    &session_id,
                    generation,
                    entry,
                );
            }
        }

        self.notify_changed();
        spawn_delayed_launches(delayed);
    }

    pub fn on_game_stopped(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.generation = inner.generation.saturating_add(1);
        stop_close_by_vrcx_session(&mut inner);
        inner.active_session = None;
        drop(inner);
        self.notify_changed();
    }

    pub fn on_steamvr_changed(&self, is_steamvr_running: bool) {
        let mut delayed = Vec::new();
        {
            let mut inner = self.inner.lock().unwrap();
            let needs_reconcile = inner
                .active_session
                .as_ref()
                .is_some_and(|session| session.steamvr_running != is_steamvr_running);
            if !needs_reconcile {
                return;
            }
            inner.generation = inner.generation.saturating_add(1);
            if let Some(session) = inner.active_session.as_mut() {
                session.steamvr_running = is_steamvr_running;
            }
            reconcile_active_session_entries(&mut inner, self, &mut delayed);
            refresh_runs(&mut inner);
        }
        self.notify_changed();
        spawn_delayed_launches(delayed);
    }

    pub fn test_entry(&self, entry_id: &str) -> Result<AppLauncherSnapshot, String> {
        let mut inner = self.inner.lock().unwrap();
        let Some(entry) = inner
            .launchable_entries()
            .into_iter()
            .find(|entry| entry.id == entry_id)
        else {
            return Err(format!("VRChat Startup Apps entry not found: {entry_id}"));
        };

        let run_id = inner.next_prefixed_id("test");
        let mut run = new_run(&run_id, &entry, true);
        launch_entry(&mut run, &entry);
        inner.test_runs.push(run);
        refresh_runs(&mut inner);
        let snapshot = inner.snapshot();
        drop(inner);
        self.notify_changed();
        Ok(snapshot)
    }

    pub fn stop_test_run(&self, run_id: &str) -> Result<AppLauncherSnapshot, String> {
        let mut inner = self.inner.lock().unwrap();
        let Some(run) = inner.test_runs.iter_mut().find(|run| run.id == run_id) else {
            return Err(format!("VRChat Startup Apps test run not found: {run_id}"));
        };
        stop_tracked_run(run);
        refresh_runs(&mut inner);
        let snapshot = inner.snapshot();
        drop(inner);
        self.notify_changed();
        Ok(snapshot)
    }

    #[cfg(test)]
    pub(super) fn set_active_run_tracking_for_test(&self, entry_id: &str, pid: u32) {
        let mut inner = self.inner.lock().unwrap();
        let run = inner
            .active_session
            .as_mut()
            .and_then(|session| session.runs.iter_mut().find(|run| run.entry_id == entry_id))
            .unwrap();
        run.status = AppLauncherRunStatus::Running;
        run.root_pid = Some(pid);
        run.tracked_pids = vec![pid];
        run.finished_at = None;
    }

    fn launch_delayed_session_entry(
        &self,
        session_id: &str,
        run_id: &str,
        entry: AppLauncherEntry,
        generation: u64,
    ) {
        let mut inner = self.inner.lock().unwrap();
        if inner.generation != generation {
            return;
        }
        let Some(session) = inner.active_session.as_ref() else {
            return;
        };
        if session.id != session_id {
            return;
        }
        let Some(run) = find_session_run_mut(&mut inner, run_id) else {
            return;
        };
        launch_entry(run, &entry);
        drop(inner);
        self.notify_changed();
    }
}

struct DelayedLaunch {
    manager: AutoAppLaunchManager,
    session_id: String,
    run_id: String,
    entry: AppLauncherEntry,
    generation: u64,
    delay_seconds: u32,
}

fn spawn_delayed_launches(delayed: Vec<DelayedLaunch>) {
    for launch in delayed {
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(u64::from(launch.delay_seconds)));
            launch.manager.launch_delayed_session_entry(
                &launch.session_id,
                &launch.run_id,
                launch.entry,
                launch.generation,
            );
        });
    }
}

fn schedule_session_entry(
    inner: &mut Inner,
    manager: &AutoAppLaunchManager,
    delayed: &mut Vec<DelayedLaunch>,
    session_id: &str,
    generation: u64,
    entry: AppLauncherEntry,
) {
    let run_id = inner.next_prefixed_id("run");
    let delay = entry.launch_delay_seconds;
    push_session_run(inner, new_run(&run_id, &entry, false));
    if delay == 0 {
        if let Some(run) = find_session_run_mut(inner, &run_id) {
            launch_entry(run, &entry);
        }
    } else if let Some(run) = find_session_run_mut(inner, &run_id) {
        run.status = AppLauncherRunStatus::Waiting;
        delayed.push(DelayedLaunch {
            manager: manager.clone(),
            session_id: session_id.to_string(),
            run_id,
            entry,
            generation,
            delay_seconds: delay,
        });
    }
}

fn reconcile_active_session_entries(
    inner: &mut Inner,
    manager: &AutoAppLaunchManager,
    delayed: &mut Vec<DelayedLaunch>,
) {
    if !inner.enabled {
        if let Some(session) = inner.active_session.as_mut() {
            session.runs.clear();
        }
        return;
    }
    let Some(session) = inner.active_session.as_ref() else {
        return;
    };
    let steamvr_running = session.steamvr_running;
    let session_id = session.id.clone();
    let generation = inner.generation;
    let desired_entries: Vec<AppLauncherEntry> = inner
        .launchable_entries()
        .into_iter()
        .filter(|entry| entry.enabled && scope_matches(entry.scope, steamvr_running))
        .collect();

    if let Some(session) = inner.active_session.as_mut() {
        session.runs.retain_mut(|run| {
            if matches!(run.status, AppLauncherRunStatus::Waiting) {
                return false;
            }
            let Some(entry) = desired_entries
                .iter()
                .find(|entry| entry.id == run.entry_id)
            else {
                return matches!(run.status, AppLauncherRunStatus::Running);
            };
            if run.entry_signature != entry_signature(entry) {
                return matches!(run.status, AppLauncherRunStatus::Running);
            }
            run.entry_name = entry.name.clone();
            run.stop_policy = entry.stop_policy.clone();
            true
        });
    }

    let active_entry_ids: HashSet<String> = inner
        .active_session
        .as_ref()
        .map(|session| {
            session
                .runs
                .iter()
                .filter_map(|run| {
                    desired_entries
                        .iter()
                        .find(|entry| entry.id == run.entry_id)
                        .filter(|entry| run.entry_signature == entry_signature(entry))
                        .map(|_| run.entry_id.clone())
                })
                .collect()
        })
        .unwrap_or_default();

    for entry in desired_entries {
        if !active_entry_ids.contains(&entry.id) {
            schedule_session_entry(inner, manager, delayed, &session_id, generation, entry);
        }
    }
}

impl Inner {
    fn next_prefixed_id(&mut self, prefix: &str) -> String {
        self.next_id = self.next_id.saturating_add(1);
        format!("{prefix}-{}-{}", now_timestamp(), self.next_id)
    }

    fn launchable_entries(&self) -> Vec<AppLauncherEntry> {
        let mut entries = self.entries.clone();
        for folder in self.folders.iter().filter(|folder| folder.enabled) {
            entries.extend(scan_startup_folder(folder.source, &folder.path));
        }
        entries
    }

    fn snapshot(&self) -> AppLauncherSnapshot {
        AppLauncherSnapshot {
            enabled: self.enabled,
            entries: self.entries.clone(),
            folders: self
                .folders
                .iter()
                .map(AppLauncherFolderConfig::snapshot)
                .collect(),
            active_session: self.active_session.clone(),
            test_runs: self.test_runs.clone(),
        }
    }
}

pub(super) fn new_run(id: &str, entry: &AppLauncherEntry, test: bool) -> AppLauncherRun {
    AppLauncherRun {
        id: id.to_string(),
        entry_id: entry.id.clone(),
        entry_name: entry.name.clone(),
        kind: entry.kind.clone(),
        target: entry.target.clone(),
        status: AppLauncherRunStatus::Waiting,
        stop_policy: entry.stop_policy.clone(),
        test,
        root_pid: None,
        tracked_pids: Vec::new(),
        started_at: None,
        finished_at: None,
        error: None,
        os_error_code: None,
        skipped_reason: None,
        entry_signature: entry_signature(entry),
    }
}

pub(super) fn entry_signature(entry: &AppLauncherEntry) -> String {
    format!(
        "{:?}\u{1f}{}\u{1f}{}\u{1f}{}",
        entry.kind,
        entry.target,
        entry.args,
        entry.working_directory.as_deref().unwrap_or_default()
    )
}

fn push_session_run(inner: &mut Inner, run: AppLauncherRun) {
    if let Some(session) = inner.active_session.as_mut() {
        session.runs.push(run);
    }
}

fn find_session_run_mut<'a>(inner: &'a mut Inner, run_id: &str) -> Option<&'a mut AppLauncherRun> {
    inner
        .active_session
        .as_mut()?
        .runs
        .iter_mut()
        .find(|run| run.id == run_id)
}
