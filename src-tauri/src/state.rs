use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::adapters::assistant::{
    TauriAssistantConfigAdapter, TauriAssistantLlmClientFactory,
    TauriAssistantSessionPersistenceAdapter,
};
use crate::adapters::log_watcher::LogWatcherCompatBridge;
use crate::adapters::mcp::{
    TauriMcpActivityQueryAdapter, TauriMcpConfigAdapter, TauriMcpFavoritesQueryAdapter,
    TauriMcpFeedQueryAdapter, TauriMcpFriendLocalDataAdapter, TauriMcpMutualGraphAdapter,
    TauriMcpRemindersAdapter, TauriMcpSocialHistoryQueryAdapter,
};
use crate::deep_link::PendingDeepLinks;
use crate::desktop_notification_activation::PendingDesktopNotificationActivations;
use crate::error::AppError;
use vrcx_0_application::discovery::{
    complete_translation, OpenAiTranslationFuture, OpenAiTranslationPort, OpenAiTranslationRequest,
    TranslationCompletionError, TranslationResult, TranslationTranslateInput,
};
use vrcx_0_application::favorites::FavoriteDetailsRuntime;
use vrcx_0_application::social::{
    AvatarContentTagsBatchInput, BatchMutationResult, FriendLogNameResolutionCoordinator,
    FriendLogNameResolutionInput, GroupMembershipBatchCoordinator, GroupMembershipBatchInput,
    GroupMembershipBatchResult, GroupModerationBatchCoordinator, GroupModerationBatchInput,
    GroupModerationBatchResult, InstanceInviteBatchInput, InstanceInviteBatchResult,
    NotificationMarkSeenBatchInput, NotificationMarkSeenBatchResult, NotificationSyncOutcome,
    QuickSearchRuntime, ResolvedFriendLogName, UserDialogTabCountsInput, UserDialogTabCountsOutput,
    UserDialogTabCountsRuntime,
};
use vrcx_0_application_core::UpdaterPort;
use vrcx_0_assistant::{AssistantController, AssistantControllerDeps, LlmTranslateInput};
use vrcx_0_mcp::{McpCaller, McpRuntime, McpRuntimeDeps, McpServerController};
use vrcx_0_platform::app_paths::AppDataDirResolution;
use vrcx_0_runtime_host_desktop::{DesktopRuntimeHostOptions, DesktopRuntimeHostState};

pub const BACKGROUND_MODE_RESUME_ROUTE_STORAGE_KEY: &str = "VRCX_BackgroundModeResumeRoute";

pub struct AppState {
    runtime: DesktopRuntimeHostState,
    mcp_controller: McpServerController,
    log_watcher_compat_bridge: LogWatcherCompatBridge,
    pending_deep_links: PendingDeepLinks,
    pending_desktop_notification_activations: PendingDesktopNotificationActivations,
    favorite_details: FavoriteDetailsRuntime,
    group_membership_batches: GroupMembershipBatchCoordinator,
    group_moderation_batches: GroupModerationBatchCoordinator,
    friend_log_name_resolutions: FriendLogNameResolutionCoordinator,
    user_dialog_tab_counts: UserDialogTabCountsRuntime,
    quick_search: QuickSearchRuntime,
    assistant: tokio::sync::OnceCell<AssistantController>,
    background_resume_route: Mutex<Option<String>>,
    pub(crate) background_delay_generation: AtomicU64,
    pub(crate) background_delay_cancel: Mutex<Option<(u64, tokio::sync::oneshot::Sender<()>)>>,
    main_window_rebuild_in_progress: AtomicBool,
    auth_failure_notification: Mutex<Option<AuthFailureNotificationRecord>>,
}

struct AuthFailureNotificationRecord {
    sent_at: Instant,
}

pub(crate) struct MainWindowRebuildGuard<'a> {
    state: &'a AppState,
}

impl Drop for MainWindowRebuildGuard<'_> {
    fn drop(&mut self) {
        self.state
            .main_window_rebuild_in_progress
            .store(false, Ordering::SeqCst);
    }
}

impl AppState {
    pub(crate) fn runtime_host(&self) -> &DesktopRuntimeHostState {
        &self.runtime
    }

    pub(crate) fn require_active_scope(
        &self,
        requirement: &str,
    ) -> Result<vrcx_0_application_core::RuntimeAuthScopeSnapshot, AppError> {
        Ok(self.runtime.require_active_scope(requirement)?)
    }

    pub(crate) fn mcp_controller(&self) -> &McpServerController {
        &self.mcp_controller
    }

    pub(crate) fn log_watcher_compat_bridge(&self) -> &LogWatcherCompatBridge {
        &self.log_watcher_compat_bridge
    }

    pub(crate) fn pending_deep_links(&self) -> &PendingDeepLinks {
        &self.pending_deep_links
    }

    pub(crate) fn pending_desktop_notification_activations(
        &self,
    ) -> &PendingDesktopNotificationActivations {
        &self.pending_desktop_notification_activations
    }

    pub fn new(
        app_data_dir: AppDataDirResolution,
        database_maintenance_cache_dir: Option<std::path::PathBuf>,
        updater_port: Arc<dyn UpdaterPort>,
    ) -> Result<Self, AppError> {
        let launched_from_autostart = std::env::args().any(|arg| arg == "--autostart");
        let runtime = DesktopRuntimeHostState::new(DesktopRuntimeHostOptions {
            realtime_origin: realtime_origin(),
            launched_from_autostart,
            app_data_dir,
            app_version: env!("CARGO_PKG_VERSION").into(),
            app_update_build_label: crate::bootstrap::app_update_build_label(),
            app_update_build_badge: crate::bootstrap::app_update_build_badge(),
            app_update_check_disabled: crate::bootstrap::app_update_check_disabled(),
            updater_port,
            database_maintenance_cache_dir,
        })?;
        let favorite_details = runtime.favorite_details_runtime();
        let quick_search = runtime.quick_search_runtime();
        let mcp_controller =
            McpServerController::new(mcp_runtime(&runtime, McpCaller::ExternalServer));
        let log_watcher_compat_bridge = LogWatcherCompatBridge::new();

        Ok(Self {
            runtime,
            mcp_controller,
            log_watcher_compat_bridge,
            pending_deep_links: PendingDeepLinks::default(),
            pending_desktop_notification_activations:
                PendingDesktopNotificationActivations::default(),
            favorite_details,
            group_membership_batches: GroupMembershipBatchCoordinator::default(),
            group_moderation_batches: GroupModerationBatchCoordinator::default(),
            friend_log_name_resolutions: FriendLogNameResolutionCoordinator::default(),
            user_dialog_tab_counts: UserDialogTabCountsRuntime::new(),
            quick_search,
            assistant: tokio::sync::OnceCell::new(),
            background_resume_route: Mutex::new(None),
            background_delay_generation: AtomicU64::new(0),
            background_delay_cancel: Mutex::new(None),
            main_window_rebuild_in_progress: AtomicBool::new(false),
            auth_failure_notification: Mutex::new(None),
        })
    }

    pub async fn assistant(&self) -> Result<&AssistantController, AppError> {
        self.assistant
            .get_or_try_init(|| {
                let deps = self.runtime.assistant_dependencies();
                AssistantController::new(AssistantControllerDeps {
                    config: Arc::new(TauriAssistantConfigAdapter::new(deps.config)),
                    llm_factory: Arc::new(TauriAssistantLlmClientFactory),
                    proxy_url: deps.proxy_url,
                    bus: deps.bus,
                    tasks: deps.tasks,
                    mcp_runtime: mcp_runtime(&self.runtime, McpCaller::Assistant),
                    session_persistence: Arc::new(TauriAssistantSessionPersistenceAdapter::new(
                        deps.db,
                    )),
                    auth_scope: deps.auth_scope,
                })
            })
            .await
            .map_err(AppError::from)
    }

    pub fn set_background_resume_route(&self, route: Option<String>) {
        if let Ok(mut slot) = self.background_resume_route.lock() {
            *slot = route;
        }
    }

    pub fn take_background_resume_route(&self) -> Option<String> {
        self.background_resume_route.lock().ok()?.take()
    }

    pub(crate) fn try_begin_main_window_rebuild(&self) -> Option<MainWindowRebuildGuard<'_>> {
        self.main_window_rebuild_in_progress
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .ok()?;
        Some(MainWindowRebuildGuard { state: self })
    }

    pub(crate) fn is_main_window_rebuild_in_progress(&self) -> bool {
        self.main_window_rebuild_in_progress.load(Ordering::SeqCst)
    }

    pub fn should_emit_auth_failure_notification(&self, _key: &str, cooldown: Duration) -> bool {
        let now = Instant::now();
        let Ok(mut slot) = self.auth_failure_notification.lock() else {
            return true;
        };
        if let Some(record) = slot.as_ref() {
            if now.duration_since(record.sent_at) < cooldown {
                return false;
            }
        }
        *slot = Some(AuthFailureNotificationRecord { sent_at: now });
        true
    }

    pub async fn resolve_friend_log_names(
        &self,
        input: FriendLogNameResolutionInput,
    ) -> Result<Vec<ResolvedFriendLogName>, AppError> {
        Ok(self
            .runtime
            .resolve_friend_log_names(&self.friend_log_name_resolutions, input)
            .await?)
    }

    pub fn cancel_friend_log_name_resolution(&self, request_id: &str) -> bool {
        self.friend_log_name_resolutions.cancel(request_id)
    }

    pub async fn persist_favorite_cache_snapshot(
        &self,
        input: vrcx_0_application::favorites::FavoriteCacheSnapshotInput,
    ) -> Result<bool, AppError> {
        let entity = input.entity.clone();
        let refreshes_world_card = matches!(
            input.kind,
            vrcx_0_application::favorites::FavoriteCacheKind::World
        );
        let written = self.runtime.persist_favorite_cache_snapshot(input)?;
        if written && refreshes_world_card {
            self.favorite_details
                .refresh_world_card(entity.as_value())
                .await;
        }
        Ok(written)
    }

    pub async fn hydrate_favorite_details(
        &self,
        input: vrcx_0_application::favorites::FavoriteDetailsHydrateInput,
    ) -> Result<vrcx_0_application::favorites::FavoriteDetailsHydrateOutput, AppError> {
        let expected_scope = self.runtime.require_active_scope("Batch action")?;
        Ok(self.favorite_details.hydrate(input, expected_scope).await?)
    }

    pub async fn quick_search(
        &self,
        input: vrcx_0_application::social::QuickSearchQueryInput,
    ) -> Result<vrcx_0_application::social::QuickSearchQueryOutput, AppError> {
        Ok(self
            .quick_search
            .query(input, self.runtime.friend_snapshot())
            .await?)
    }

    pub fn invalidate_quick_search_working_set(&self) {
        self.quick_search.invalidate_remote_working_set();
    }

    pub async fn run_avatar_content_tags_batch(
        &self,
        input: AvatarContentTagsBatchInput,
    ) -> Result<BatchMutationResult, AppError> {
        Ok(self.runtime.run_avatar_content_tags_batch(input).await?)
    }

    pub async fn run_group_membership_batch(
        &self,
        input: GroupMembershipBatchInput,
    ) -> Result<GroupMembershipBatchResult, AppError> {
        Ok(self
            .runtime
            .run_group_membership_batch(&self.group_membership_batches, input)
            .await?)
    }

    pub async fn run_group_moderation_batch(
        &self,
        input: GroupModerationBatchInput,
    ) -> Result<GroupModerationBatchResult, AppError> {
        Ok(self
            .runtime
            .run_group_moderation_batch(&self.group_moderation_batches, input)
            .await?)
    }

    pub async fn mark_notifications_seen_batch(
        &self,
        input: NotificationMarkSeenBatchInput,
    ) -> Result<NotificationMarkSeenBatchResult, AppError> {
        Ok(self.runtime.mark_notifications_seen_batch(input).await?)
    }

    pub async fn send_instance_invites_batch(
        &self,
        input: InstanceInviteBatchInput,
    ) -> Result<InstanceInviteBatchResult, AppError> {
        Ok(self.runtime.send_instance_invites_batch(input).await?)
    }

    pub async fn sync_notifications(&self) -> Result<NotificationSyncOutcome, AppError> {
        Ok(self.runtime.sync_notifications().await?)
    }

    pub async fn user_dialog_tab_counts(
        &self,
        input: UserDialogTabCountsInput,
    ) -> Result<UserDialogTabCountsOutput, AppError> {
        Ok(self
            .runtime
            .user_dialog_tab_counts(&self.user_dialog_tab_counts, input)
            .await?)
    }

    pub async fn translate(
        &self,
        input: TranslationTranslateInput,
    ) -> Result<TranslationResult, AppError> {
        let dispatch = self.runtime.translate_dispatch(input).await?;
        complete_translation(dispatch, &TauriOpenAiTranslationPort { state: self })
            .await
            .map_err(|error| match error {
                TranslationCompletionError::Application(error) => AppError::from(error),
                TranslationCompletionError::Port(error) => error,
            })
    }
}

struct TauriOpenAiTranslationPort<'a> {
    state: &'a AppState,
}

impl OpenAiTranslationPort for TauriOpenAiTranslationPort<'_> {
    type Error = AppError;

    fn resolve_default_endpoint_id(&self) -> OpenAiTranslationFuture<'_, Self::Error> {
        Box::pin(async {
            self.state
                .assistant()
                .await?
                .endpoint_list()
                .map_err(AppError::from)?;
            self.state
                .runtime
                .resolved_openai_translation_endpoint_id()
                .map_err(AppError::from)
        })
    }

    fn translate(
        &self,
        request: OpenAiTranslationRequest,
    ) -> OpenAiTranslationFuture<'_, Self::Error> {
        Box::pin(async move {
            self.state
                .assistant()
                .await?
                .translate(LlmTranslateInput {
                    endpoint_id: request.endpoint_id,
                    model: request.model,
                    prompt: request.prompt,
                    target_lang: request.target_language,
                    text: request.text,
                    reasoning_effort: request.reasoning_effort,
                })
                .await
                .map_err(AppError::from)
        })
    }
}

fn mcp_runtime(runtime: &DesktopRuntimeHostState, caller: McpCaller) -> McpRuntime {
    let deps = runtime.mcp_dependencies();
    McpRuntime::new(
        McpRuntimeDeps {
            realtime_runtime: deps.realtime_runtime,
            auth_scope: deps.auth_scope.clone(),
            config: Arc::new(TauriMcpConfigAdapter::new(deps.config)),
            activity_queries: Arc::new(TauriMcpActivityQueryAdapter::new(Arc::clone(&deps.db))),
            social_history_queries: Arc::new(TauriMcpSocialHistoryQueryAdapter::new(Arc::clone(
                &deps.db,
            ))),
            friend_local_data: Arc::new(TauriMcpFriendLocalDataAdapter::new(Arc::clone(&deps.db))),
            favorites_queries: Arc::new(TauriMcpFavoritesQueryAdapter::new(Arc::clone(&deps.db))),
            feed_queries: Arc::new(TauriMcpFeedQueryAdapter::new(Arc::clone(&deps.db))),
            mutual_graph: Arc::new(TauriMcpMutualGraphAdapter::new(
                deps.mutual_graph_fetch,
                Arc::clone(&deps.db),
                Arc::clone(&deps.web),
                deps.auth_scope.clone(),
                deps.tasks.clone(),
            )),
            favorite_mutations: deps.favorite_mutations,
            reminders: Some(Arc::new(TauriMcpRemindersAdapter::new(Arc::clone(
                runtime.reminders(),
            )))),
            tasks: deps.tasks,
        },
        caller,
    )
}

fn realtime_origin() -> String {
    if cfg!(debug_assertions) {
        "http://localhost:9000".into()
    } else {
        "http://tauri.localhost".into()
    }
}
