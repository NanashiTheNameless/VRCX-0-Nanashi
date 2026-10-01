use std::sync::{Arc, Mutex};

use serde_json::Value;
use vrcx_0_application_core::{BackendRuntime, RuntimeBackgroundJobs};
use vrcx_0_application_realtime::RealtimeHostRuntime;

use crate::RuntimeHostContext;

use super::super::{
    background_capability_session_identity, background_capability_session_matches,
    emit_background_info, emit_background_warning, gui_maintenance_runtime_mode,
    AuthenticatedSessionProjection, BACKGROUND_CURRENT_USER_CADENCE_SECONDS,
    BACKGROUND_CURRENT_USER_REFRESH_JOB,
};

pub(in crate::state) async fn run_background_current_user_refresh(
    session_slot: &Arc<Mutex<AuthenticatedSessionProjection>>,
    realtime_runtime: &Arc<RealtimeHostRuntime>,
    runtime_context: &Arc<RuntimeHostContext>,
    backend_runtime: &BackendRuntime,
    background_jobs: &RuntimeBackgroundJobs,
) {
    background_jobs.mark_running(
        BACKGROUND_CURRENT_USER_REFRESH_JOB,
        "Refreshing background current user facts.",
    );
    let Some(session) = background_capability_session_identity(session_slot) else {
        background_jobs.mark_scheduled(
            BACKGROUND_CURRENT_USER_REFRESH_JOB,
            "Background current user refresh is waiting for an authenticated session.",
            BACKGROUND_CURRENT_USER_CADENCE_SECONDS,
        );
        return;
    };
    match realtime_runtime.refresh_current_user_now(Value::Null).await {
        Ok(accepted) => {
            if !background_capability_session_matches(session_slot, &session) {
                tracing::warn!("ignored stale background current user refresh");
            } else if !accepted {
                tracing::warn!("ignored background current user refresh rejected by realtime");
            }
            let detail = "current user facts refreshed.";
            emit_background_info(runtime_context, backend_runtime, detail);
            background_jobs.mark_completed(BACKGROUND_CURRENT_USER_REFRESH_JOB, detail);
        }
        Err(error) => {
            tracing::warn!(
                runtime_mode = %gui_maintenance_runtime_mode(backend_runtime),
                error = %error,
                "GUI maintenance current user network request failed"
            );
            emit_background_warning(
                runtime_context,
                backend_runtime,
                format!("current user refresh failed: {error}."),
            );
            background_jobs.mark_failed(BACKGROUND_CURRENT_USER_REFRESH_JOB, error.to_string());
        }
    }
    background_jobs.mark_scheduled(
        BACKGROUND_CURRENT_USER_REFRESH_JOB,
        "Next background current user facts refresh is waiting.",
        BACKGROUND_CURRENT_USER_CADENCE_SECONDS,
    );
}
