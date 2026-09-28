use std::sync::Arc;

use vrcx_0_application_activity::OverlayActivityRuntime;
use vrcx_0_application_core::{RuntimeAuthScope, TaskSupervisor, WebClient, WorldCache};
use vrcx_0_application_game::{NowPlayingSnapshot, RuntimeSnapshot};
use vrcx_0_persistence::config::ConfigRepository;

pub trait VrOverlayRuntimeServices: Send + Sync {
    fn config(&self) -> &ConfigRepository;

    fn web_client(&self) -> &Arc<WebClient>;

    fn auth_scope(&self) -> &RuntimeAuthScope;

    fn world_cache(&self) -> &Arc<WorldCache>;

    fn tasks(&self) -> &TaskSupervisor;

    fn overlay_activity(&self) -> OverlayActivityRuntime;

    fn hmd_notifications_allowed(&self) -> bool;

    fn game_log_snapshot(&self) -> RuntimeSnapshot;

    fn now_playing(&self) -> NowPlayingSnapshot;

    /// Fork: local notes for these user ids (for the wrist Players/Notes pages).
    fn user_notes(&self, _user_ids: &[String]) -> std::collections::HashMap<String, String> {
        std::collections::HashMap::new()
    }
}
