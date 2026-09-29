use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use vrcx_0_core::realtime::{RealtimeWsStatus, RealtimeWsStatusPayload};
use vrcx_0_core::time::now_iso;

use crate::events::FriendProfileLoadStatusPayload;
use crate::ports::HostSessionProjection;
use crate::RuntimeEventBus;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum BackendRuntimeMode {
    #[default]
    Foreground,
    Background,
    Headless,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GuiRuntimeMode {
    Foreground,
    Background,
}

impl GuiRuntimeMode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Foreground => "foreground",
            Self::Background => "background",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeHostProfile {
    Desktop,
    HeadlessData,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum BackendRuntimePhase {
    #[default]
    Idle,
    Starting,
    Authenticating,
    Running,
    Stopping,
    Error,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum BackendRuntimeAuthStatus {
    #[default]
    Unknown,
    Authenticating,
    Authenticated,
    InteractionRequired,
    Error,
    SignedOut,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum BackendRuntimeGameLogStatus {
    #[default]
    Idle,
    Running,
    Persisted,
    Unavailable,
}

impl BackendRuntimeGameLogStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Running => "running",
            Self::Persisted => "persisted",
            Self::Unavailable => "unavailable",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum BackendRuntimeProcessStatus {
    #[default]
    Unknown,
    VrchatRunning,
    VrchatStopped,
}

impl BackendRuntimeProcessStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::VrchatRunning => "vrchatRunning",
            Self::VrchatStopped => "vrchatStopped",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum BackendRuntimeTelemetryKind {
    WsStatus,
    ProcessStatus,
    GameLogPersisted,
    RuntimeStarted,
    RuntimeStopped,
    ModeChanged,
    AuthCleared,
    AuthSuccess,
    AuthRecoveryStarted,
    AuthRecoveryFailed,
    GameLogWatcher,
    BackgroundInfo,
    BackgroundWarning,
    BackgroundError,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BackendRuntimeSnapshot {
    pub mode: BackendRuntimeMode,
    pub phase: BackendRuntimePhase,
    pub auth_status: BackendRuntimeAuthStatus,
    pub auth_user_id: String,
    pub auth_display_name: String,
    pub ws_status: RealtimeWsStatus,
    pub game_log_status: BackendRuntimeGameLogStatus,
    pub process_status: BackendRuntimeProcessStatus,
    pub game_log_persisted_count: u64,
    pub last_error: Option<String>,
    pub updated_at: String,
    pub friend_profile_load: FriendProfileLoadStatusPayload,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BackendRuntimeTelemetry {
    pub kind: BackendRuntimeTelemetryKind,
    pub detail: String,
    pub snapshot: BackendRuntimeSnapshot,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeProjectionSync {
    pub snapshot: BackendRuntimeSnapshot,
}

#[derive(Clone, Debug)]
struct BackendRuntimeState {
    gui_mode: GuiRuntimeMode,
    phase: BackendRuntimePhase,
    auth_status: BackendRuntimeAuthStatus,
    auth_user_id: String,
    auth_display_name: String,
    ws_status: RealtimeWsStatus,
    game_log_status: BackendRuntimeGameLogStatus,
    process_status: BackendRuntimeProcessStatus,
    game_log_persisted_count: u64,
    last_error: Option<String>,
    updated_at: String,
    friend_profile_load: FriendProfileLoadStatusPayload,
}

impl Default for BackendRuntimeState {
    fn default() -> Self {
        Self {
            gui_mode: GuiRuntimeMode::Foreground,
            phase: BackendRuntimePhase::Idle,
            auth_status: BackendRuntimeAuthStatus::Unknown,
            auth_user_id: String::new(),
            auth_display_name: String::new(),
            ws_status: RealtimeWsStatus::Idle,
            game_log_status: BackendRuntimeGameLogStatus::Idle,
            process_status: BackendRuntimeProcessStatus::Unknown,
            game_log_persisted_count: 0,
            last_error: None,
            updated_at: now_iso(),
            friend_profile_load: FriendProfileLoadStatusPayload::default(),
        }
    }
}

#[derive(Clone)]
pub struct BackendRuntime {
    profile: RuntimeHostProfile,
    state: Arc<Mutex<BackendRuntimeState>>,
}

impl BackendRuntime {
    pub fn new(profile: RuntimeHostProfile) -> Self {
        Self {
            profile,
            state: Arc::new(Mutex::new(BackendRuntimeState::default())),
        }
    }

    pub fn profile(&self) -> RuntimeHostProfile {
        self.profile
    }

    pub fn gui_mode(&self) -> Option<GuiRuntimeMode> {
        (self.profile == RuntimeHostProfile::Desktop).then(|| self.lock_state().gui_mode)
    }

    pub fn set_gui_mode(&self, mode: GuiRuntimeMode) -> BackendRuntimeSnapshot {
        if self.profile != RuntimeHostProfile::Desktop {
            return self.snapshot();
        }
        self.update(|state| {
            state.gui_mode = mode;
        })
    }

    pub fn set_phase(&self, phase: BackendRuntimePhase) -> BackendRuntimeSnapshot {
        self.update(|state| {
            state.phase = phase;
            if phase != BackendRuntimePhase::Error {
                state.last_error = None;
            }
        })
    }

    pub fn set_authenticating(&self) -> BackendRuntimeSnapshot {
        self.update(|state| {
            state.phase = BackendRuntimePhase::Authenticating;
            state.auth_status = BackendRuntimeAuthStatus::Authenticating;
            state.last_error = None;
        })
    }

    pub fn set_auth_success(
        &self,
        user_id: impl Into<String>,
        display_name: impl Into<String>,
    ) -> BackendRuntimeSnapshot {
        self.update(|state| {
            state.auth_status = BackendRuntimeAuthStatus::Authenticated;
            state.auth_user_id = user_id.into();
            state.auth_display_name = display_name.into();
            state.last_error = None;
        })
    }

    pub fn set_auth_interaction_required(
        &self,
        reason: impl Into<String>,
    ) -> BackendRuntimeSnapshot {
        let reason = reason.into();
        self.update(|state| {
            state.phase = BackendRuntimePhase::Error;
            state.auth_status = BackendRuntimeAuthStatus::InteractionRequired;
            state.last_error = Some(reason);
        })
    }

    pub fn set_auth_error(&self, reason: impl Into<String>) -> BackendRuntimeSnapshot {
        let reason = reason.into();
        self.update(|state| {
            state.phase = BackendRuntimePhase::Error;
            state.auth_status = BackendRuntimeAuthStatus::Error;
            state.last_error = Some(reason);
        })
    }

    pub fn clear_authentication(&self) -> BackendRuntimeSnapshot {
        self.update(|state| {
            state.phase = BackendRuntimePhase::Idle;
            state.auth_status = BackendRuntimeAuthStatus::SignedOut;
            state.auth_user_id.clear();
            state.auth_display_name.clear();
            state.ws_status = RealtimeWsStatus::Idle;
            state.last_error = None;
        })
    }

    pub fn set_ws_status(&self, status: RealtimeWsStatus) -> BackendRuntimeSnapshot {
        self.update(|state| {
            state.ws_status = status;
        })
    }

    pub fn set_game_log_status(
        &self,
        status: BackendRuntimeGameLogStatus,
    ) -> BackendRuntimeSnapshot {
        self.update(|state| {
            state.game_log_status = status;
        })
    }

    pub fn add_game_log_persisted(&self, count: u64) -> BackendRuntimeSnapshot {
        self.update(|state| {
            state.game_log_status = BackendRuntimeGameLogStatus::Persisted;
            state.game_log_persisted_count = state.game_log_persisted_count.saturating_add(count);
        })
    }

    pub fn set_process_status(
        &self,
        status: BackendRuntimeProcessStatus,
    ) -> BackendRuntimeSnapshot {
        self.update(|state| {
            state.process_status = status;
        })
    }

    pub fn set_friend_profile_load_state(
        &self,
        payload: FriendProfileLoadStatusPayload,
    ) -> BackendRuntimeSnapshot {
        self.update(|state| {
            state.friend_profile_load = payload;
        })
    }

    pub fn snapshot(&self) -> BackendRuntimeSnapshot {
        self.state_to_snapshot(&self.lock_state())
    }

    fn update(&self, update: impl FnOnce(&mut BackendRuntimeState)) -> BackendRuntimeSnapshot {
        let mut state = self.lock_state();
        update(&mut state);
        state.updated_at = now_iso();
        self.state_to_snapshot(&state)
    }

    fn state_to_snapshot(&self, state: &BackendRuntimeState) -> BackendRuntimeSnapshot {
        BackendRuntimeSnapshot {
            mode: match self.profile {
                RuntimeHostProfile::Desktop => match state.gui_mode {
                    GuiRuntimeMode::Foreground => BackendRuntimeMode::Foreground,
                    GuiRuntimeMode::Background => BackendRuntimeMode::Background,
                },
                RuntimeHostProfile::HeadlessData => BackendRuntimeMode::Headless,
            },
            phase: state.phase,
            auth_status: state.auth_status,
            auth_user_id: state.auth_user_id.clone(),
            auth_display_name: state.auth_display_name.clone(),
            ws_status: state.ws_status,
            game_log_status: state.game_log_status,
            process_status: state.process_status,
            game_log_persisted_count: state.game_log_persisted_count,
            last_error: state.last_error.clone(),
            updated_at: state.updated_at.clone(),
            friend_profile_load: state.friend_profile_load.clone(),
        }
    }

    fn lock_state(&self) -> std::sync::MutexGuard<'_, BackendRuntimeState> {
        self.state.lock().unwrap_or_else(|error| error.into_inner())
    }
}

#[derive(Clone)]
pub struct BackendRuntimeStatusPublisher {
    runtime: BackendRuntime,
    event_bus: RuntimeEventBus,
}

impl BackendRuntimeStatusPublisher {
    pub fn new(runtime: BackendRuntime, event_bus: RuntimeEventBus) -> Self {
        Self { runtime, event_bus }
    }

    pub fn publish_realtime_ws_status(&self, payload: RealtimeWsStatusPayload) {
        let snapshot = self.runtime.set_ws_status(payload.status);
        let detail = payload.status.as_str();
        self.event_bus.emit(payload);
        self.publish_telemetry(BackendRuntimeTelemetryKind::WsStatus, detail, snapshot);
    }

    pub fn publish_friend_profile_load_status(&self, payload: FriendProfileLoadStatusPayload) {
        self.runtime.set_friend_profile_load_state(payload.clone());
        self.event_bus.emit(payload);
    }

    pub fn publish_game_process_status(&self, projection: HostSessionProjection) {
        let status = if projection.is_game_running {
            BackendRuntimeProcessStatus::VrchatRunning
        } else {
            BackendRuntimeProcessStatus::VrchatStopped
        };
        let snapshot = self.runtime.set_process_status(status);
        self.event_bus.emit(projection);
        self.publish_telemetry(
            BackendRuntimeTelemetryKind::ProcessStatus,
            status.as_str(),
            snapshot,
        );
    }

    pub fn publish_game_log_persisted(&self, count: u64) {
        let snapshot = self.runtime.add_game_log_persisted(count);
        self.publish_telemetry(
            BackendRuntimeTelemetryKind::GameLogPersisted,
            count.to_string(),
            snapshot,
        );
    }

    pub fn publish_telemetry(
        &self,
        kind: BackendRuntimeTelemetryKind,
        detail: impl Into<String>,
        snapshot: BackendRuntimeSnapshot,
    ) {
        if kind != BackendRuntimeTelemetryKind::GameLogPersisted {
            self.event_bus.emit(RealtimeProjectionSync {
                snapshot: snapshot.clone(),
            });
        }
        self.event_bus.emit(BackendRuntimeTelemetry {
            kind,
            detail: detail.into(),
            snapshot,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_profile_projects_only_valid_wire_modes() {
        let desktop = BackendRuntime::new(RuntimeHostProfile::Desktop);
        assert_eq!(desktop.snapshot().mode, BackendRuntimeMode::Foreground);
        assert_eq!(desktop.gui_mode(), Some(GuiRuntimeMode::Foreground));
        assert_eq!(
            desktop.set_gui_mode(GuiRuntimeMode::Background).mode,
            BackendRuntimeMode::Background
        );

        let headless = BackendRuntime::new(RuntimeHostProfile::HeadlessData);
        assert_eq!(headless.snapshot().mode, BackendRuntimeMode::Headless);
        assert_eq!(headless.gui_mode(), None);
        assert_eq!(
            headless.set_gui_mode(GuiRuntimeMode::Background).mode,
            BackendRuntimeMode::Headless
        );
    }

    #[test]
    fn game_log_publisher_updates_state_before_transport_payload() {
        let runtime = BackendRuntime::new(RuntimeHostProfile::Desktop);
        let event_bus = RuntimeEventBus::new();
        let publisher = BackendRuntimeStatusPublisher::new(runtime.clone(), event_bus.clone());

        publisher.publish_game_log_persisted(3);

        let events = event_bus.take_events_for_test();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].name, "backendRuntimeTelemetry");
        assert_eq!(events[0].payload["kind"], "gameLogPersisted");
        assert_eq!(events[0].payload["detail"], "3");
        assert_eq!(events[0].payload["snapshot"]["gameLogPersistedCount"], 3);
        assert_eq!(runtime.snapshot().game_log_persisted_count, 3);
    }

    #[test]
    fn telemetry_publisher_emits_projection_before_non_game_log_telemetry() {
        let runtime = BackendRuntime::new(RuntimeHostProfile::Desktop);
        let event_bus = RuntimeEventBus::new();
        let publisher = BackendRuntimeStatusPublisher::new(runtime.clone(), event_bus.clone());
        let snapshot = runtime.set_phase(BackendRuntimePhase::Running);

        publisher.publish_telemetry(
            BackendRuntimeTelemetryKind::RuntimeStarted,
            "ready",
            snapshot,
        );

        let events = event_bus.take_events_for_test();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].name, "realtimeProjectionSync");
        assert_eq!(events[1].name, "backendRuntimeTelemetry");
        assert_eq!(events[1].payload["kind"], "runtimeStarted");
    }
}
