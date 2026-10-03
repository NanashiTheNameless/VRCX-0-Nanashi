use std::collections::HashMap;
use std::sync::Arc;

use vrcx_0_application_activity::{
    ActivityActorRelation, ActivityCategory, ActivityContent, ActivityDelivery, ActivityEntry,
    ActivityRouter,
};
use vrcx_0_application_core::{
    MemoryWorldCachePort, NoopWebClientPort, RuntimeAuthScope, TaskSupervisor, WebClient,
    WorldCache,
};
use vrcx_0_application_game::{NowPlayingSnapshot, PlayerState, RuntimeSnapshot};
use vrcx_0_contracts::activity::ActivityKind;
use vrcx_0_core::{friends::FriendRecord, presence::PresenceView};
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::DatabaseService;

use super::{
    hmd_surface_config, load_runtime_config, HmdNotificationPosition, HmdNotificationStyle,
    StaticWristFrameProducer, VrOverlayRuntime, HMD_STACK_INSET_PX, HMD_SURFACE_SIZE,
    HMD_SURFACE_WIDTH_METERS,
};
use crate::config::{
    HMD_NOTIFICATIONS_ENABLED_CONFIG_KEY, HMD_NOTIFICATION_AVATARS_CONFIG_KEY,
    HMD_NOTIFICATION_OPACITY_CONFIG_KEY, HMD_NOTIFICATION_POSITION_CONFIG_KEY,
    HMD_NOTIFICATION_START_MODE_CONFIG_KEY, HMD_NOTIFICATION_STYLE_CONFIG_KEY,
    VR_OVERLAY_HIDE_PRIVATE_WORLDS_CONFIG_KEY,
};
use crate::VrOverlayRuntimeServices;
use vrcx_0_host_desktop::vr_overlay::OverlayPlacement;

struct TestServices {
    config: ConfigRepository,
    web: Arc<WebClient>,
    auth_scope: RuntimeAuthScope,
    world_cache: Arc<WorldCache>,
    tasks: TaskSupervisor,
    activity_router: ActivityRouter,
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

    fn activity_router(&self) -> ActivityRouter {
        self.activity_router.clone()
    }

    fn hmd_notifications_allowed(&self) -> bool {
        true
    }

    fn notification_friend_image(&self, _endpoint: &str, _user_id: &str) -> Option<String> {
        None
    }

    fn set_hmd_afk(&self, _is_hmd_afk: bool) {}

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
        activity_router: ActivityRouter::new(),
        game_log: RuntimeSnapshot::default(),
        notes: HashMap::new(),
        friends: HashMap::new(),
    };
    (dir, services)
}

/// Fork: `test_services` also backs the wrist friend-indicator test, which needs
/// the raw `TestServices` rather than a runtime.
fn test_runtime() -> (TestDir, ConfigRepository, VrOverlayRuntime) {
    let (dir, services) = test_services();
    let config = services.config.clone();
    let runtime = VrOverlayRuntime::new(Arc::new(services));
    (dir, config, runtime)
}

#[test]
fn reconciling_reloads_config_after_any_repository_write() {
    let (_dir, config, runtime) = test_runtime();
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

#[test]
fn a_config_write_stays_pending_while_no_surface_is_active_until_reconciled() {
    let (_dir, config, runtime) = test_runtime();
    runtime.reconcile_current();
    assert!(!runtime.has_pending_config_change());

    config
        .set_bool(VR_OVERLAY_HIDE_PRIVATE_WORLDS_CONFIG_KEY, true)
        .unwrap();
    assert!(!runtime.has_active_surface());
    assert!(runtime.has_pending_config_change());

    runtime.reconcile_current();
    assert!(!runtime.has_pending_config_change());
    assert!(runtime.current_runtime_config().render.hide_private_worlds);
}

#[test]
fn hmd_avatars_have_their_own_switch_that_defaults_on() {
    let (_dir, config, runtime) = test_runtime();
    assert!(runtime.current_runtime_config().hmd.avatars);

    config.set_bool("imageNotifications", false).unwrap();
    runtime.reconcile_current();
    assert!(runtime.current_runtime_config().hmd.avatars);

    config
        .set_bool(HMD_NOTIFICATION_AVATARS_CONFIG_KEY, false)
        .unwrap();
    runtime.reconcile_current();
    assert!(!runtime.current_runtime_config().hmd.avatars);
}

#[test]
fn hmd_notifications_sit_top_center_or_bottom_and_unknown_values_fall_back_to_bottom() {
    let (_dir, config, runtime) = test_runtime();
    for (value, position) in [
        ("top", HmdNotificationPosition::Top),
        ("center", HmdNotificationPosition::Center),
        ("bottom", HmdNotificationPosition::Bottom),
        ("topLeft", HmdNotificationPosition::Bottom),
        ("right", HmdNotificationPosition::Bottom),
    ] {
        config
            .set_string(HMD_NOTIFICATION_POSITION_CONFIG_KEY, value)
            .unwrap();
        runtime.reconcile_current();
        assert_eq!(runtime.current_runtime_config().hmd.position, position);
    }

    assert_eq!(
        runtime.current_runtime_config().hmd.style,
        HmdNotificationStyle::Standard
    );
    config
        .set_string(HMD_NOTIFICATION_STYLE_CONFIG_KEY, "compact")
        .unwrap();
    runtime.reconcile_current();
    assert_eq!(
        runtime.current_runtime_config().hmd.style,
        HmdNotificationStyle::Compact
    );
}

#[test]
fn the_newest_hmd_card_lands_on_the_same_angle_for_each_position() {
    let meters_per_px = HMD_SURFACE_WIDTH_METERS / HMD_SURFACE_SIZE.width as f32;
    for (position, angle) in [
        (HmdNotificationPosition::Top, 4.0_f32),
        (HmdNotificationPosition::Center, -6.0),
        (HmdNotificationPosition::Bottom, -18.0),
    ] {
        for (style, card_height_px) in [
            (HmdNotificationStyle::Standard, 112.0_f32),
            (HmdNotificationStyle::Compact, 60.0),
        ] {
            let OverlayPlacement::HeadLocked {
                offset_y_meters,
                distance_meters,
            } = hmd_surface_config(position, style).placement
            else {
                panic!("HMD notifications are head locked");
            };
            let inset =
                (HMD_SURFACE_SIZE.height as f32 / 2.0 - HMD_STACK_INSET_PX - card_height_px / 2.0)
                    * meters_per_px;
            let newest_card_y = if position.stacks_upward() {
                offset_y_meters - inset
            } else {
                offset_y_meters + inset
            };
            let newest_card_angle = (newest_card_y / distance_meters).atan().to_degrees();
            assert!(
                (newest_card_angle - angle).abs() < 0.01,
                "{position:?} {style:?}: {newest_card_angle}"
            );
        }
    }
}

#[test]
fn hmd_notifications_default_to_ninety_percent_opacity() {
    let (_dir, config, runtime) = test_runtime();
    runtime.reconcile_current();
    assert_eq!(runtime.current_runtime_config().hmd.opacity_percent, 90);

    config
        .set_string(HMD_NOTIFICATION_OPACITY_CONFIG_KEY, "100")
        .unwrap();
    runtime.reconcile_current();
    assert_eq!(runtime.current_runtime_config().hmd.opacity_percent, 100);
}

#[test]
fn hmd_panel_keeps_the_original_angular_width() {
    let OverlayPlacement::HeadLocked {
        distance_meters, ..
    } = hmd_surface_config(
        HmdNotificationPosition::Bottom,
        HmdNotificationStyle::Standard,
    )
    .placement
    else {
        panic!("HMD notifications are head locked");
    };
    let angular_width =
        |width: f32, distance: f32| (width / 2.0 / distance).atan().to_degrees() * 2.0;

    assert!(
        (angular_width(HMD_SURFACE_WIDTH_METERS, distance_meters) - angular_width(0.95, 1.15))
            .abs()
            < 0.05
    );
}

#[test]
fn hmd_toasts_follow_the_router_hmd_flag_and_the_hmd_switch() {
    let (_dir, config, _) = test_runtime();
    config
        .set_bool(HMD_NOTIFICATIONS_ENABLED_CONFIG_KEY, true)
        .unwrap();
    config
        .set_string(HMD_NOTIFICATION_START_MODE_CONFIG_KEY, "steamvr")
        .unwrap();
    let services: Arc<dyn VrOverlayRuntimeServices> = Arc::new(TestServices {
        config: config.clone(),
        web: Arc::new(WebClient::new(NoopWebClientPort)),
        auth_scope: RuntimeAuthScope::new(),
        world_cache: Arc::new(WorldCache::new(MemoryWorldCachePort::default())),
        tasks: TaskSupervisor::new(),
        activity_router: ActivityRouter::new(),
        game_log: RuntimeSnapshot::default(),
        notes: HashMap::new(),
        friends: HashMap::new(),
    });
    let runtime = Arc::new(VrOverlayRuntime::new_with_frame_producer_factory(
        true,
        Some(Arc::clone(&services)),
        load_runtime_config(services.as_ref()),
        Box::new(|| Box::<StaticWristFrameProducer>::default()),
    ));
    runtime.update_process_status(true, true);
    let delivery = |source_id: &str, hmd: bool| ActivityDelivery {
        entry: ActivityEntry {
            sequence: 1,
            source_id: source_id.into(),
            kind: ActivityKind::Status,
            category: ActivityCategory::FavoriteMovement,
            created_at: "2026-10-02T00:00:00Z".into(),
            actor_user_id: "usr_actor".into(),
            actor_display_name: "Actor".into(),
            content: ActivityContent::default(),
            actor_relation: ActivityActorRelation::Friend,
        },
        desktop: !hmd,
        vr: false,
        hmd,
        webhook: false,
        tts: false,
    };
    let queued = || runtime.hmd_toasts.lock().unwrap().len();

    runtime.ingest_hmd_delivery(delivery("desktop-only", false));
    assert_eq!(queued(), 0);
    runtime.ingest_hmd_delivery(delivery("hmd", true));
    assert_eq!(queued(), 1);

    config
        .set_bool(HMD_NOTIFICATIONS_ENABLED_CONFIG_KEY, false)
        .unwrap();
    runtime.reconcile_current();
    runtime.ingest_hmd_delivery(delivery("hmd-switched-off", true));
    assert_eq!(queued(), 0);
}
