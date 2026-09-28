#![allow(non_snake_case)]

use tauri::{AppHandle, State};

#[cfg(any(windows, target_os = "linux"))]
use tauri_plugin_deep_link::DeepLinkExt;

use crate::deep_link::DeepLinkAction;
use crate::error::AppError;
use crate::state::AppState;

const APP_DEEP_LINK_SCHEME: &str = "vrcx-0-nanashi";

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::{c_char, c_void, CString};

    use super::{AppError, APP_DEEP_LINK_SCHEME};

    const CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

    type CfStringRef = *const c_void;

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFRelease(value: *const c_void);
        fn CFStringCompare(left: CfStringRef, right: CfStringRef, options: usize) -> isize;
        fn CFStringCreateWithCString(
            allocator: *const c_void,
            value: *const c_char,
            encoding: u32,
        ) -> CfStringRef;
    }

    #[link(name = "CoreServices", kind = "framework")]
    unsafe extern "C" {
        fn LSCopyDefaultHandlerForURLScheme(scheme: CfStringRef) -> CfStringRef;
        fn LSSetDefaultHandlerForURLScheme(
            scheme: CfStringRef,
            bundle_identifier: CfStringRef,
        ) -> i32;
    }

    struct OwnedCfString(CfStringRef);

    impl OwnedCfString {
        fn from_owned(string: CfStringRef) -> Option<Self> {
            (!string.is_null()).then_some(Self(string))
        }

        fn new(value: &str) -> Result<Self, AppError> {
            let value = CString::new(value).map_err(|error| AppError::Custom(error.to_string()))?;
            let string = unsafe {
                CFStringCreateWithCString(std::ptr::null(), value.as_ptr(), CF_STRING_ENCODING_UTF8)
            };
            Self::from_owned(string).ok_or_else(|| {
                AppError::Custom("failed to create macOS deep link registration value".to_string())
            })
        }
    }

    impl Drop for OwnedCfString {
        fn drop(&mut self) {
            unsafe { CFRelease(self.0) };
        }
    }

    pub fn is_registered(bundle_identifier: &str) -> Result<bool, AppError> {
        let scheme = OwnedCfString::new(APP_DEEP_LINK_SCHEME)?;
        let bundle_identifier = OwnedCfString::new(bundle_identifier)?;
        let handler =
            OwnedCfString::from_owned(unsafe { LSCopyDefaultHandlerForURLScheme(scheme.0) });
        let Some(handler) = handler else {
            return Ok(false);
        };

        Ok(unsafe { CFStringCompare(handler.0, bundle_identifier.0, 0) == 0 })
    }

    pub fn register(bundle_identifier: &str) -> Result<(), AppError> {
        let scheme = OwnedCfString::new(APP_DEEP_LINK_SCHEME)?;
        let bundle_identifier = OwnedCfString::new(bundle_identifier)?;
        let status = unsafe { LSSetDefaultHandlerForURLScheme(scheme.0, bundle_identifier.0) };
        if status != 0 {
            return Err(AppError::Custom(format!(
                "macOS failed to register the VRCX-0-Nanashi link handler: OSStatus {status}"
            )));
        }
        Ok(())
    }
}

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

    #[cfg(target_os = "macos")]
    {
        return macos::is_registered(&app.config().identifier).map(Some);
    }

    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
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
        let (upstream_enabled, legacy_enabled) = crate::deep_link::extra_schemes_enabled();
        for (scheme, enabled) in [
            (crate::deep_link::UPSTREAM_VRCX_0_SCHEME, upstream_enabled),
            (crate::deep_link::LEGACY_VRCX_SCHEME, legacy_enabled),
        ] {
            if !enabled {
                continue;
            }
            if let Err(error) = app.deep_link().register(scheme) {
                tracing::warn!(error = %error, scheme, "failed to register extra link handler");
            }
        }
    }

    #[cfg(target_os = "macos")]
    macos::register(&app.config().identifier)?;

    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
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
        upstream: state
            .runtime_host()
            .config_bool(crate::deep_link::UPSTREAM_SCHEME_ENABLED_CONFIG_KEY, true),
        legacy: state
            .runtime_host()
            .config_bool(crate::deep_link::LEGACY_SCHEME_ENABLED_CONFIG_KEY, true),
    };
    crate::deep_link::set_extra_schemes_enabled(settings.upstream, settings.legacy);
    #[cfg(any(windows, target_os = "linux"))]
    for (scheme, enabled) in [
        (crate::deep_link::UPSTREAM_VRCX_0_SCHEME, settings.upstream),
        (crate::deep_link::LEGACY_VRCX_SCHEME, settings.legacy),
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
    let (upstream, legacy) = crate::deep_link::extra_schemes_enabled();
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
        crate::deep_link::UPSTREAM_SCHEME_ENABLED_CONFIG_KEY,
        settings.upstream,
    )?;
    state.runtime_host().set_config_bool(
        crate::deep_link::LEGACY_SCHEME_ENABLED_CONFIG_KEY,
        settings.legacy,
    )?;
    Ok(apply_deep_link_scheme_settings(&app, &state))
}
