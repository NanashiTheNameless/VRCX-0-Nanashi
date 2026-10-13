use std::sync::Arc;

use serde::Serialize;
use vrcx_0_application_core::RuntimeEventPayload;

use crate::DesktopRuntimeServices;

#[cfg(windows)]
use std::sync::{Mutex, Weak};
#[cfg(windows)]
use vrcx_0_application_activity::{
    ActivityDelivery, ActivitySink, ActivitySinkRegistry, ActivitySnapshot,
};
#[cfg(windows)]
use vrcx_0_application_core::{
    RuntimeAuthScope, RuntimeAuthScopeObserver, RuntimeAuthScopeSnapshot, RuntimeEventBus,
};
#[cfg(windows)]
use vrcx_0_core::OwnerId;
#[cfg(windows)]
pub(crate) use vrcx_0_overlay_runtime::desktop_widget::is_desktop_widget_config_key;
#[cfg(windows)]
use vrcx_0_overlay_runtime::desktop_widget::{
    DesktopWidgetHost, DesktopWidgetMenuCommand, DesktopWidgetRuntime, DesktopWidgetState,
    DesktopWidgetTarget, DesktopWidgetWindows, NativeDesktopWidgetWindows,
};
#[cfg(windows)]
use vrcx_0_overlay_runtime::VrOverlayRuntimeServices;
#[cfg(windows)]
use vrcx_0_persistence::config::ConfigRepository;

#[cfg(windows)]
use crate::notification::DesktopNotificationAction;
#[cfg(windows)]
use crate::{PrivacyLockRuntime, RuntimeHost};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DesktopWidgetSnapshot {
    pub supported: bool,
    pub enabled: bool,
    pub pinned: bool,
    pub click_through: bool,
}

impl RuntimeEventPayload for DesktopWidgetSnapshot {
    const EVENT_NAME: &'static str = "desktopWidgetState";
}

pub struct DesktopWidget {
    #[cfg(windows)]
    runtime: Arc<DesktopWidgetRuntime>,
    #[cfg(windows)]
    _account_switch: Arc<AccountSwitch>,
}

#[cfg(windows)]
pub(crate) struct DesktopWidgetParts {
    pub(crate) config: ConfigRepository,
    pub(crate) host: RuntimeHost,
    pub(crate) event_bus: RuntimeEventBus,
    pub(crate) auth_scope: RuntimeAuthScope,
    pub(crate) privacy_lock: Arc<PrivacyLockRuntime>,
    pub(crate) activity_sinks: ActivitySinkRegistry,
    pub(crate) services: Option<Arc<dyn VrOverlayRuntimeServices>>,
}

impl DesktopWidget {
    pub fn new(services: &Arc<DesktopRuntimeServices>) -> Self {
        #[cfg(windows)]
        {
            let overlay_services: Arc<dyn VrOverlayRuntimeServices> = services.clone();
            Self::assemble(
                DesktopWidgetParts {
                    config: services.config().clone(),
                    host: services.host.clone(),
                    event_bus: services.event_bus(),
                    auth_scope: services.auth_scope().clone(),
                    privacy_lock: services.privacy_lock(),
                    activity_sinks: services.activity_sinks(),
                    services: Some(overlay_services),
                },
                Arc::new(NativeDesktopWidgetWindows::new()),
            )
        }

        #[cfg(not(windows))]
        {
            let _ = services;
            Self {}
        }
    }

    #[cfg(windows)]
    pub(crate) fn assemble(
        parts: DesktopWidgetParts,
        windows: Arc<dyn DesktopWidgetWindows>,
    ) -> Self {
        let host = Arc::new(HostBridge {
            host: parts.host,
            event_bus: parts.event_bus,
            auth_scope: parts.auth_scope.clone(),
        });
        let runtime =
            DesktopWidgetRuntime::new(parts.config, host, windows, parts.privacy_lock.is_locked());
        if let Some(services) = parts.services {
            runtime.attach_services(services);
        }
        parts
            .activity_sinks
            .add(Arc::new(WidgetActivitySink(Arc::downgrade(&runtime))));
        let lock_runtime = Arc::downgrade(&runtime);
        parts.privacy_lock.add_observer(Arc::new(move |snapshot| {
            if let Some(runtime) = lock_runtime.upgrade() {
                runtime.set_privacy_locked(snapshot.locked);
            }
        }));
        let account_switch = Arc::new(AccountSwitch {
            runtime: Arc::downgrade(&runtime),
            user_id: Mutex::new(parts.auth_scope.snapshot().current_user_id),
        });
        parts.auth_scope.add_observer(account_switch.clone());
        Self {
            runtime,
            _account_switch: account_switch,
        }
    }

    #[cfg(all(test, windows))]
    pub(crate) fn runtime(&self) -> Arc<DesktopWidgetRuntime> {
        Arc::clone(&self.runtime)
    }

    pub fn snapshot(&self) -> DesktopWidgetSnapshot {
        #[cfg(windows)]
        {
            snapshot_of(self.runtime.state())
        }

        #[cfg(not(windows))]
        {
            DesktopWidgetSnapshot::default()
        }
    }

    pub fn set_enabled(
        &self,
        enabled: bool,
    ) -> vrcx_0_application_core::Result<DesktopWidgetSnapshot> {
        #[cfg(windows)]
        {
            Ok(snapshot_of(self.runtime.set_enabled(enabled)?))
        }

        #[cfg(not(windows))]
        {
            let _ = enabled;
            Ok(self.snapshot())
        }
    }

    pub fn toggle_pinned(&self) -> vrcx_0_application_core::Result<DesktopWidgetSnapshot> {
        #[cfg(windows)]
        {
            Ok(snapshot_of(
                self.runtime
                    .menu_command(DesktopWidgetMenuCommand::TogglePinned)?,
            ))
        }

        #[cfg(not(windows))]
        {
            Ok(self.snapshot())
        }
    }

    pub fn toggle_click_through(&self) -> vrcx_0_application_core::Result<DesktopWidgetSnapshot> {
        #[cfg(windows)]
        {
            Ok(snapshot_of(self.runtime.menu_command(
                DesktopWidgetMenuCommand::ToggleClickThrough,
            )?))
        }

        #[cfg(not(windows))]
        {
            Ok(self.snapshot())
        }
    }

    pub fn bring_to_front(&self) {
        #[cfg(windows)]
        self.runtime.bring_to_front();
    }

    pub fn reload_settings(&self) {
        #[cfg(windows)]
        self.runtime.reload_settings();
    }

    pub fn shutdown(&self) {
        #[cfg(windows)]
        self.runtime.shutdown();
    }
}

#[cfg(not(windows))]
pub(crate) fn is_desktop_widget_config_key(_key: &str) -> bool {
    false
}

#[cfg(windows)]
fn snapshot_of(state: DesktopWidgetState) -> DesktopWidgetSnapshot {
    DesktopWidgetSnapshot {
        supported: true,
        enabled: state.enabled,
        pinned: state.pinned,
        click_through: state.click_through,
    }
}

#[cfg(windows)]
struct HostBridge {
    host: RuntimeHost,
    event_bus: RuntimeEventBus,
    auth_scope: RuntimeAuthScope,
}

#[cfg(windows)]
impl DesktopWidgetHost for HostBridge {
    fn open_target(&self, target: DesktopWidgetTarget) {
        let owner = OwnerId::new(self.auth_scope.snapshot().current_user_id);
        let action = match target {
            DesktopWidgetTarget::User { user_id } => {
                DesktopNotificationAction::open_user_profile(&owner, &user_id)
            }
            DesktopWidgetTarget::Location { location } => {
                DesktopNotificationAction::open_location(&owner, &location)
            }
        };
        if let Some(action) = action {
            self.host.open_activity_target(action);
        }
    }

    fn state_changed(&self, state: DesktopWidgetState) {
        self.event_bus.emit(snapshot_of(state));
        self.host.refresh_tray_menu();
    }
}

#[cfg(windows)]
struct WidgetActivitySink(Weak<DesktopWidgetRuntime>);

#[cfg(windows)]
impl ActivitySink for WidgetActivitySink {
    fn emit_overlay_activity_snapshot(&self, _snapshot: ActivitySnapshot) {}

    fn emit_overlay_activity_delivery(&self, delivery: ActivityDelivery) {
        if let Some(runtime) = self.0.upgrade() {
            runtime.ingest_delivery(delivery);
        }
    }
}

#[cfg(windows)]
struct AccountSwitch {
    runtime: Weak<DesktopWidgetRuntime>,
    user_id: Mutex<String>,
}

#[cfg(windows)]
impl RuntimeAuthScopeObserver for AccountSwitch {
    fn runtime_auth_scope_changed(&self, scope: &RuntimeAuthScopeSnapshot) {
        let changed = self
            .user_id
            .lock()
            .map(|mut user_id| {
                std::mem::replace(&mut *user_id, scope.current_user_id.clone())
                    != scope.current_user_id
            })
            .unwrap_or(false);
        if changed {
            if let Some(runtime) = self.runtime.upgrade() {
                runtime.clear_activity();
            }
        }
    }
}

#[cfg(all(test, windows))]
mod tests;
