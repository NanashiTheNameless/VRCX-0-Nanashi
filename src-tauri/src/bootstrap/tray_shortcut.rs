//! Global "show/hide main window" shortcut. Windows records keys with a
//! low-level hook (so keys the webview never sees still work); Linux (X11) and
//! macOS record from the focused settings input and register through
//! tauri-plugin-global-shortcut.

use tauri::AppHandle;
use tauri::Manager;
use vrcx_0_runtime_host_desktop::tray_shortcut::{
    TrayShortcutBinding, TrayShortcutError, TrayShortcutRuntime, TrayShortcutSnapshot,
    TrayShortcutUpdate,
};

use crate::error::AppError;
use crate::state::AppState;

const PREFERENCE_KEY: &str = "VRCX_TrayShortcut";

pub(crate) fn setup(app: &AppHandle, state: &AppState) {
    native::setup(app, state);
}

async fn on_main_thread<T: Send + 'static>(
    app: &AppHandle,
    action: impl FnOnce(&AppHandle) -> T + Send + 'static,
) -> Result<T, AppError> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let main_app = app.clone();
    app.run_on_main_thread(move || {
        let _ = sender.send(action(&main_app));
    })
    .map_err(|error| AppError::Custom(error.to_string()))?;
    receiver
        .await
        .map_err(|error| AppError::Custom(error.to_string()))
}

pub(crate) async fn snapshot(app: &AppHandle) -> Result<TrayShortcutSnapshot, AppError> {
    on_main_thread(app, native::snapshot).await
}

pub(crate) async fn configure(
    app: &AppHandle,
    binding: Option<TrayShortcutBinding>,
) -> Result<TrayShortcutUpdate, AppError> {
    on_main_thread(app, move |app| native::configure(app, binding)).await
}

pub(crate) async fn check(
    app: &AppHandle,
    binding: TrayShortcutBinding,
) -> Result<Option<TrayShortcutError>, AppError> {
    on_main_thread(app, move |app| native::check(app, binding)).await
}

pub(crate) async fn set_recording(app: &AppHandle, recording: bool) -> Result<bool, AppError> {
    on_main_thread(app, move |app| native::set_recording(app, recording)).await?
}

pub(crate) fn stop_recording(app: &AppHandle) -> Result<(), AppError> {
    native::set_recording(app, false)?;
    Ok(())
}

pub(crate) fn take_startup_failure(app: &AppHandle) -> bool {
    if let Some(shared) = app.try_state::<native::Shared>() {
        return shared
            .startup_notice_pending
            .swap(false, std::sync::atomic::Ordering::AcqRel);
    }
    false
}

mod native {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::sync::Mutex;
    #[cfg(windows)]
    use tauri::Emitter;
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
    use vrcx_0_runtime_host_desktop::tray_shortcut::{TrayShortcutRegistrar, TrayShortcutStatus};

    pub(super) struct Shared {
        runtime: Mutex<TrayShortcutRuntime>,
        active_id: AtomicU32,
        pub recording: AtomicBool,
        pub startup_notice_pending: AtomicBool,
    }

    fn shortcut(binding: &TrayShortcutBinding) -> Result<Shortcut, TrayShortcutError> {
        binding
            .accelerator()
            .parse()
            .map_err(|_| TrayShortcutError::Invalid)
    }

    struct Registrar<'a>(&'a AppHandle);

    #[cfg(not(windows))]
    fn check_platform_shortcut(binding: &TrayShortcutBinding) -> Result<(), TrayShortcutError> {
        // No side-effect-free probe exists here; registration reports conflicts.
        shortcut(binding).map(|_| ())
    }

    #[cfg(windows)]
    fn check_platform_shortcut(binding: &TrayShortcutBinding) -> Result<(), TrayShortcutError> {
        use vrcx_0_host_desktop::shortcut_recorder::{
            self, ProbeError, MOD_ALT, MOD_CONTROL, MOD_SHIFT,
        };
        shortcut(binding)?;
        let mut modifiers = 0;
        for (enabled, modifier) in [
            (binding.control, MOD_CONTROL),
            (binding.alt, MOD_ALT),
            (binding.shift, MOD_SHIFT),
        ] {
            if enabled {
                modifiers |= modifier;
            }
        }
        shortcut_recorder::check(&binding.key, modifiers).map_err(|error| match error {
            ProbeError::InUse => TrayShortcutError::InUse,
            ProbeError::Unavailable(error) => {
                tracing::error!(%error, "failed to check the global tray shortcut");
                TrayShortcutError::Unavailable
            }
        })
    }

    impl TrayShortcutRegistrar for Registrar<'_> {
        fn register(&self, binding: &TrayShortcutBinding) -> Result<(), TrayShortcutError> {
            let native = shortcut(binding)?;
            self.0
                .global_shortcut()
                .on_shortcut(native, move |app, shortcut, event| {
                    let Some(shared) = app.try_state::<Shared>() else {
                        return;
                    };
                    if shared.active_id.load(Ordering::Acquire) != shortcut.id() {
                        return;
                    }
                    if event.state() == ShortcutState::Released {
                        return;
                    }
                    if shared.recording.load(Ordering::Acquire) {
                        return;
                    }
                    let shortcut_id = shortcut.id();
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let main_app = app.clone();
                        if let Err(error) = app.run_on_main_thread(move || {
                            if let Some(shared) = main_app.try_state::<Shared>() {
                                if shared.active_id.load(Ordering::Acquire) == shortcut_id
                                    && !shared.recording.load(Ordering::Acquire)
                                {
                                    crate::app::toggle_main_window_from_shortcut(&main_app);
                                }
                            }
                        }) {
                            tracing::error!(%error, "failed to dispatch the global tray shortcut");
                        }
                    });
                })
                .map_err(|error| {
                    tracing::error!(%error, "failed to register the global tray shortcut");
                    TrayShortcutError::Unavailable
                })
        }

        fn unregister(&self, binding: &TrayShortcutBinding) -> Result<(), TrayShortcutError> {
            self.0
                .global_shortcut()
                .unregister(shortcut(binding)?)
                .map_err(|error| {
                    tracing::error!(%error, "failed to unregister the global tray shortcut");
                    TrayShortcutError::Unavailable
                })
        }

        fn check(&self, binding: &TrayShortcutBinding) -> Result<(), TrayShortcutError> {
            check_platform_shortcut(binding)
        }
    }

    pub(super) fn set_recording(app: &AppHandle, requested: bool) -> Result<bool, AppError> {
        let window = app.get_webview_window("main");
        let recording = requested
            && window
                .as_ref()
                .is_some_and(|window| window.is_focused().unwrap_or(false));
        #[cfg(windows)]
        if !recording {
            vrcx_0_host_desktop::shortcut_recorder::stop();
        }
        let Some(shared) = app.try_state::<Shared>() else {
            return if requested {
                Err(AppError::Custom(
                    "Global shortcut service is unavailable".into(),
                ))
            } else {
                Ok(false)
            };
        };
        shared.recording.store(false, Ordering::Release);
        #[cfg(windows)]
        if recording {
            start_windows_recorder(app, window)?;
        }
        // Elsewhere the focused settings input records keys from the webview;
        // the flag only keeps the current shortcut from firing meanwhile.
        #[cfg(not(windows))]
        let _ = window;
        shared.recording.store(recording, Ordering::Release);
        Ok(recording)
    }

    #[cfg(windows)]
    fn start_windows_recorder(
        app: &AppHandle,
        window: Option<tauri::WebviewWindow>,
    ) -> Result<(), AppError> {
        use vrcx_0_host_desktop::shortcut_recorder::{self, MOD_ALT, MOD_CONTROL, MOD_SHIFT};
        let window = window.ok_or_else(|| AppError::Custom("Main window is unavailable".into()))?;
        let handle = window
            .hwnd()
            .map_err(|error| AppError::Custom(error.to_string()))?
            .0 as isize;
        let app = app.clone();
        shortcut_recorder::start(handle, move |key| {
            let Some(code) = shortcut_recorder::code_name(key.virtual_key) else {
                return;
            };
            let binding = TrayShortcutBinding {
                key: code,
                control: key.modifiers & MOD_CONTROL != 0,
                alt: key.modifiers & MOD_ALT != 0,
                shift: key.modifiers & MOD_SHIFT != 0,
            };
            let _ = app.emit_to("main", "trayShortcutRecorded", binding);
        })
        .map_err(AppError::Custom)
    }

    pub(super) fn snapshot(app: &AppHandle) -> TrayShortcutSnapshot {
        let Some(shared) = app.try_state::<Shared>() else {
            return TrayShortcutRuntime::new(None, false).snapshot();
        };
        let runtime = shared
            .runtime
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        runtime.snapshot()
    }

    pub(super) fn check(
        app: &AppHandle,
        binding: TrayShortcutBinding,
    ) -> Option<TrayShortcutError> {
        let Some(shared) = app.try_state::<Shared>() else {
            return Some(TrayShortcutError::Unsupported);
        };
        let runtime = shared
            .runtime
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        runtime.check(&binding, &Registrar(app)).err()
    }

    fn publish_active_binding(shared: &Shared, snapshot: &TrayShortcutSnapshot) {
        let id = if snapshot.status == TrayShortcutStatus::Active {
            snapshot
                .binding
                .as_ref()
                .and_then(|binding| shortcut(binding).ok())
                .map(|shortcut| shortcut.id())
                .unwrap_or(0)
        } else {
            0
        };
        shared.active_id.store(id, Ordering::Release);
    }

    pub(super) fn setup(app: &AppHandle, state: &AppState) {
        let binding = state
            .runtime_host()
            .storage_get(PREFERENCE_KEY)
            .and_then(|raw| {
                serde_json::from_str::<TrayShortcutBinding>(&raw)
                    .map_err(|error| {
                        tracing::warn!(%error, "failed to read the saved global tray shortcut");
                    })
                    .ok()
            });
        let available = app
            .plugin(tauri_plugin_global_shortcut::Builder::new().build())
            .map_err(|error| tracing::error!(%error, "global tray shortcuts are unavailable"))
            .is_ok();
        let mut runtime = TrayShortcutRuntime::new(binding.clone(), available);
        let startup_notice_pending =
            binding.is_some() && runtime.configure(binding, &Registrar(app)).is_err();
        let snapshot = runtime.snapshot();
        let shared = Shared {
            runtime: Mutex::new(runtime),
            active_id: AtomicU32::new(0),
            recording: AtomicBool::new(false),
            startup_notice_pending: AtomicBool::new(startup_notice_pending),
        };
        publish_active_binding(&shared, &snapshot);
        app.manage(shared);
    }

    pub(super) fn configure(
        app: &AppHandle,
        binding: Option<TrayShortcutBinding>,
    ) -> TrayShortcutUpdate {
        let Some(shared) = app.try_state::<Shared>() else {
            return TrayShortcutUpdate::Failed {
                error: TrayShortcutError::Unsupported,
                snapshot: snapshot(app),
            };
        };
        let mut runtime = shared
            .runtime
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        match runtime.configure(binding, &Registrar(app)) {
            Ok(snapshot) => {
                let state = app.state::<AppState>();
                if let Some(binding) = &snapshot.binding {
                    state.runtime_host().storage_set(
                        PREFERENCE_KEY.into(),
                        serde_json::to_string(binding).expect("tray shortcut serialization"),
                    );
                } else {
                    state.runtime_host().storage_remove(PREFERENCE_KEY);
                }
                publish_active_binding(&shared, &snapshot);
                shared
                    .startup_notice_pending
                    .store(false, Ordering::Release);
                TrayShortcutUpdate::Saved { snapshot }
            }
            Err(error) => TrayShortcutUpdate::Failed {
                error,
                snapshot: runtime.snapshot(),
            },
        }
    }
}
