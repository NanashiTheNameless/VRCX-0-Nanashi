use std::sync::Arc;

use tokio::sync::{Notify, Semaphore};
use vrcx_0_application_core::{Error, RuntimeEventBus};

use super::super::background_image::{
    BackgroundImageProviderId, BackgroundImageRemote, BackgroundImageRemoteFuture,
    BackgroundImageService, UnavailableBackgroundImageFileResolver,
};
use super::*;
use crate::profile::test_support::MemoryProfileConfigStore;

struct DelayedCommunityThemeRemote {
    manifest_started: Notify,
    release_manifest: Semaphore,
}

struct UnavailableBackgroundImageRemote;

impl BackgroundImageRemote for UnavailableBackgroundImageRemote {
    fn provider_image(
        &self,
        _provider_id: BackgroundImageProviderId,
    ) -> BackgroundImageRemoteFuture<
        '_,
        vrcx_0_contracts::background_image::BackgroundImageProviderImage,
    > {
        Box::pin(async { Err(Error::Custom("background image remote unavailable".into())) })
    }
}

impl DelayedCommunityThemeRemote {
    fn new() -> Self {
        Self {
            manifest_started: Notify::new(),
            release_manifest: Semaphore::new(0),
        }
    }
}

impl CommunityThemeRemote for DelayedCommunityThemeRemote {
    fn load_catalog(&self) -> CommunityThemeRemoteFuture<'_, CommunityThemeCatalog> {
        Box::pin(async {
            Ok(CommunityThemeCatalog {
                source_url: protocol::COMMUNITY_THEME_CATALOG_URL.into(),
                schema_version: 1,
                themes: Vec::new(),
            })
        })
    }

    fn load_manifest<'a>(
        &'a self,
        theme_id: &'a str,
    ) -> CommunityThemeRemoteFuture<'a, CommunityThemeManifest> {
        Box::pin(async move {
            self.manifest_started.notify_one();
            self.release_manifest
                .acquire()
                .await
                .expect("manifest release semaphore should remain open")
                .forget();
            Ok(CommunityThemeManifest {
                id: theme_id.into(),
                name: "Delayed theme".into(),
                version: "1.0.0".into(),
                author: CommunityThemeAuthor {
                    name: "Test".into(),
                    github: "test".into(),
                    url: None,
                },
                description: String::new(),
                tags: Vec::new(),
                tested_with: String::new(),
                remote_assets: false,
                dark_mode: true,
                accent_mode: false,
                preview_url: String::new(),
                readme_url: String::new(),
            })
        })
    }

    fn load_css<'a>(&'a self, _theme_id: &'a str) -> CommunityThemeRemoteFuture<'a, String> {
        Box::pin(async { Ok(":root { color-scheme: dark; }".into()) })
    }
}

fn test_service(remote: Arc<dyn CommunityThemeRemote>) -> CommunityThemeService {
    let config = Arc::new(MemoryProfileConfigStore::default());
    let event_bus = RuntimeEventBus::new();
    let background_image = BackgroundImageService::new(
        config.clone(),
        Arc::new(UnavailableBackgroundImageRemote),
        event_bus.clone(),
        Arc::new(UnavailableBackgroundImageFileResolver),
    );
    CommunityThemeService::new(config, remote, event_bus, background_image)
}

#[tokio::test]
async fn late_install_cannot_reverse_a_newer_disable_request() {
    let remote = Arc::new(DelayedCommunityThemeRemote::new());
    let service = test_service(remote.clone());
    let install_service = service.clone();
    let install = tokio::spawn(async move {
        install_service
            .configure(CommunityThemeConfigureInput::Install {
                theme_id: "delayed-theme".into(),
            })
            .await
    });

    tokio::time::timeout(
        std::time::Duration::from_secs(1),
        remote.manifest_started.notified(),
    )
    .await
    .expect("install should begin downloading its manifest");
    let disabled = service
        .configure(CommunityThemeConfigureInput::Disable)
        .await
        .unwrap();
    remote.release_manifest.add_permits(1);

    let error = install.await.unwrap().unwrap_err();
    assert!(error.to_string().contains("superseded"));
    assert!(!disabled.enabled);
    assert!(!service.projection().enabled);
    assert!(service.projection().installed_themes.is_empty());
}

#[tokio::test]
async fn install_disable_enable_and_delete_preserve_theme_lifecycle() {
    let remote = Arc::new(DelayedCommunityThemeRemote::new());
    remote.release_manifest.add_permits(1);
    let service = test_service(remote);

    let installed = service
        .configure(CommunityThemeConfigureInput::Install {
            theme_id: "lifecycle-theme".into(),
        })
        .await
        .unwrap();
    assert!(installed.enabled);
    assert_eq!(
        installed
            .installed_theme
            .as_ref()
            .map(|theme| theme.theme_id.as_str()),
        Some("lifecycle-theme")
    );
    assert_eq!(installed.installed_themes.len(), 1);
    assert_eq!(
        installed.installed_css_snapshot,
        ":root { color-scheme: dark; }"
    );

    let disabled = service
        .configure(CommunityThemeConfigureInput::Disable)
        .await
        .unwrap();
    assert!(!disabled.enabled);
    assert!(disabled.installed_theme.is_none());
    assert_eq!(disabled.installed_themes.len(), 1);

    let enabled = service
        .configure(CommunityThemeConfigureInput::Enable {
            theme_id: Some("lifecycle-theme".into()),
        })
        .await
        .unwrap();
    assert!(enabled.enabled);
    assert_eq!(
        enabled
            .installed_theme
            .as_ref()
            .map(|theme| theme.theme_id.as_str()),
        Some("lifecycle-theme")
    );

    let deleted = service
        .configure(CommunityThemeConfigureInput::Delete {
            theme_id: Some("lifecycle-theme".into()),
        })
        .await
        .unwrap();
    assert!(!deleted.enabled);
    assert!(deleted.installed_theme.is_none());
    assert!(deleted.installed_themes.is_empty());
}

#[tokio::test]
async fn override_css_persists_while_its_enabled_state_can_be_disabled() {
    let remote = Arc::new(DelayedCommunityThemeRemote::new());
    let service = test_service(remote);

    let configured = service
        .configure(CommunityThemeConfigureInput::SetOverride {
            css_text: ":root { --accent: red; }".into(),
        })
        .await
        .unwrap();
    assert_eq!(configured.override_css, ":root { --accent: red; }");
    assert!(configured.override_css_enabled);

    let disabled = service
        .configure(CommunityThemeConfigureInput::DisableOverride)
        .await
        .unwrap();
    assert_eq!(disabled.override_css, ":root { --accent: red; }");
    assert!(!disabled.override_css_enabled);

    let initialized = service.initialize().await.unwrap();
    assert_eq!(initialized.override_css, ":root { --accent: red; }");
    assert!(!initialized.override_css_enabled);
}
