use std::sync::Arc;

use vrcx_0_application::remote::{
    WorldRemoteFuture, WorldRemoteOperation, WorldRemotePort, WorldRemoteRuntime, WorldRemoteScope,
    WorldResponseProjectionPort,
};
use vrcx_0_application_core::vrchat_api::{execute_api_command, VrchatApiResponse, VrchatScope};
use vrcx_0_application_core::{
    RemoteMutationGate, RuntimeAuthScope, RuntimeDiagnostics, RuntimeSyncEngine, WebClient,
    WorldCache,
};
use vrcx_0_vrchat_client::worlds::{
    world_delete_input, world_list_by_user_get_input, world_persistent_data_delete_input,
    world_persistent_data_exists_input, world_publish_input, world_save_input,
    world_unpublish_input,
};

pub(crate) struct WorldRemoteRuntimeDeps {
    pub auth_scope: RuntimeAuthScope,
    pub remote_mutations: Arc<RemoteMutationGate>,
    pub web: Arc<WebClient>,
    pub diagnostics: RuntimeDiagnostics,
    pub sync: RuntimeSyncEngine,
    pub world_cache: Arc<WorldCache>,
}

pub(crate) fn build_world_remote_runtime(deps: WorldRemoteRuntimeDeps) -> WorldRemoteRuntime {
    WorldRemoteRuntime::new(
        deps.auth_scope,
        deps.remote_mutations,
        Arc::new(DesktopWorldRemotePort {
            web: deps.web,
            diagnostics: deps.diagnostics,
            sync: deps.sync,
        }),
        Arc::new(DesktopWorldResponseProjection {
            world_cache: deps.world_cache,
        }),
    )
}

struct DesktopWorldRemotePort {
    web: Arc<WebClient>,
    diagnostics: RuntimeDiagnostics,
    sync: RuntimeSyncEngine,
}

impl WorldRemotePort for DesktopWorldRemotePort {
    fn execute(
        &self,
        scope: WorldRemoteScope,
        operation: WorldRemoteOperation,
    ) -> WorldRemoteFuture<'_> {
        Box::pin(async move {
            let endpoint = match scope {
                WorldRemoteScope::Public => {
                    vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT.into()
                }
                WorldRemoteScope::Authenticated { endpoint, .. } => endpoint,
            };
            let (command, detail, request) = match operation {
                WorldRemoteOperation::ListByUser {
                    user_id,
                    n,
                    offset,
                    sort,
                    order,
                    release_status,
                } => {
                    let (user_id, request) = world_list_by_user_get_input(
                        endpoint,
                        user_id,
                        n,
                        offset,
                        sort,
                        order,
                        release_status,
                    )?;
                    (
                        "app__vrchat_world_list_by_user_get",
                        format!("Getting worlds for {user_id}."),
                        request,
                    )
                }
                WorldRemoteOperation::PersistentDataExists { user_id, world_id } => {
                    let (user_id, world_id, request) =
                        world_persistent_data_exists_input(endpoint, user_id, world_id)?;
                    (
                        "app__vrchat_world_persistent_data_exists",
                        format!("Checking persistent data for user {user_id} in world {world_id}."),
                        request,
                    )
                }
                WorldRemoteOperation::Save { world_id, params } => {
                    let (world_id, request) = world_save_input(endpoint, world_id, params)?;
                    (
                        "app__vrchat_world_save",
                        format!("Saving world {world_id}."),
                        request,
                    )
                }
                WorldRemoteOperation::Delete { world_id } => {
                    let (world_id, request) = world_delete_input(endpoint, world_id)?;
                    (
                        "app__vrchat_world_delete",
                        format!("Deleting world {world_id}."),
                        request,
                    )
                }
                WorldRemoteOperation::Publish { world_id } => {
                    let (world_id, request) = world_publish_input(endpoint, world_id)?;
                    (
                        "app__vrchat_world_publish",
                        format!("Publishing world {world_id}."),
                        request,
                    )
                }
                WorldRemoteOperation::Unpublish { world_id } => {
                    let (world_id, request) = world_unpublish_input(endpoint, world_id)?;
                    (
                        "app__vrchat_world_unpublish",
                        format!("Unpublishing world {world_id}."),
                        request,
                    )
                }
                WorldRemoteOperation::PersistentDataDelete { user_id, world_id } => {
                    let (user_id, world_id, request) =
                        world_persistent_data_delete_input(endpoint, user_id, world_id)?;
                    (
                        "app__vrchat_world_persistent_data_delete",
                        format!("Deleting persistent data for user {user_id} in world {world_id}."),
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
}

struct DesktopWorldResponseProjection {
    world_cache: Arc<WorldCache>,
}

impl WorldResponseProjectionPort for DesktopWorldResponseProjection {
    fn hydrate(&self, response: &VrchatApiResponse) {
        self.world_cache.hydrate_response(response);
    }
}
