use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::future::BoxFuture;
use serde_json::{json, Value};
use tokio::sync::Notify;
use vrcx_0_application_core::sleep_until_due_or_stopped;
use vrcx_0_application_core::RuntimeEventBus;
use vrcx_0_application_core::TaskStopToken;
use vrcx_0_contracts::{background_image as protocol, ConfigMutation};
use vrcx_0_core::time::now_epoch;

use vrcx_0_application_core::{Error, Result};

use super::ProfileConfigStore;

mod helpers;
mod types;

use helpers::{
    assert_selected_files_available, community_theme_appearance_active, current_utc_date_key,
    file_name_from_path, files_source, folder_source, is_snapshot_fresh, mode_as_str,
    normalize_custom_source, normalize_custom_source_struct, normalize_mode,
    normalize_provider_snapshot, projection_update_is_current, random_custom_image_index,
    rotation_delay, DEFAULT_ROTATION_INTERVAL_MINUTES, MAX_ROTATION_INTERVAL_MINUTES,
    MIN_ROTATION_INTERVAL_MINUTES,
};
pub use types::{
    BackgroundImageConfigureInput, BackgroundImageCustomSource, BackgroundImageCustomSourceKind,
    BackgroundImageFileResolver, BackgroundImageMode, BackgroundImageProjection,
    BackgroundImageProviderId, BackgroundImageSnapshot, UnavailableBackgroundImageFileResolver,
};

pub type BackgroundImageRemoteFuture<'a, T> = BoxFuture<'a, Result<T>>;

pub trait BackgroundImageRemote: Send + Sync {
    fn provider_image(
        &self,
        provider_id: BackgroundImageProviderId,
    ) -> BackgroundImageRemoteFuture<'_, protocol::BackgroundImageProviderImage>;
}

#[cfg(test)]
mod tests;

const KEY_ENABLED: &str = "VRCX_backgroundImageEnabled";
const KEY_MODE: &str = "VRCX_backgroundImageMode";
const KEY_PROVIDER_ID: &str = "VRCX_backgroundImageProviderId";
const KEY_SNAPSHOTS: &str = "VRCX_backgroundImageSnapshots";
const KEY_CUSTOM_SOURCE: &str = "VRCX_backgroundImageCustomSource";
const KEY_LEGACY_ENABLED: &str = "VRCX_officialBackgroundEnabled";
const KEY_LEGACY_PROVIDER_ID: &str = "VRCX_officialBackgroundProviderId";
const KEY_LEGACY_SNAPSHOTS: &str = "VRCX_officialBackgroundSnapshots";
const KEY_COMMUNITY_THEME_ENABLED: &str = "VRCX_communityThemeEnabled";
const KEY_COMMUNITY_THEME_ID: &str = "VRCX_communityThemeId";
const KEY_COMMUNITY_THEME_VERSION: &str = "VRCX_communityThemeVersion";
const KEY_COMMUNITY_THEME_INSTALLED_THEMES: &str = "VRCX_communityThemeInstalledThemes";
const KEY_COMMUNITY_THEME_INSTALL_METADATA: &str = "VRCX_communityThemeInstallMetadata";
const KEY_COMMUNITY_THEME_CSS_SNAPSHOT: &str = "VRCX_communityThemeCssSnapshot";

struct BackgroundImageServiceInner {
    config: Arc<dyn ProfileConfigStore>,
    remote: Arc<dyn BackgroundImageRemote>,
    event_bus: RuntimeEventBus,
    resolver: Arc<dyn BackgroundImageFileResolver>,
    projection: Mutex<BackgroundImageProjection>,
    generation: AtomicU64,
    revision: AtomicU64,
    rotation_notify: Notify,
}

#[derive(Clone)]
pub struct BackgroundImageService {
    inner: Arc<BackgroundImageServiceInner>,
}

impl BackgroundImageService {
    pub fn new(
        config: Arc<dyn ProfileConfigStore>,
        remote: Arc<dyn BackgroundImageRemote>,
        event_bus: RuntimeEventBus,
        resolver: Arc<dyn BackgroundImageFileResolver>,
    ) -> Self {
        Self {
            inner: Arc::new(BackgroundImageServiceInner {
                config,
                remote,
                event_bus,
                resolver,
                projection: Mutex::new(BackgroundImageProjection {
                    revision: 0,
                    enabled: false,
                    mode: BackgroundImageMode::Off,
                    provider_id: BackgroundImageProviderId::NasaEpic,
                    custom_source: None,
                    snapshot: None,
                    error: None,
                }),
                generation: AtomicU64::new(0),
                revision: AtomicU64::new(0),
                rotation_notify: Notify::new(),
            }),
        }
    }

    pub fn projection(&self) -> BackgroundImageProjection {
        self.inner.projection.lock().unwrap().clone()
    }

    fn begin_operation(&self) -> u64 {
        self.inner
            .generation
            .fetch_add(1, AtomicOrdering::AcqRel)
            .saturating_add(1)
    }

    fn current_operation(&self) -> u64 {
        self.inner.generation.load(AtomicOrdering::Acquire)
    }

    fn next_revision(&self) -> u64 {
        self.inner
            .revision
            .fetch_add(1, AtomicOrdering::AcqRel)
            .saturating_add(1)
    }

    fn apply_projection(
        &self,
        operation: u64,
        projection: BackgroundImageProjection,
        persist: impl FnOnce(&Self, &BackgroundImageProjection) -> Result<()>,
    ) -> Result<BackgroundImageProjection> {
        self.apply_projection_guarded(operation, None, projection, persist)
    }

    fn apply_projection_guarded(
        &self,
        operation: u64,
        expected_revision: Option<u64>,
        mut projection: BackgroundImageProjection,
        persist: impl FnOnce(&Self, &BackgroundImageProjection) -> Result<()>,
    ) -> Result<BackgroundImageProjection> {
        let mut slot = self.inner.projection.lock().unwrap();
        if !projection_update_is_current(
            self.current_operation(),
            operation,
            slot.revision,
            expected_revision,
        ) {
            return Ok(slot.clone());
        }
        persist(self, &projection)?;
        projection.revision = self.next_revision();
        *slot = projection.clone();
        drop(slot);
        self.inner.event_bus.emit(projection.clone());
        self.inner.rotation_notify.notify_waiters();
        Ok(projection)
    }

    fn persist_state(&self, projection: &BackgroundImageProjection) -> Result<()> {
        self.persist_state_with_mutations(projection, Vec::new(), false)
    }

    fn persist_custom_source(&self, source: Option<&BackgroundImageCustomSource>) -> Result<()> {
        let mutation = match source {
            Some(source) => ConfigMutation::set(
                KEY_CUSTOM_SOURCE,
                serde_json::to_string(source).map_err(|error| Error::Custom(error.to_string()))?,
            ),
            None => ConfigMutation::remove(KEY_CUSTOM_SOURCE),
        };
        self.inner.config.apply_mutations(vec![mutation])
    }

    fn persist_state_with_mutations(
        &self,
        projection: &BackgroundImageProjection,
        mut mutations: Vec<ConfigMutation>,
        include_custom_source: bool,
    ) -> Result<()> {
        mutations.extend([
            ConfigMutation::set(KEY_ENABLED, projection.enabled.to_string()),
            ConfigMutation::set(KEY_MODE, mode_as_str(projection.mode)),
            ConfigMutation::set(KEY_PROVIDER_ID, projection.provider_id.as_str()),
        ]);
        if include_custom_source {
            mutations.push(match projection.custom_source.as_ref() {
                Some(source) => ConfigMutation::set(
                    KEY_CUSTOM_SOURCE,
                    serde_json::to_string(source)
                        .map_err(|error| Error::Custom(error.to_string()))?,
                ),
                None => ConfigMutation::remove(KEY_CUSTOM_SOURCE),
            });
        }
        if projection.enabled {
            mutations.extend([
                ConfigMutation::set(KEY_COMMUNITY_THEME_ENABLED, "false"),
                ConfigMutation::remove(KEY_COMMUNITY_THEME_ID),
                ConfigMutation::remove(KEY_COMMUNITY_THEME_VERSION),
                ConfigMutation::remove(KEY_COMMUNITY_THEME_CSS_SNAPSHOT),
                ConfigMutation::remove(KEY_COMMUNITY_THEME_INSTALL_METADATA),
            ]);
        }
        self.inner.config.apply_mutations(mutations)
    }

    fn load_custom_source(&self) -> Result<Option<BackgroundImageCustomSource>> {
        let value = self.inner.config.get_json(KEY_CUSTOM_SOURCE, Value::Null)?;
        Ok(normalize_custom_source(&value))
    }

    fn load_snapshots(&self) -> Result<Value> {
        let current = self.inner.config.get_raw(KEY_SNAPSHOTS)?;
        let raw = match current {
            Some(raw) => raw,
            None => self.inner.config.get_string(KEY_LEGACY_SNAPSHOTS, "{}")?,
        };
        Ok(serde_json::from_str(&raw).unwrap_or_else(|_| json!({})))
    }

    fn cached_provider_snapshot(
        &self,
        provider_id: BackgroundImageProviderId,
    ) -> Result<Option<BackgroundImageSnapshot>> {
        let snapshots = self.load_snapshots()?;
        Ok(normalize_provider_snapshot(
            snapshots.get(provider_id.as_str()),
            provider_id,
        ))
    }

    async fn fetch_provider_image(
        &self,
        provider_id: BackgroundImageProviderId,
    ) -> Result<protocol::BackgroundImageProviderImage> {
        self.inner.remote.provider_image(provider_id).await
    }

    async fn resolve_provider_snapshot(
        &self,
        provider_id: BackgroundImageProviderId,
        force_refresh: bool,
    ) -> Result<Option<BackgroundImageSnapshot>> {
        let mut snapshots = self.load_snapshots()?;
        let cached = normalize_provider_snapshot(snapshots.get(provider_id.as_str()), provider_id);
        if !force_refresh && is_snapshot_fresh(cached.as_ref()) {
            return Ok(cached);
        }

        match self.fetch_provider_image(provider_id).await {
            Ok(image) => {
                let snapshot = BackgroundImageSnapshot {
                    mode: BackgroundImageMode::Daily,
                    provider_id: Some(provider_id),
                    source_kind: None,
                    image_url: image.image_url,
                    image_path: None,
                    image_count: None,
                    title: image.title,
                    author: image.author,
                    license: image.license,
                    source: image.source,
                    resolved_at: now_epoch(),
                    resolved_for_key: current_utc_date_key(),
                };
                if !snapshots.is_object() {
                    snapshots = json!({});
                }
                snapshots[provider_id.as_str()] = serde_json::to_value(&snapshot)
                    .map_err(|error| Error::Custom(error.to_string()))?;
                self.inner.config.apply_mutations(vec![ConfigMutation::set(
                    KEY_SNAPSHOTS,
                    snapshots.to_string(),
                )])?;
                Ok(Some(snapshot))
            }
            Err(error) => {
                if cached.is_some() {
                    tracing::warn!(
                        provider = provider_id.as_str(),
                        error = %error,
                        "unable to refresh background image; using cached snapshot"
                    );
                    Ok(cached)
                } else {
                    Err(error)
                }
            }
        }
    }

    fn resolve_custom_snapshot(
        &self,
        source: &BackgroundImageCustomSource,
        previous: Option<&BackgroundImageSnapshot>,
    ) -> Result<BackgroundImageSnapshot> {
        let files = self.inner.resolver.resolve_files(source)?;
        assert_selected_files_available(source, &files)?;
        if files.is_empty() {
            return Err(Error::Custom(
                "No supported images were found in the selected source.".into(),
            ));
        }

        let index = random_custom_image_index(source, &files, previous);
        let image_path = files[index].clone();
        let title = file_name_from_path(&image_path);
        let resolved_at = now_epoch();

        Ok(BackgroundImageSnapshot {
            mode: BackgroundImageMode::Custom,
            provider_id: None,
            source_kind: Some(source.kind),
            image_url: String::new(),
            image_path: Some(image_path),
            image_count: Some(files.len() as u32),
            title,
            author: "Custom image source".into(),
            license: "Local file".into(),
            source: match source.kind {
                BackgroundImageCustomSourceKind::Folder => source.folder_path.clone(),
                BackgroundImageCustomSourceKind::Files => {
                    let count = files.len();
                    format!(
                        "{count} selected image{}",
                        if count == 1 { "" } else { "s" }
                    )
                }
            },
            resolved_at,
            resolved_for_key: resolved_at.to_string(),
        })
    }

    pub async fn initialize(&self) -> Result<BackgroundImageProjection> {
        let operation = self.begin_operation();
        let config = self.inner.config.as_ref();
        let legacy_enabled = config.get_bool(KEY_LEGACY_ENABLED, false)?;
        let enabled = config.get_bool(KEY_ENABLED, legacy_enabled)?;
        let mode =
            normalize_mode(&config.get_string(KEY_MODE, if enabled { "daily" } else { "off" })?);
        let legacy_provider = config.get_string(KEY_LEGACY_PROVIDER_ID, "nasa-epic")?;
        let provider_id = BackgroundImageProviderId::from_config(
            &config.get_string(KEY_PROVIDER_ID, &legacy_provider)?,
        );
        let custom_source = self.load_custom_source()?;
        let community_active = community_theme_appearance_active(config)?;

        let mut next_enabled = enabled && mode != BackgroundImageMode::Off;
        let mut next_mode = mode;
        let mut snapshot: Option<BackgroundImageSnapshot> = None;

        if next_enabled && mode == BackgroundImageMode::Daily {
            snapshot = match self.resolve_provider_snapshot(provider_id, false).await {
                Ok(snapshot) => snapshot,
                Err(error) => {
                    tracing::warn!(error = %error, "unable to initialize background image");
                    None
                }
            };
            next_enabled = snapshot.is_some() && !community_active;
        } else if next_enabled && mode == BackgroundImageMode::Custom {
            snapshot = match custom_source
                .as_ref()
                .map(|source| self.resolve_custom_snapshot(source, None))
            {
                Some(Ok(snapshot)) => Some(snapshot),
                Some(Err(error)) => {
                    tracing::warn!(error = %error, "unable to initialize custom background image");
                    None
                }
                None => None,
            };
            if snapshot.is_none() || community_active {
                next_enabled = false;
                next_mode = BackgroundImageMode::Off;
            }
        } else {
            next_mode = if mode == BackgroundImageMode::Custom {
                BackgroundImageMode::Custom
            } else {
                BackgroundImageMode::Off
            };
        }

        let projection = BackgroundImageProjection {
            revision: 0,
            enabled: next_enabled,
            mode: next_mode,
            provider_id,
            custom_source,
            snapshot,
            error: None,
        };
        self.apply_projection(operation, projection, Self::persist_state)
    }

    pub async fn configure(
        &self,
        input: BackgroundImageConfigureInput,
    ) -> Result<BackgroundImageProjection> {
        match input {
            BackgroundImageConfigureInput::Disable => self.disable(),
            BackgroundImageConfigureInput::EnableDaily { provider_id } => {
                self.enable_daily(provider_id).await
            }
            BackgroundImageConfigureInput::SetProvider { provider_id } => {
                self.set_provider(provider_id).await
            }
            BackgroundImageConfigureInput::EnableCustom => self.enable_custom(None),
            BackgroundImageConfigureInput::SetCustomFiles { paths } => {
                let rotation_interval_minutes = self.current_rotation_interval_minutes();
                let source = files_source(paths, rotation_interval_minutes);
                self.enable_custom(Some(source))
            }
            BackgroundImageConfigureInput::SetCustomFolder { folder_path } => {
                let rotation_interval_minutes = self.current_rotation_interval_minutes();
                let source = folder_source(folder_path, rotation_interval_minutes);
                self.enable_custom(Some(source))
            }
            BackgroundImageConfigureInput::SetRotationIntervalMinutes {
                rotation_interval_minutes,
            } => self.set_rotation_interval_minutes(rotation_interval_minutes),
            BackgroundImageConfigureInput::MigrateLegacyNasaApod => self.migrate_legacy_nasa_apod(),
        }
    }

    fn current_rotation_interval_minutes(&self) -> u16 {
        self.projection()
            .custom_source
            .map(|source| source.rotation_interval_minutes)
            .unwrap_or(DEFAULT_ROTATION_INTERVAL_MINUTES)
    }

    fn disable(&self) -> Result<BackgroundImageProjection> {
        let operation = self.begin_operation();
        let mut projection = self.projection();
        projection.enabled = false;
        projection.mode = BackgroundImageMode::Off;
        projection.error = None;
        self.apply_projection(operation, projection, Self::persist_state)
    }

    pub(super) fn disable_for_community_theme(
        &self,
        mutations: Vec<ConfigMutation>,
    ) -> Result<BackgroundImageProjection> {
        let operation = self.begin_operation();
        let mut projection = self.projection();
        projection.enabled = false;
        projection.mode = BackgroundImageMode::Off;
        projection.error = None;
        self.apply_projection(operation, projection, move |service, projection| {
            service.persist_state_with_mutations(projection, mutations, false)
        })
    }

    async fn enable_daily(
        &self,
        provider_id: Option<BackgroundImageProviderId>,
    ) -> Result<BackgroundImageProjection> {
        let operation = self.begin_operation();
        let current = self.projection();
        let provider_id = provider_id.unwrap_or(current.provider_id);
        match self.resolve_provider_snapshot(provider_id, false).await {
            Ok(snapshot) => {
                let enabled = snapshot.is_some();
                let projection = BackgroundImageProjection {
                    enabled,
                    mode: if enabled {
                        BackgroundImageMode::Daily
                    } else {
                        BackgroundImageMode::Off
                    },
                    provider_id,
                    snapshot,
                    error: None,
                    ..current
                };
                self.apply_projection(operation, projection, Self::persist_state)
            }
            Err(error) => {
                self.record_error(operation, None, &error);
                Err(error)
            }
        }
    }

    async fn set_provider(
        &self,
        provider_id: BackgroundImageProviderId,
    ) -> Result<BackgroundImageProjection> {
        let current = self.projection();
        if current.provider_id == provider_id {
            return Ok(current);
        }

        if current.enabled && current.mode == BackgroundImageMode::Daily {
            return self.enable_daily(Some(provider_id)).await;
        }

        let operation = self.begin_operation();
        let mut current = current;
        let snapshot = if current
            .snapshot
            .as_ref()
            .is_some_and(|snapshot| snapshot.provider_id == Some(provider_id))
        {
            current.snapshot.take()
        } else {
            self.cached_provider_snapshot(provider_id)?
        };
        let projection = BackgroundImageProjection {
            provider_id,
            snapshot,
            error: None,
            ..current
        };
        self.apply_projection(operation, projection, |service, projection| {
            service
                .inner
                .config
                .apply_mutations(vec![ConfigMutation::set(
                    KEY_PROVIDER_ID,
                    projection.provider_id.as_str(),
                )])
        })
    }

    fn enable_custom(
        &self,
        source: Option<BackgroundImageCustomSource>,
    ) -> Result<BackgroundImageProjection> {
        let operation = self.begin_operation();
        let current = self.projection();
        let source = source
            .and_then(normalize_custom_source_struct)
            .or(current.custom_source.clone());
        let source = match source {
            Some(source) => source,
            None => {
                let projection = BackgroundImageProjection {
                    enabled: false,
                    mode: BackgroundImageMode::Custom,
                    custom_source: None,
                    snapshot: None,
                    error: None,
                    ..current
                };
                return self.apply_projection(operation, projection, Self::persist_state);
            }
        };

        match self.resolve_custom_snapshot(&source, None) {
            Ok(snapshot) => {
                let projection = BackgroundImageProjection {
                    enabled: true,
                    mode: BackgroundImageMode::Custom,
                    custom_source: Some(source),
                    snapshot: Some(snapshot),
                    error: None,
                    ..current
                };
                self.apply_projection(operation, projection, Self::persist_state_and_source)
            }
            Err(error) => {
                self.apply_custom_failure(operation, None, current, Some(source), &error)?;
                Err(error)
            }
        }
    }

    fn persist_state_and_source(&self, projection: &BackgroundImageProjection) -> Result<()> {
        self.persist_state_with_mutations(projection, Vec::new(), true)
    }

    fn apply_custom_failure(
        &self,
        operation: u64,
        expected_revision: Option<u64>,
        current: BackgroundImageProjection,
        custom_source: Option<BackgroundImageCustomSource>,
        error: &Error,
    ) -> Result<()> {
        let projection = BackgroundImageProjection {
            enabled: false,
            mode: BackgroundImageMode::Off,
            custom_source: custom_source.or(current.custom_source.clone()),
            snapshot: None,
            error: Some(error.to_string()),
            ..current
        };
        self.apply_projection_guarded(
            operation,
            expected_revision,
            projection,
            Self::persist_state_and_source,
        )?;
        Ok(())
    }

    fn set_rotation_interval_minutes(
        &self,
        rotation_interval_minutes: u16,
    ) -> Result<BackgroundImageProjection> {
        if !(MIN_ROTATION_INTERVAL_MINUTES..=MAX_ROTATION_INTERVAL_MINUTES)
            .contains(&rotation_interval_minutes)
        {
            return Err(Error::Custom(format!(
                "Background image rotation interval must be between {MIN_ROTATION_INTERVAL_MINUTES} and {MAX_ROTATION_INTERVAL_MINUTES} minutes."
            )));
        }
        let current = self.projection();
        let Some(mut source) = current.custom_source.clone() else {
            return Ok(current);
        };
        if source.rotation_interval_minutes == rotation_interval_minutes {
            return Ok(current);
        }
        source.rotation_interval_minutes = rotation_interval_minutes;

        let operation = self.begin_operation();
        let projection = BackgroundImageProjection {
            custom_source: Some(source),
            ..current
        };
        self.apply_projection(operation, projection, |service, projection| {
            service.persist_custom_source(projection.custom_source.as_ref())
        })
    }

    fn migrate_legacy_nasa_apod(&self) -> Result<BackgroundImageProjection> {
        let operation = self.begin_operation();
        let mut current = self.projection();
        let snapshot = current.snapshot.take().filter(|snapshot| {
            snapshot.provider_id == Some(BackgroundImageProviderId::NasaApodSafe)
        });
        let projection = BackgroundImageProjection {
            enabled: true,
            mode: BackgroundImageMode::Daily,
            provider_id: BackgroundImageProviderId::NasaApodSafe,
            snapshot,
            error: None,
            ..current
        };
        self.apply_projection(operation, projection, Self::persist_state)
    }

    pub(super) fn migrate_legacy_nasa_apod_for_community_theme(
        &self,
        mutations: Vec<ConfigMutation>,
    ) -> Result<BackgroundImageProjection> {
        let operation = self.begin_operation();
        let mut current = self.projection();
        let snapshot = current.snapshot.take().filter(|snapshot| {
            snapshot.provider_id == Some(BackgroundImageProviderId::NasaApodSafe)
        });
        let projection = BackgroundImageProjection {
            enabled: true,
            mode: BackgroundImageMode::Daily,
            provider_id: BackgroundImageProviderId::NasaApodSafe,
            snapshot,
            error: None,
            ..current
        };
        self.apply_projection(operation, projection, move |service, projection| {
            service.persist_state_with_mutations(projection, mutations, false)
        })
    }

    pub async fn refresh(&self, force: bool) -> Result<BackgroundImageProjection> {
        let operation = if force {
            self.begin_operation()
        } else {
            self.current_operation()
        };
        let current = self.projection();
        let expected_revision = (!force).then_some(current.revision);
        if !force && !current.enabled {
            return Ok(current);
        }
        let resolved = match current.mode {
            BackgroundImageMode::Custom => match current.custom_source.as_ref() {
                Some(source) => self
                    .resolve_custom_snapshot(source, current.snapshot.as_ref())
                    .map(Some),
                None => Ok(None),
            },
            _ => {
                self.resolve_provider_snapshot(current.provider_id, force)
                    .await
            }
        };

        match resolved {
            Ok(Some(snapshot)) => {
                let mode = if current.mode == BackgroundImageMode::Custom {
                    BackgroundImageMode::Custom
                } else {
                    BackgroundImageMode::Daily
                };
                let projection = BackgroundImageProjection {
                    enabled: true,
                    mode,
                    snapshot: Some(snapshot),
                    error: None,
                    ..current
                };
                self.apply_projection_guarded(
                    operation,
                    expected_revision,
                    projection,
                    Self::persist_state,
                )
            }
            Ok(None) => {
                let projection = BackgroundImageProjection {
                    enabled: false,
                    mode: BackgroundImageMode::Off,
                    error: None,
                    ..current
                };
                self.apply_projection_guarded(
                    operation,
                    expected_revision,
                    projection,
                    Self::persist_state,
                )
            }
            Err(error) => {
                if current.mode == BackgroundImageMode::Custom {
                    self.apply_custom_failure(operation, expected_revision, current, None, &error)?;
                } else {
                    self.record_error(operation, expected_revision, &error);
                }
                Err(error)
            }
        }
    }

    fn record_error(&self, operation: u64, expected_revision: Option<u64>, error: &Error) {
        let mut slot = self.inner.projection.lock().unwrap();
        if !projection_update_is_current(
            self.current_operation(),
            operation,
            slot.revision,
            expected_revision,
        ) {
            return;
        }
        slot.error = Some(error.to_string());
        slot.revision = self.next_revision();
        let projection = slot.clone();
        drop(slot);
        self.inner.event_bus.emit(projection);
    }

    fn next_rotation_delay(&self) -> Option<Duration> {
        let projection = self.projection();
        if !projection.enabled || projection.mode != BackgroundImageMode::Custom {
            return None;
        }
        let source = projection.custom_source.as_ref()?;
        let rotating = match projection.snapshot.as_ref().and_then(|s| s.image_count) {
            Some(count) => count > 1,
            None => {
                source.kind == BackgroundImageCustomSourceKind::Folder || source.paths.len() > 1
            }
        };
        if !rotating {
            return None;
        }
        Some(rotation_delay(source.rotation_interval_minutes))
    }

    pub async fn run_rotation_loop(&self, stop_token: TaskStopToken) {
        loop {
            if stop_token.is_stop_requested() {
                return;
            }
            let notified = self.inner.rotation_notify.notified();
            match self.next_rotation_delay() {
                Some(delay) => {
                    let due = tokio::select! {
                        due = sleep_until_due_or_stopped(delay, &stop_token) => due,
                        _ = notified => false,
                    };
                    if due {
                        if let Err(error) = self.refresh(false).await {
                            tracing::warn!(error = %error, "failed to rotate background image");
                        }
                    }
                }
                None => {
                    notified.await;
                }
            }
        }
    }
}
