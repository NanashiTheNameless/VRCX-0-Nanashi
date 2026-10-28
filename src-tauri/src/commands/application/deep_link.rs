#![allow(non_snake_case)]

use tauri::{AppHandle, State};

#[cfg(any(windows, target_os = "linux"))]
use tauri_plugin_deep_link::DeepLinkExt;

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_runtime_host_desktop::deep_link::DeepLinkAction;

const APP_DEEP_LINK_SCHEME: &str = "vrcx-0-nanashi";

#[tauri::command(async)]
#[specta::specta]
pub fn app__drain_pending_deep_links(state: State<'_, AppState>) -> Vec<DeepLinkAction> {
    state.pending_deep_links().drain()
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__deep_link_registration_status(app: AppHandle) -> Result<Option<bool>, AppError> {
    deep_link_registration_status(&app)
}

fn deep_link_registration_status(app: &AppHandle) -> Result<Option<bool>, AppError> {
    #[cfg(any(windows, target_os = "linux"))]
    {
        app.deep_link()
            .is_registered(APP_DEEP_LINK_SCHEME)
            .map(Some)
            .map_err(|error| AppError::Custom(error.to_string()))
    }

    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = app;
        Ok(None)
    }
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__deep_link_registration_repair(app: AppHandle) -> Result<Option<bool>, AppError> {
    #[cfg(any(windows, target_os = "linux"))]
    {
        app.deep_link()
            .register(APP_DEEP_LINK_SCHEME)
            .map_err(|error| AppError::Custom(error.to_string()))?;
        // Also claim upstream VRCX-0 and original VRCX schemes so their links open here.
        let (upstream_enabled, legacy_enabled) =
            vrcx_0_runtime_host_desktop::deep_link::extra_schemes_enabled();
        for (scheme, enabled) in [
            (
                vrcx_0_runtime_host_desktop::deep_link::UPSTREAM_VRCX_0_SCHEME,
                upstream_enabled,
            ),
            (
                vrcx_0_runtime_host_desktop::deep_link::LEGACY_VRCX_SCHEME,
                legacy_enabled,
            ),
        ] {
            if !enabled {
                continue;
            }
            if let Err(error) = app.deep_link().register(scheme) {
                tracing::warn!(error = %error, scheme, "failed to register extra link handler");
            }
        }
    }

    #[cfg(not(any(windows, target_os = "linux")))]
    return Ok(None);

    deep_link_registration_status(&app)
}

#[derive(Clone, Copy, Debug, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DeepLinkSchemeSettings {
    /// `vrcx-0://` (upstream VRCX-0 links).
    pub upstream: bool,
    /// `vrcx://` (original VRCX links).
    pub legacy: bool,
}

/// Read the persisted toggles and apply them: flags for parsing, plus
/// (un)registering the OS handlers on Windows/Linux.
pub(crate) fn apply_deep_link_scheme_settings(
    app: &AppHandle,
    state: &AppState,
) -> DeepLinkSchemeSettings {
    let settings = DeepLinkSchemeSettings {
        upstream: state.runtime_host().config_bool(
            vrcx_0_runtime_host_desktop::deep_link::UPSTREAM_SCHEME_ENABLED_CONFIG_KEY,
            true,
        ),
        legacy: state.runtime_host().config_bool(
            vrcx_0_runtime_host_desktop::deep_link::LEGACY_SCHEME_ENABLED_CONFIG_KEY,
            true,
        ),
    };
    vrcx_0_runtime_host_desktop::deep_link::set_extra_schemes_enabled(
        settings.upstream,
        settings.legacy,
    );
    #[cfg(any(windows, target_os = "linux"))]
    for (scheme, enabled) in [
        (
            vrcx_0_runtime_host_desktop::deep_link::UPSTREAM_VRCX_0_SCHEME,
            settings.upstream,
        ),
        (
            vrcx_0_runtime_host_desktop::deep_link::LEGACY_VRCX_SCHEME,
            settings.legacy,
        ),
    ] {
        let result = if enabled {
            app.deep_link().register(scheme)
        } else {
            app.deep_link().unregister(scheme)
        };
        if let Err(error) = result {
            tracing::debug!(error = %error, scheme, enabled, "failed to update link handler registration");
        }
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    let _ = app;
    settings
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__deep_link_schemes_get() -> DeepLinkSchemeSettings {
    let (upstream, legacy) = vrcx_0_runtime_host_desktop::deep_link::extra_schemes_enabled();
    DeepLinkSchemeSettings { upstream, legacy }
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__deep_link_schemes_set(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: DeepLinkSchemeSettings,
) -> Result<DeepLinkSchemeSettings, AppError> {
    state.runtime_host().set_config_bool(
        vrcx_0_runtime_host_desktop::deep_link::UPSTREAM_SCHEME_ENABLED_CONFIG_KEY,
        settings.upstream,
    )?;
    state.runtime_host().set_config_bool(
        vrcx_0_runtime_host_desktop::deep_link::LEGACY_SCHEME_ENABLED_CONFIG_KEY,
        settings.legacy,
    )?;
    Ok(apply_deep_link_scheme_settings(&app, &state))
}
