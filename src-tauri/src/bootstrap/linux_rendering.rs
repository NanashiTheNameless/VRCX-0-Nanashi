use std::sync::Mutex;
use std::time::Instant;

use tauri::{AppHandle, Manager};

use crate::state::AppState;

const STORAGE_KEY: &str = "vrcx0.linuxRendering";
const MODE_OFF: &str = "off";
const MODE_TRIAL: &str = "trial";
const MODE_ON: &str = "on";

#[cfg(target_os = "linux")]
const TRIAL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

#[cfg(target_os = "linux")]
const DMABUF_RENDERER_ENV: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";

#[derive(Clone, Copy, Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LinuxRenderingSnapshot {
    pub enabled: bool,
    pub needs_confirmation: bool,
}

#[cfg(target_os = "linux")]
static ENVIRONMENT_OVERRIDE: std::sync::OnceLock<bool> = std::sync::OnceLock::new();

/// Whether `WEBKIT_DISABLE_DMABUF_RENDERER` is set to a value that actually
/// disables the DMABUF renderer. WebKit treats "0" as disabled-by-false, so
/// only a truthy value hands rendering control to the environment.
#[cfg(target_os = "linux")]
fn environment_override_active() -> bool {
    std::env::var(DMABUF_RENDERER_ENV)
        .map(|value| {
            let value = value.trim();
            !value.is_empty() && !matches!(value, "0" | "false" | "False" | "FALSE" | "no" | "off")
        })
        .unwrap_or(false)
}

#[derive(Default)]
pub struct LinuxRenderingState {
    trial_deadline: Mutex<Option<Instant>>,
    snapshot: Mutex<Option<LinuxRenderingSnapshot>>,
}

pub fn apply_webkit_workaround() {
    #[cfg(target_os = "linux")]
    {
        use webkit2gtk_nvidia_quirk::{apply_workaround_with_options, ApplyWorkaroundOptions};

        // Only a truthy value counts as an external override. `resolve` sets
        // this variable in our own process environment before WebKit starts,
        // and a restart re-execs with it still set, so testing mere presence
        // would treat our own "0" (acceleration on) as an override and leave
        // the settings snapshot unresolved forever.
        let _ = ENVIRONMENT_OVERRIDE.set(environment_override_active());
        apply_workaround_with_options(ApplyWorkaroundOptions::default());
    }
}

#[cfg_attr(not(target_os = "linux"), allow(unused_variables))]
pub fn resolve(app: &AppHandle, state: &AppState) {
    #[cfg(target_os = "linux")]
    {
        if ENVIRONMENT_OVERRIDE.get() == Some(&true) {
            tracing::info!(
                "{DMABUF_RENDERER_ENV} is set in the environment; leaving Linux rendering to it"
            );
            return;
        }
        let rendering = app.state::<LinuxRenderingState>();
        let mut snapshot = rendering.snapshot.lock().unwrap();
        if snapshot.is_some() {
            return;
        }

        let host = state.runtime_host();
        let (mut accelerated, mut trial) = match host.storage_get(STORAGE_KEY).as_deref() {
            Some(MODE_ON) => (true, false),
            Some(MODE_TRIAL) => (true, true),
            _ => (false, false),
        };
        if trial {
            // Journal the fallback before WebKit starts, so a crashed trial needs no recovery pass.
            host.storage_set(STORAGE_KEY.to_string(), MODE_OFF.to_string());
            if let Err(error) = host.storage_flush() {
                tracing::warn!(%error, "could not journal the Linux rendering trial; using compatibility mode");
                (accelerated, trial) = (false, false);
            }
        }

        // Explicit rendering mode owns DMABUF; keep the independent NVIDIA sync workaround.
        std::env::set_var(DMABUF_RENDERER_ENV, if accelerated { "0" } else { "1" });
        *snapshot = Some(LinuxRenderingSnapshot {
            enabled: accelerated,
            needs_confirmation: trial,
        });
        if trial {
            *rendering.trial_deadline.lock().unwrap() = Some(Instant::now() + TRIAL_TIMEOUT);
            super::request_startup_foreground();
        }
    }
}

pub fn start_fallback(app: &AppHandle) {
    let Some(deadline) = *app
        .state::<LinuxRenderingState>()
        .trial_deadline
        .lock()
        .unwrap()
    else {
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep_until(tokio::time::Instant::from_std(deadline)).await;
        if take_trial(&app).is_none() {
            return;
        }
        tracing::warn!("Linux rendering trial was not confirmed; restarting without acceleration");
        crate::commands::host::window::restart_now(&app);
    });
}

pub fn snapshot(app: &AppHandle) -> Option<LinuxRenderingSnapshot> {
    *app.state::<LinuxRenderingState>().snapshot.lock().unwrap()
}

pub fn configure(app: &AppHandle, enabled: bool) -> Result<LinuxRenderingSnapshot, String> {
    let rendering = app.state::<LinuxRenderingState>();
    let mut snapshot = rendering.snapshot.lock().unwrap();
    if snapshot.is_none() {
        return Err("Linux rendering settings are unavailable.".into());
    }
    write_mode(app, if enabled { MODE_TRIAL } else { MODE_OFF })?;
    rendering.trial_deadline.lock().unwrap().take();
    let updated = LinuxRenderingSnapshot {
        enabled,
        needs_confirmation: false,
    };
    *snapshot = Some(updated);
    Ok(updated)
}

pub fn confirm(app: &AppHandle) -> Result<LinuxRenderingSnapshot, String> {
    let state = app.state::<LinuxRenderingState>();
    let claimed = {
        let mut deadline = state.trial_deadline.lock().unwrap();
        let live = deadline.is_some_and(|at| Instant::now() < at);
        if live {
            *deadline = None;
        }
        live
    };
    if !claimed {
        return Err("The hardware acceleration confirmation has expired.".into());
    }
    write_mode(app, MODE_ON)?;
    let confirmed = LinuxRenderingSnapshot {
        enabled: true,
        needs_confirmation: false,
    };
    *state.snapshot.lock().unwrap() = Some(confirmed);
    Ok(confirmed)
}

pub fn stop(app: &AppHandle) {
    take_trial(app);
}

fn take_trial(app: &AppHandle) -> Option<Instant> {
    app.try_state::<LinuxRenderingState>()?
        .trial_deadline
        .lock()
        .unwrap()
        .take()
}

fn write_mode(app: &AppHandle, mode: &str) -> Result<(), String> {
    let state = app.state::<AppState>();
    let host = state.runtime_host();
    host.storage_set(STORAGE_KEY.to_string(), mode.to_string());
    host.storage_flush().map_err(|error| error.to_string())
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::environment_override_active;

    // `resolve` writes this variable in our own environment before WebKit
    // starts, and a restart re-execs with it still set. Presence alone must
    // not be read as an override, or the settings snapshot never resolves.
    #[test]
    fn own_disabling_values_are_not_treated_as_an_override() {
        let previous = std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").ok();
        for value in ["0", "", "false", "off", "no"] {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", value);
            assert!(
                !environment_override_active(),
                "{value:?} must not count as an environment override"
            );
        }
        match previous {
            Some(value) => std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", value),
            None => std::env::remove_var("WEBKIT_DISABLE_DMABUF_RENDERER"),
        }
    }

    #[test]
    fn genuinely_disabling_values_are_an_override() {
        let previous = std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").ok();
        for value in ["1", "true", "yes", "on"] {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", value);
            assert!(
                environment_override_active(),
                "{value:?} must count as an environment override"
            );
        }
        match previous {
            Some(value) => std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", value),
            None => std::env::remove_var("WEBKIT_DISABLE_DMABUF_RENDERER"),
        }
    }
}
