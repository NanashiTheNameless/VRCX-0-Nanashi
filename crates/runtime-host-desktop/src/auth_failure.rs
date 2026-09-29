use vrcx_0_application_core::{
    BackendRuntimeAuthStatus, BackendRuntimePhase, BackendRuntimeSnapshot,
    RuntimeAuthScopeSnapshot, RuntimeRealtimeTransportEpoch, RuntimeVrchatAuthFailurePayload,
};
use vrcx_0_application_realtime::RealtimeTransportStartResult;
use vrcx_0_composition::Error as RuntimeHostError;

pub fn is_actionable_runtime_auth_failure(failure: &RuntimeVrchatAuthFailurePayload) -> bool {
    failure.status_code == 401
        || (failure.status_code == 403 && failure.realtime_transport.is_some())
}

pub fn runtime_auth_failure_matches_scope(
    scope: &RuntimeAuthScopeSnapshot,
    failure: &RuntimeVrchatAuthFailurePayload,
) -> bool {
    scope.active
        && scope.current_user_id == failure.owner_user_id.as_str()
        && scope.endpoint == failure.endpoint
        && scope.generation == failure.auth_scope_generation
}

pub fn runtime_auth_failure_transport_matches(
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

pub fn should_show_runtime_auth_failure_notification(
    snapshot: &BackendRuntimeSnapshot,
    status_code: i32,
) -> bool {
    snapshot.auth_status == BackendRuntimeAuthStatus::InteractionRequired && status_code != 401
}

pub fn should_show_backend_start_auth_notification(
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

#[cfg(test)]
mod tests {
    use vrcx_0_application_core::{
        BackendRuntimeGameLogStatus, BackendRuntimeMode, BackendRuntimeProcessStatus,
        FriendProfileLoadStatusPayload,
    };
    use vrcx_0_core::realtime::RealtimeWsStatus;
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
