use std::collections::HashMap;
use std::sync::Arc;

use vrcx_0_application_activity::OverlayActivityRuntime;
use vrcx_0_application_core::{
    MemoryWorldCachePort, NoopWebClientPort, RuntimeAuthScope, TaskSupervisor, WebClient,
    WorldCache,
};
use vrcx_0_application_game::{NowPlayingSnapshot, PlayerState, RuntimeSnapshot};
use vrcx_0_core::{friends::FriendRecord, presence::PresenceView};
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
    game_log: RuntimeSnapshot,
    notes: HashMap<String, String>,
    friends: HashMap<String, (FriendRecord, PresenceView)>,
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
        self.game_log.clone()
    }

    fn user_notes(&self, _user_ids: &[String]) -> HashMap<String, String> {
        self.notes.clone()
    }

    fn friend_records(
        &self,
        _user_ids: &[String],
    ) -> HashMap<String, (FriendRecord, PresenceView)> {
        self.friends.clone()
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

fn test_services() -> (TestDir, TestServices) {
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
    let services = TestServices {
        config: config.clone(),
        web: Arc::new(WebClient::new(NoopWebClientPort)),
        auth_scope: RuntimeAuthScope::new(),
        world_cache: Arc::new(WorldCache::new(MemoryWorldCachePort::default())),
        tasks: TaskSupervisor::new(),
        overlay_activity: OverlayActivityRuntime::new(),
        game_log: RuntimeSnapshot::default(),
        notes: HashMap::new(),
        friends: HashMap::new(),
    };
    (dir, services)
}

#[test]
fn reconciling_reloads_config_after_any_repository_write() {
    let (_dir, services) = test_services();
    let config = services.config.clone();
    let runtime = VrOverlayRuntime::new(Arc::new(services));
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
}

#[test]
fn wrist_frames_show_live_friend_indicators_with_notes_and_sorting() {
    use crate::{build_wrist_surface_model, WristPage, WristPlayersSort};
    use vrcx_0_core::presence::{Place, PresencePlace};
    use vrcx_0_vr_overlay::FeedRelation;

    let (_dir, mut services) = test_services();
    services.game_log.players = vec![
        PlayerState {
            user_id: "usr_friend".into(),
            display_name: "Zoe".into(),
            join_time_ms: Some(20),
        },
        PlayerState {
            user_id: "usr_stranger".into(),
            display_name: "Ada".into(),
            join_time_ms: Some(10),
        },
    ];
    services
        .notes
        .insert("usr_friend".into(), "Local note".into());
    services.friends.insert(
        "usr_friend".into(),
        (
            FriendRecord {
                status_description: "World hopping".into(),
                last_platform: "standalonewindows".into(),
                ..Default::default()
            },
            PresenceView::Online {
                place: PresencePlace::new(&Place::Private),
                platform: "android".into(),
                online_since_ms: None,
            },
        ),
    );
    let mut config = super::VrOverlayRuntimeConfig {
        wrist_players_sort: WristPlayersSort::Name,
        ..Default::default()
    };
    let frame =
        super::build_wrist_frame_input(&services, config, vec![], false, WristPage::Players);
    assert_eq!(frame.players[0].display_name, "Ada");
    assert!(!frame.players[0].is_friend);
    assert!(frame.players[0].state.is_empty());
    assert!(frame.players[0].platform.is_empty());
    assert_eq!(frame.players[1].note, "Local note");
    let model = build_wrist_surface_model(frame);
    assert_eq!(model.feed_rows[0].relation, FeedRelation::None);
    assert_eq!(model.feed_rows[1].relation, FeedRelation::Friend);
    assert_eq!(
        model.feed_rows[1].detail,
        "Local note | online / Quest / World hopping"
    );

    config.wrist_players_sort = WristPlayersSort::Joined;
    let frame =
        super::build_wrist_frame_input(&services, config, vec![], false, WristPage::Players);
    assert_eq!(frame.players[0].display_name, "Zoe");
    let frame = super::build_wrist_frame_input(&services, config, vec![], false, WristPage::Notes);
    let model = build_wrist_surface_model(frame);
    assert_eq!(model.feed_rows.len(), 1);
    assert_eq!(
        model.feed_rows[0].detail,
        "Local note | online / Quest / World hopping"
    );

    services.friends.get_mut("usr_friend").unwrap().1 = PresenceView::Offline;
    let frame =
        super::build_wrist_frame_input(&services, config, vec![], false, WristPage::Players);
    assert!(frame.players[0].is_friend);
    assert_eq!(frame.players[0].state, "offline");
    assert!(frame.players[0].platform.is_empty());

    services.friends.clear();
    let frame = super::build_wrist_frame_input(&services, config, vec![], false, WristPage::Notes);
    assert!(!frame.players[0].is_friend);
    assert!(frame.players[0].status_description.is_empty());
    assert_eq!(frame.players[0].note, "Local note");
    let frame = super::build_wrist_frame_input(&services, config, vec![], false, WristPage::Feed);
    assert!(frame.players.is_empty());
}
