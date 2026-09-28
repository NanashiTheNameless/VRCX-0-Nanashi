use std::time::Duration;

use tauri::Manager;
use tauri_plugin_notification::NotificationExt;
#[cfg(test)]
use vrcx_0_application_core::FriendProfileLoadStatusPayload;
use vrcx_0_application_core::{
    BackendRuntimeAuthStatus, BackendRuntimeMode, BackendRuntimePhase, BackendRuntimeSnapshot,
};
#[cfg(test)]
use vrcx_0_application_core::{BackendRuntimeGameLogStatus, BackendRuntimeProcessStatus};
use vrcx_0_application_core::{RuntimeRealtimeTransportEpoch, RuntimeVrchatAuthFailurePayload};
use vrcx_0_application_realtime::RealtimeTransportStartResult;
use vrcx_0_composition::Error as RuntimeHostError;
#[cfg(test)]
use vrcx_0_core::realtime::RealtimeWsStatus;

use crate::localization::shell_locale::{
    self, AuthFailureNotificationLabels, BackgroundModeNotificationLabels, TrayLabels,
};
use crate::state::AppState;

use super::shared::{app_language, db_config_bool};

const AUTH_FAILURE_NOTIFICATION_COOLDOWN: Duration = Duration::from_secs(5);

pub(super) fn handle_runtime_auth_failure_notification(
    app_handle: &tauri::AppHandle,
    failure: &RuntimeVrchatAuthFailurePayload,
) {
    if !is_actionable_runtime_auth_failure(failure) {
        return;
    }
    let Some(state) = app_handle.try_state::<AppState>() else {
        return;
    };
    if !runtime_auth_failure_matches_active_source(&state, failure) {
        return;
    }
    let reason = &failure.reason;
    let snapshot = state.runtime_host().backend_runtime_snapshot();
    if !should_show_runtime_auth_failure_notification(&snapshot, failure.status_code) {
        return;
    }

    let user_id = snapshot.auth_user_id.trim().to_string();
    let notification_key = format!("{user_id}\n{reason}");
    show_auth_failure_notification_once(app_handle, &state, &notification_key);
}

pub(super) fn handle_runtime_auth_failure_recovery(
    app_handle: &tauri::AppHandle,
    failure: &RuntimeVrchatAuthFailurePayload,
) {
    if !is_actionable_runtime_auth_failure(failure) {
        return;
    }
    let Some(state) = app_handle.try_state::<AppState>() else {
        return;
    };
    if !runtime_auth_failure_matches_active_source(&state, failure) {
        return;
    }
    let failure = failure.clone();
    let app_handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        let Some(state) = app_handle.try_state::<AppState>() else {
            return;
        };
        if !runtime_auth_failure_matches_scope(&state, &failure) {
            return;
        }
        state
            .runtime_host()
            .recover_background_auth_after_failure(failure.reason)
            .await;
    });
}

fn is_actionable_runtime_auth_failure(failure: &RuntimeVrchatAuthFailurePayload) -> bool {
    failure.status_code == 401
        || (failure.status_code == 403 && failure.realtime_transport.is_some())
}

fn runtime_auth_failure_matches_scope(
    state: &AppState,
    failure: &RuntimeVrchatAuthFailurePayload,
) -> bool {
    let scope = state.runtime_host().auth_scope_snapshot();
    scope.active
        && scope.current_user_id == failure.owner_user_id.as_str()
        && scope.endpoint == failure.endpoint
        && scope.generation == failure.auth_scope_generation
}

fn runtime_auth_failure_matches_active_source(
    state: &AppState,
    failure: &RuntimeVrchatAuthFailurePayload,
) -> bool {
    runtime_auth_failure_matches_scope(state, failure)
        && runtime_auth_failure_transport_matches(
            state.runtime_host().active_realtime_transport().as_ref(),
            failure.realtime_transport.as_ref(),
        )
}

fn runtime_auth_failure_transport_matches(
    active: Option<&RealtimeTransportStartResult>,
    expected: Option<&RuntimeRealtimeTransportEpoch>,
) -> bool {
    match expected {
        None => true,
        Some(expected) => active.is_some_and(|active| {
            active.client_run_id == expected.client_run_id
                && active.generation == expected.generation
                && active.session_generation == expected.session_generation
        }),
    }
}

fn should_show_runtime_auth_failure_notification(
    snapshot: &BackendRuntimeSnapshot,
    status_code: i32,
) -> bool {
    snapshot.auth_status == BackendRuntimeAuthStatus::InteractionRequired && status_code != 401
}

fn should_show_backend_start_auth_notification(
    snapshot: &BackendRuntimeSnapshot,
    error: &RuntimeHostError,
) -> bool {
    match error {
        RuntimeHostError::AuthInteractionRequired(_) => {
            snapshot.auth_status == BackendRuntimeAuthStatus::InteractionRequired
        }
        RuntimeHostError::AuthSessionInvalidated {
            status_code: Some(401),
            ..
        } => false,
        RuntimeHostError::AuthSessionInvalidated { .. } => {
            snapshot.phase == BackendRuntimePhase::Idle
                && snapshot.auth_status == BackendRuntimeAuthStatus::SignedOut
        }
        _ => false,
    }
}

pub(crate) fn show_auth_failure_notification_once(
    app_handle: &tauri::AppHandle,
    state: &AppState,
    key: &str,
) {
    let key = key.trim();
    let notification_key = if key.is_empty() {
        "auth-failure".to_string()
    } else {
        format!("auth-failure\n{key}")
    };
    if !state.should_emit_auth_failure_notification(
        &notification_key,
        AUTH_FAILURE_NOTIFICATION_COOLDOWN,
    ) {
        return;
    }

    let labels = auth_failure_notification_labels(state);
    if let Err(error) = app_handle
        .notification()
        .builder()
        .title(labels.title)
        .body(labels.body)
        .show()
    {
        tracing::warn!(error = %error, "failed to show auth failure notification");
    }
}

pub(crate) fn show_auth_failure_notification_after_backend_start_error(
    app_handle: &tauri::AppHandle,
    state: &AppState,
    error: &RuntimeHostError,
) {
    let snapshot = state.runtime_host().backend_runtime_snapshot();
    if !should_show_backend_start_auth_notification(&snapshot, error) {
        return;
    }

    let reason = error.to_string();
    show_auth_failure_notification_once(app_handle, state, &reason);
}

pub(crate) fn show_background_mode_started_notification(app: &tauri::AppHandle, state: &AppState) {
    let labels = background_mode_notification_labels(state);
    if let Err(error) = app
        .notification()
        .builder()
        .title(labels.title)
        .body(labels.body)
        .show()
    {
        tracing::warn!(error = %error, "failed to show background mode notification");
    }
}

pub(super) fn is_background_mode_active(state: &AppState) -> bool {
    let snapshot = state.runtime_host().backend_runtime_snapshot();
    snapshot.mode == BackendRuntimeMode::Background
        && snapshot.phase == BackendRuntimePhase::Running
}

pub(super) fn is_community_theme_enabled(state: &AppState) -> bool {
    db_config_bool(state, "config:vrcx_communitythemeenabled") == Some(true)
}

fn background_mode_notification_labels(state: &AppState) -> BackgroundModeNotificationLabels {
    shell_locale::background_mode_notification_labels_for_language(&app_language(state))
}

fn auth_failure_notification_labels(state: &AppState) -> AuthFailureNotificationLabels {
    auth_failure_notification_labels_for_language(&app_language(state))
}

fn auth_failure_notification_labels_for_language(language: &str) -> AuthFailureNotificationLabels {
    shell_locale::auth_failure_notification_labels_for_language(language)
}

pub(super) fn tray_labels(state: &AppState) -> TrayLabels {
    shell_locale::tray_labels_for_language(&app_language(state))
}

#[cfg(test)]
mod tests {
    use vrcx_0_core::OwnerId;

    use super::*;

    fn backend_snapshot(
        phase: BackendRuntimePhase,
        auth_status: BackendRuntimeAuthStatus,
        auth_user_id: &str,
        ws_status: RealtimeWsStatus,
    ) -> BackendRuntimeSnapshot {
        BackendRuntimeSnapshot {
            mode: BackendRuntimeMode::Background,
            phase,
            auth_status,
            auth_user_id: auth_user_id.into(),
            auth_display_name: String::new(),
            ws_status,
            game_log_status: BackendRuntimeGameLogStatus::Idle,
            process_status: BackendRuntimeProcessStatus::Unknown,
            game_log_persisted_count: 0,
            last_error: None,
            updated_at: String::new(),
            friend_profile_load: FriendProfileLoadStatusPayload::default(),
        }
    }

    fn runtime_auth_failure(
        status_code: i32,
        realtime_transport: Option<RuntimeRealtimeTransportEpoch>,
    ) -> RuntimeVrchatAuthFailurePayload {
        RuntimeVrchatAuthFailurePayload {
            owner_user_id: OwnerId::new("usr_1"),
            endpoint: "https://api.example.test/api/1".into(),
            path: "runtime/social-baseline/friends".into(),
            reason: "Missing Credentials (401)".into(),
            status_code,
            auth_scope_generation: 3,
            realtime_transport,
        }
    }

    #[test]
    fn auth_failure_notification_labels_fall_back_to_english() {
        let english = auth_failure_notification_labels_for_language("en").title;
        for language in ["zh-CN", "zh-TW", "ja"] {
            assert_eq!(
                auth_failure_notification_labels_for_language(language).title,
                english
            );
        }
    }

    #[test]
    fn realtime_auth_failure_notification_skips_recoverable_websocket_401() {
        let snapshot = backend_snapshot(
            BackendRuntimePhase::Running,
            BackendRuntimeAuthStatus::Authenticated,
            "usr_1",
            RealtimeWsStatus::AuthFailure,
        );
        assert!(!should_show_runtime_auth_failure_notification(
            &snapshot, 401
        ));
    }

    #[test]
    fn typed_http_failure_policy_only_accepts_actionable_statuses() {
        assert!(is_actionable_runtime_auth_failure(&runtime_auth_failure(
            401, None
        )));
        assert!(!is_actionable_runtime_auth_failure(&runtime_auth_failure(
            403, None
        )));
    }

    #[test]
    fn realtime_403_requires_the_matching_transport_epoch() {
        let failure = runtime_auth_failure(
            403,
            Some(RuntimeRealtimeTransportEpoch {
                client_run_id: 5,
                generation: 7,
                session_generation: 11,
            }),
        );
        assert!(is_actionable_runtime_auth_failure(&failure));
        let active = RealtimeTransportStartResult {
            client_run_id: 5,
            generation: 7,
            session_generation: 11,
        };
        let stale = RealtimeTransportStartResult {
            generation: 6,
            ..active.clone()
        };

        assert!(runtime_auth_failure_transport_matches(
            Some(&active),
            failure.realtime_transport.as_ref()
        ));
        assert!(!runtime_auth_failure_transport_matches(
            Some(&stale),
            failure.realtime_transport.as_ref()
        ));
        assert!(!runtime_auth_failure_transport_matches(
            None,
            failure.realtime_transport.as_ref()
        ));
    }

    #[test]
    fn backend_start_auth_notification_requires_manual_action() {
        let recoverable = backend_snapshot(
            BackendRuntimePhase::Idle,
            BackendRuntimeAuthStatus::SignedOut,
            "",
            RealtimeWsStatus::Idle,
        );
        assert!(!should_show_backend_start_auth_notification(
            &recoverable,
            &RuntimeHostError::AuthSessionInvalidated {
                reason: "opaque".into(),
                status_code: Some(401),
            }
        ));

        let interaction_required = backend_snapshot(
            BackendRuntimePhase::Error,
            BackendRuntimeAuthStatus::InteractionRequired,
            "",
            RealtimeWsStatus::Idle,
        );
        assert!(should_show_backend_start_auth_notification(
            &interaction_required,
            &RuntimeHostError::AuthInteractionRequired("opaque".into())
        ));

        let invalid_session = backend_snapshot(
            BackendRuntimePhase::Idle,
            BackendRuntimeAuthStatus::SignedOut,
            "",
            RealtimeWsStatus::Idle,
        );
        assert!(should_show_backend_start_auth_notification(
            &invalid_session,
            &RuntimeHostError::AuthSessionInvalidated {
                reason: "opaque".into(),
                status_code: Some(403),
            }
        ));
    }
}
