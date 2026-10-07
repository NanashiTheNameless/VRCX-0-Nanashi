use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use sha2::{Digest, Sha256};
use tokio::sync::Mutex as AsyncMutex;
use vrcx_0_application_core::RuntimeEventBus;
use vrcx_0_contracts::community_theme_protocol as protocol;
use vrcx_0_contracts::ConfigMutation;
use vrcx_0_core::time::now_iso;

use super::super::background_image::{
    BackgroundImageConfigureInput, BackgroundImageProjection, BackgroundImageService,
};
use super::super::ProfileConfigStore;
use super::persistence::{
    empty_projection, install_state_mutations, load_persisted_state, merge_install_record,
    override_state_mutations, projection_from_state, CommunityThemeInstalledRecord,
    KEY_LEGACY_CATALOG_URL, KEY_OVERRIDE_ENABLED,
};
use super::remote::{protocol_error, CommunityThemeRemote};
use super::types::{
    CommunityThemeCatalog, CommunityThemeConfigureInput, CommunityThemeInstallMetadata,
    CommunityThemeProjection,
};
use vrcx_0_application_core::{Error, Result};

struct CommunityThemeServiceInner {
    config: Arc<dyn ProfileConfigStore>,
    remote: Arc<dyn CommunityThemeRemote>,
    event_bus: RuntimeEventBus,
    background_image: BackgroundImageService,
    operation_lock: AsyncMutex<()>,
    operation_generation: AtomicU64,
    projection: Mutex<CommunityThemeProjection>,
    revision: AtomicU64,
}

#[derive(Clone)]
pub struct CommunityThemeService {
    inner: Arc<CommunityThemeServiceInner>,
}

impl CommunityThemeService {
    pub fn new(
        config: Arc<dyn ProfileConfigStore>,
        remote: Arc<dyn CommunityThemeRemote>,
        event_bus: RuntimeEventBus,
        background_image: BackgroundImageService,
    ) -> Self {
        Self {
            inner: Arc::new(CommunityThemeServiceInner {
                config,
                remote,
                event_bus,
                background_image,
                operation_lock: AsyncMutex::new(()),
                operation_generation: AtomicU64::new(0),
                projection: Mutex::new(empty_projection()),
                revision: AtomicU64::new(0),
            }),
        }
    }

    pub fn projection(&self) -> CommunityThemeProjection {
        self.inner.projection.lock().unwrap().clone()
    }

    pub async fn initialize(&self) -> Result<CommunityThemeProjection> {
        let _operation = self.inner.operation_lock.lock().await;
        let state = load_persisted_state(self.inner.config.as_ref())?;
        let projection = projection_from_state(&state);
        let mut mutations = install_state_mutations(&state.records, state.active_record.as_ref())?;
        mutations.extend(override_state_mutations(
            &state.override_css,
            state.override_css_enabled,
        ));
        mutations.push(ConfigMutation::remove(KEY_LEGACY_CATALOG_URL));

        if state.legacy_apod_was_active {
            self.inner
                .background_image
                .migrate_legacy_nasa_apod_for_community_theme(mutations)?;
        } else if state.active_record.is_some() {
            self.inner
                .background_image
                .disable_for_community_theme(mutations)?;
        } else {
            self.inner.config.apply_mutations(mutations)?;
        }
        Ok(self.apply_projection(projection))
    }

    pub async fn load_catalog(&self) -> Result<CommunityThemeCatalog> {
        self.inner.remote.load_catalog().await
    }

    pub async fn configure(
        &self,
        input: CommunityThemeConfigureInput,
    ) -> Result<CommunityThemeProjection> {
        let operation = self.begin_configure_operation();
        match input {
            CommunityThemeConfigureInput::Install { theme_id } => {
                self.install(operation, &theme_id).await
            }
            CommunityThemeConfigureInput::Enable { theme_id } => {
                self.enable(operation, theme_id.as_deref()).await
            }
            CommunityThemeConfigureInput::Disable => self.disable(operation).await,
            CommunityThemeConfigureInput::Delete { theme_id } => {
                self.delete(operation, theme_id.as_deref()).await
            }
            CommunityThemeConfigureInput::SetOverride { css_text } => {
                self.set_override(operation, css_text).await
            }
            CommunityThemeConfigureInput::DisableOverride => self.disable_override(operation).await,
        }
    }

    pub async fn configure_background_image(
        &self,
        input: BackgroundImageConfigureInput,
    ) -> Result<BackgroundImageProjection> {
        let operation = self.begin_configure_operation();
        let _operation = self.inner.operation_lock.lock().await;
        self.ensure_configure_operation(operation)?;
        let projection = self.inner.background_image.configure(input).await?;
        if projection.enabled {
            self.reconcile_after_background_enable()?;
        }
        Ok(projection)
    }

    pub async fn refresh_background_image(&self, force: bool) -> Result<BackgroundImageProjection> {
        let operation = self.begin_configure_operation();
        let _operation = self.inner.operation_lock.lock().await;
        self.ensure_configure_operation(operation)?;
        let projection = self.inner.background_image.refresh(force).await?;
        if projection.enabled {
            self.reconcile_after_background_enable()?;
        }
        Ok(projection)
    }

    async fn install(&self, operation: u64, theme_id: &str) -> Result<CommunityThemeProjection> {
        if !protocol::is_community_theme_id(theme_id) {
            return Err(Error::Custom(format!(
                "Invalid community theme id: {theme_id}."
            )));
        }
        let (manifest, css_snapshot) = futures_util::try_join!(
            self.inner.remote.load_manifest(theme_id),
            self.inner.remote.load_css(theme_id)
        )?;
        let _operation = self.inner.operation_lock.lock().await;
        self.ensure_configure_operation(operation)?;
        let mut state = load_persisted_state(self.inner.config.as_ref())?;
        let previous = state
            .records
            .iter()
            .find(|record| record.metadata.theme_id == theme_id);
        let now = now_iso();
        let metadata = CommunityThemeInstallMetadata {
            theme_id: manifest.id.clone(),
            theme_name: manifest.name,
            version: manifest.version,
            source_url: protocol::community_theme_asset_url(
                theme_id,
                protocol::COMMUNITY_THEME_CSS_FILE_NAME,
            )
            .map_err(protocol_error)?,
            sha256: hex::encode(Sha256::digest(css_snapshot.as_bytes())),
            installed_at: previous
                .map(|record| record.metadata.installed_at.clone())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| now.clone()),
            updated_at: now,
            dark_mode: manifest.dark_mode,
            accent_mode: manifest.accent_mode,
        };
        let active_record = CommunityThemeInstalledRecord {
            metadata,
            css_snapshot,
        };
        merge_install_record(&mut state.records, active_record.clone());
        let mutations = install_state_mutations(&state.records, Some(&active_record))?;
        self.inner
            .background_image
            .disable_for_community_theme(mutations)?;
        state.active_record = Some(active_record);
        Ok(self.apply_projection(projection_from_state(&state)))
    }

    async fn enable(
        &self,
        operation: u64,
        theme_id: Option<&str>,
    ) -> Result<CommunityThemeProjection> {
        let _operation = self.inner.operation_lock.lock().await;
        self.ensure_configure_operation(operation)?;
        let mut state = load_persisted_state(self.inner.config.as_ref())?;
        let target_theme_id = theme_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .or_else(|| {
                state
                    .active_record
                    .as_ref()
                    .map(|record| record.metadata.theme_id.as_str())
            })
            .or_else(|| {
                state
                    .records
                    .first()
                    .map(|record| record.metadata.theme_id.as_str())
            });
        let Some(target_theme_id) = target_theme_id else {
            return Ok(self.projection());
        };
        let Some(active_record) = state
            .records
            .iter()
            .find(|record| record.metadata.theme_id == target_theme_id)
            .cloned()
        else {
            return Ok(self.projection());
        };
        let mutations = install_state_mutations(&state.records, Some(&active_record))?;
        self.inner
            .background_image
            .disable_for_community_theme(mutations)?;
        state.active_record = Some(active_record);
        Ok(self.apply_projection(projection_from_state(&state)))
    }

    async fn disable(&self, operation: u64) -> Result<CommunityThemeProjection> {
        let _operation = self.inner.operation_lock.lock().await;
        self.ensure_configure_operation(operation)?;
        let mut state = load_persisted_state(self.inner.config.as_ref())?;
        state.active_record = None;
        let mutations = install_state_mutations(&state.records, None)?;
        self.inner.config.apply_mutations(mutations)?;
        Ok(self.apply_projection(projection_from_state(&state)))
    }

    async fn delete(
        &self,
        operation: u64,
        theme_id: Option<&str>,
    ) -> Result<CommunityThemeProjection> {
        let _operation = self.inner.operation_lock.lock().await;
        self.ensure_configure_operation(operation)?;
        let mut state = load_persisted_state(self.inner.config.as_ref())?;
        let target_theme_id = theme_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .or_else(|| {
                state
                    .active_record
                    .as_ref()
                    .map(|record| record.metadata.theme_id.as_str())
            })
            .map(ToOwned::to_owned);
        let Some(target_theme_id) = target_theme_id else {
            return Ok(self.projection());
        };
        state
            .records
            .retain(|record| record.metadata.theme_id != target_theme_id);
        if state
            .active_record
            .as_ref()
            .is_some_and(|record| record.metadata.theme_id == target_theme_id)
        {
            state.active_record = None;
        }
        let mutations = install_state_mutations(&state.records, state.active_record.as_ref())?;
        self.inner.config.apply_mutations(mutations)?;
        Ok(self.apply_projection(projection_from_state(&state)))
    }

    async fn set_override(
        &self,
        operation: u64,
        css_text: String,
    ) -> Result<CommunityThemeProjection> {
        if css_text.len() > protocol::COMMUNITY_THEME_CSS_MAX_BYTES {
            return Err(Error::Custom(
                "Community theme override CSS is too large.".into(),
            ));
        }
        let _operation = self.inner.operation_lock.lock().await;
        self.ensure_configure_operation(operation)?;
        let mut state = load_persisted_state(self.inner.config.as_ref())?;
        state.override_css = css_text;
        state.override_css_enabled = !state.override_css.trim().is_empty();
        self.inner.config.apply_mutations(override_state_mutations(
            &state.override_css,
            state.override_css_enabled,
        ))?;
        Ok(self.apply_projection(projection_from_state(&state)))
    }

    async fn disable_override(&self, operation: u64) -> Result<CommunityThemeProjection> {
        let _operation = self.inner.operation_lock.lock().await;
        self.ensure_configure_operation(operation)?;
        let mut state = load_persisted_state(self.inner.config.as_ref())?;
        state.override_css_enabled = false;
        self.inner
            .config
            .apply_mutations(vec![ConfigMutation::set(KEY_OVERRIDE_ENABLED, "false")])?;
        Ok(self.apply_projection(projection_from_state(&state)))
    }

    fn reconcile_after_background_enable(&self) -> Result<()> {
        let state = load_persisted_state(self.inner.config.as_ref())?;
        self.apply_projection(projection_from_state(&state));
        Ok(())
    }

    fn begin_configure_operation(&self) -> u64 {
        self.inner
            .operation_generation
            .fetch_add(1, Ordering::AcqRel)
            .saturating_add(1)
    }

    fn ensure_configure_operation(&self, operation: u64) -> Result<()> {
        if self.inner.operation_generation.load(Ordering::Acquire) == operation {
            Ok(())
        } else {
            Err(Error::Custom(
                "Community theme operation was superseded by a newer request.".into(),
            ))
        }
    }

    fn apply_projection(
        &self,
        mut projection: CommunityThemeProjection,
    ) -> CommunityThemeProjection {
        projection.revision = self
            .inner
            .revision
            .fetch_add(1, Ordering::AcqRel)
            .saturating_add(1);
        *self.inner.projection.lock().unwrap() = projection.clone();
        self.inner.event_bus.emit(projection.clone());
        projection
    }
}
