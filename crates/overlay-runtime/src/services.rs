use std::sync::Arc;

use vrcx_0_application_activity::ActivityRouter;
use vrcx_0_application_core::{RuntimeAuthScope, TaskSupervisor, WebClient, WorldCache};
use vrcx_0_application_game::{NowPlayingSnapshot, RuntimeSnapshot};
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_core::presence::PresenceView;
use vrcx_0_persistence::config::ConfigRepository;

pub trait VrOverlayRuntimeServices: Send + Sync {
    fn config(&self) -> &ConfigRepository;

    fn web_client(&self) -> &Arc<WebClient>;

    fn auth_scope(&self) -> &RuntimeAuthScope;

    fn world_cache(&self) -> &Arc<WorldCache>;

    fn tasks(&self) -> &TaskSupervisor;

    fn activity_router(&self) -> ActivityRouter;

    fn hmd_notifications_allowed(&self) -> bool;

    fn notification_friend_image(&self, endpoint: &str, user_id: &str) -> Option<String>;

    fn set_hmd_afk(&self, is_hmd_afk: bool);

    fn game_log_snapshot(&self) -> RuntimeSnapshot;

    fn now_playing(&self) -> NowPlayingSnapshot;

    /// Fork: local notes for these user ids (for the wrist Players/Notes pages).
    fn user_notes(&self, _user_ids: &[String]) -> std::collections::HashMap<String, String> {
        std::collections::HashMap::new()
    }

    /// Fork: friend records for these user ids (for the wrist Players/Notes pages).
    fn friend_records(
        &self,
        _user_ids: &[String],
    ) -> std::collections::HashMap<String, (FriendRecord, PresenceView)> {
        std::collections::HashMap::new()
    }
}
