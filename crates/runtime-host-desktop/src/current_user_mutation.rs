use std::sync::Arc;

use vrcx_0_application::social::{
    CurrentUserMutationFuture, CurrentUserMutationPort, CurrentUserMutationRequest,
    CurrentUserMutationRuntime, CurrentUserQueryInvalidationFuture,
};
use vrcx_0_application_core::vrchat_api::{execute_api_command, VrchatScope};
use vrcx_0_application_core::{
    RemoteMutationGate, RuntimeAuthScope, RuntimeAuthScopeSnapshot, RuntimeDiagnostics,
    RuntimeSyncEngine, WebClient,
};
use vrcx_0_application_realtime::RealtimeHostRuntime;
use vrcx_0_vrchat_client::users::{
    current_user_badge_update_input, current_user_tags_add_input, current_user_tags_remove_input,
    current_user_update_input, profile_update_input,
};

pub(crate) struct CurrentUserMutationRuntimeDeps {
    pub auth_scope: RuntimeAuthScope,
    pub remote_mutations: Arc<RemoteMutationGate>,
    pub web: Arc<WebClient>,
    pub diagnostics: RuntimeDiagnostics,
    pub sync: RuntimeSyncEngine,
    pub realtime_runtime: Arc<RealtimeHostRuntime>,
}

pub(crate) fn build_current_user_mutation_runtime(
    deps: CurrentUserMutationRuntimeDeps,
) -> CurrentUserMutationRuntime {
    CurrentUserMutationRuntime::new(
        deps.auth_scope,
        deps.remote_mutations,
        Arc::new(DesktopCurrentUserMutationPort {
            web: deps.web,
            diagnostics: deps.diagnostics,
            sync: deps.sync,
            realtime_runtime: deps.realtime_runtime,
        }),
    )
}

struct DesktopCurrentUserMutationPort {
    web: Arc<WebClient>,
    diagnostics: RuntimeDiagnostics,
    sync: RuntimeSyncEngine,
    realtime_runtime: Arc<RealtimeHostRuntime>,
}

impl CurrentUserMutationPort for DesktopCurrentUserMutationPort {
    fn execute<'a>(
        &'a self,
        scope: RuntimeAuthScopeSnapshot,
        request: CurrentUserMutationRequest,
    ) -> CurrentUserMutationFuture<'a> {
        Box::pin(async move {
            let (command, detail, request) = match request {
                CurrentUserMutationRequest::Profile(params) => {
                    let (user_id, request) =
                        profile_update_input(scope.endpoint, scope.current_user_id, params)?;
                    (
                        "app__vrchat_current_user_profile_update",
                        format!("Updating profile for current user {user_id}."),
                        request,
                    )
                }
                CurrentUserMutationRequest::User(params) => {
                    let (user_id, request) =
                        current_user_update_input(scope.endpoint, scope.current_user_id, params)?;
                    (
                        "app__vrchat_current_user_update",
                        format!("Updating current user {user_id}."),
                        request,
                    )
                }
                CurrentUserMutationRequest::Badge {
                    badge_id,
                    hidden,
                    showcased,
                } => {
                    let (user_id, badge_id, request) = current_user_badge_update_input(
                        scope.endpoint,
                        scope.current_user_id,
                        badge_id,
                        hidden,
                        showcased,
                    )?;
                    (
                        "app__vrchat_current_user_badge_update",
                        format!("Updating badge {badge_id} for current user {user_id}."),
                        request,
                    )
                }
                CurrentUserMutationRequest::AddTags(tags) => {
                    let (user_id, request) =
                        current_user_tags_add_input(scope.endpoint, scope.current_user_id, tags)?;
                    (
                        "app__vrchat_current_user_tags_add",
                        format!("Adding tags to current user {user_id}."),
                        request,
                    )
                }
                CurrentUserMutationRequest::RemoveTags(tags) => {
                    let (user_id, request) = current_user_tags_remove_input(
                        scope.endpoint,
                        scope.current_user_id,
                        tags,
                    )?;
                    (
                        "app__vrchat_current_user_tags_remove",
                        format!("Removing tags from current user {user_id}."),
                        request,
                    )
                }
            };
            execute_api_command(
                &self.web,
                &self.diagnostics,
                &self.sync,
                (command, detail),
                request,
                VrchatScope::Vrchat,
            )
            .await
        })
    }

    fn invalidate_user_query<'a>(
        &'a self,
        scope: RuntimeAuthScopeSnapshot,
    ) -> CurrentUserQueryInvalidationFuture<'a> {
        Box::pin(async move {
            self.realtime_runtime
                .invalidate_user_query_cache(&scope.endpoint, &scope.current_user_id)
                .await;
        })
    }
}
