use std::sync::Arc;

use vrcx_0_application_activity::OverlayActivityRuntime;
use vrcx_0_application_core::{
    MemoryWorldCachePort, NoopWebClientPort, RuntimeAuthScope, TaskSupervisor, WebClient,
    WorldCache,
};
use vrcx_0_application_game::{NowPlayingSnapshot, RuntimeSnapshot};
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::DatabaseService;

use super::VrOverlayRuntime;
use crate::config::VR_OVERLAY_HIDE_PRIVATE_WORLDS_CONFIG_KEY;
use crate::VrOverlayRuntimeServices;

struct TestServices {
    config: ConfigRepository,
    web: Arc<WebClient>,
    auth_scope: RuntimeAuthScope,
    world_cache: Arc<WorldCache>,
    tasks: TaskSupervisor,
    overlay_activity: OverlayActivityRuntime,
}

impl VrOverlayRuntimeServices for TestServices {
    fn config(&self) -> &ConfigRepository {
        &self.config
    }

    fn web_client(&self) -> &Arc<WebClient> {
        &self.web
    }

    fn auth_scope(&self) -> &RuntimeAuthScope {
        &self.auth_scope
    }

    fn world_cache(&self) -> &Arc<WorldCache> {
        &self.world_cache
    }

    fn tasks(&self) -> &TaskSupervisor {
        &self.tasks
    }

    fn overlay_activity(&self) -> OverlayActivityRuntime {
        self.overlay_activity.clone()
    }

    fn hmd_notifications_allowed(&self) -> bool {
        true
    }

    fn game_log_snapshot(&self) -> RuntimeSnapshot {
        RuntimeSnapshot::default()
    }

    fn now_playing(&self) -> NowPlayingSnapshot {
        NowPlayingSnapshot::default()
    }
}

struct TestDir(std::path::PathBuf);

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn reconciling_reloads_config_after_any_repository_write() {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = TestDir(std::env::temp_dir().join(format!(
        "vrcx-0-overlay-config-reload-{}-{nonce}",
        std::process::id()
    )));
    std::fs::create_dir_all(&dir.0).unwrap();
    let db = Arc::new(DatabaseService::new(&dir.0.join("VRCX-0.sqlite3")).unwrap());
    let config = ConfigRepository::new(db);
    let runtime = VrOverlayRuntime::new(Arc::new(TestServices {
        config: config.clone(),
        web: Arc::new(WebClient::new(NoopWebClientPort)),
        auth_scope: RuntimeAuthScope::new(),
        world_cache: Arc::new(WorldCache::new(MemoryWorldCachePort::default())),
        tasks: TaskSupervisor::new(),
        overlay_activity: OverlayActivityRuntime::new(),
    }));
    assert!(!runtime.current_runtime_config().render.hide_private_worlds);

    config
        .set_bool(VR_OVERLAY_HIDE_PRIVATE_WORLDS_CONFIG_KEY, true)
        .unwrap();
    runtime.reconcile_current();
    assert!(runtime.current_runtime_config().render.hide_private_worlds);

    config
        .set_bool(VR_OVERLAY_HIDE_PRIVATE_WORLDS_CONFIG_KEY, false)
        .unwrap();
    runtime.reconcile_current();
    assert!(!runtime.current_runtime_config().render.hide_private_worlds);

    runtime.mark_config_dirty();
    runtime.reconcile_current();
    assert!(!runtime.current_runtime_config().render.hide_private_worlds);
}
