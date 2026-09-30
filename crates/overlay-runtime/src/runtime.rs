use std::cell::RefCell;
use std::collections::VecDeque;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Condvar, Mutex, Weak,
};
use std::thread::{self, ThreadId};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Local, Timelike};
use serde::Serialize;
use vrcx_0_application_activity::{
    OverlayActivityDelivery, OverlayActivitySink, OverlayActivitySnapshot,
};
use vrcx_0_application_core::{GameProcessEvent, GameProcessEventSink, TaskSupervisor};
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_core::text::first_non_empty_owned;
use vrcx_0_host_desktop::vr_overlay::{
    OverlayActivationButton, OverlayPlacement, OverlaySurfaceConfig, VrDeviceSnapshot,
};
use vrcx_0_vr_overlay::{
    MainSurfaceModel, OverlaySize, OverlaySurfaceId, RgbaFrame, SlintHmdRenderer,
    SlintWristRenderer, WristSurfaceModel, MAIN_SURFACE_ID,
};

use crate::VrOverlayRuntimeServices;

use super::{
    avatar_cache::AvatarBitmapCache,
    build_wrist_surface_model,
    eligibility::{VrOverlayEligibility, WristOverlayStartMode},
    localization::OverlayLocale,
    manager::VrOverlayManager,
    service::{HostVrOverlayService, OverlayBackendPreference},
    surfaces::hmd_toast::{refresh_cached_world_name, HmdToastState},
    surfaces::wrist::compact_duration,
    test_preview::test_wrist_frame_input,
    WristOverlayFrameInput, WristOverlayRenderOptions, WristOverlaySizePreset, WristPage,
    WristPageOrder, WristPlayerRow, WristPlayersSort, WristRuntimeFooter, WristRuntimeNowPlaying,
};

pub(crate) use super::config::load_runtime_config;
pub use super::config::VR_OVERLAY_ENABLED_CONFIG_KEY;

trait VrOverlayFrameProducer: Send {
    fn next_frame(&mut self, input: VrOverlayFrameInput) -> Result<RgbaFrame, String>;
}

type VrOverlayFrameProducerFactory = Box<dyn Fn() -> Box<dyn VrOverlayFrameProducer> + Send + Sync>;
type HmdFriendMembershipProvider = Arc<dyn Fn(&str) -> bool + Send + Sync>;
type HmdFriendContextProvider = Arc<dyn Fn(&str) -> Option<(FriendRecord, String)> + Send + Sync>;

thread_local! {
    static SLINT_WRIST_RENDERER: RefCell<Option<SlintWristRenderer>> = const { RefCell::new(None) };
    static SLINT_HMD_RENDERER: RefCell<Option<SlintHmdRenderer>> = const { RefCell::new(None) };
}

const WRIST_DEVICE_REFRESH_INTERVAL: Duration = Duration::from_secs(5);
const WRIST_FRAME_REFRESH_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum WristOverlayHand {
    #[default]
    Left,
    Right,
    Both,
}

impl WristOverlayHand {
    pub(crate) fn from_config(value: &str) -> Self {
        match value.trim() {
            "right" => Self::Right,
            "both" => Self::Both,
            _ => Self::Left,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum HmdNotificationPosition {
    Top,
    #[default]
    Bottom,
    Left,
    Right,
}

impl HmdNotificationPosition {
    pub(crate) fn from_config(value: &str) -> Self {
        match value.trim() {
            "top" => Self::Top,
            "left" => Self::Left,
            "right" => Self::Right,
            _ => Self::Bottom,
        }
    }

    fn as_device_hint(self) -> &'static str {
        match self {
            Self::Top => "hmd:top",
            Self::Bottom => "hmd:bottom",
            Self::Left => "hmd:left",
            Self::Right => "hmd:right",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct HmdNotificationConfig {
    pub(crate) enabled: bool,
    pub(crate) start_mode: WristOverlayStartMode,
    pub(crate) timeout_ms: u64,
    pub(crate) opacity_percent: u8,
    pub(crate) position: HmdNotificationPosition,
}

impl Default for HmdNotificationConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            start_mode: WristOverlayStartMode::Vrchat,
            timeout_ms: 5_000,
            opacity_percent: 100,
            position: HmdNotificationPosition::Bottom,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct VrOverlayRuntimeConfig {
    pub(crate) start_mode: WristOverlayStartMode,
    pub(crate) backend: OverlayBackendPreference,
    pub(crate) button: OverlayActivationButton,
    pub(crate) hand: WristOverlayHand,
    pub(crate) hmd: HmdNotificationConfig,
    pub(crate) render: WristOverlayRenderOptions,
    pub(crate) locale: OverlayLocale,
    pub(crate) dt_hour12: bool,
    pub(crate) show_instance_id_in_location: bool,
    /// Fork: customizable wrist pages (Settings > VR).
    pub(crate) wrist_pages: WristPageOrder,
    pub(crate) wrist_players_sort: WristPlayersSort,
    /// Inactivity timeout in seconds. When the wrist menu is shown, it will
    /// remain visible for this duration after the last interaction.
    pub(crate) wrist_timeout_secs: u8,
}

impl Default for VrOverlayRuntimeConfig {
    fn default() -> Self {
        Self {
            start_mode: WristOverlayStartMode::Vrchat,
            backend: OverlayBackendPreference::Auto,
            button: OverlayActivationButton::Grip,
            hand: WristOverlayHand::Left,
            hmd: HmdNotificationConfig::default(),
            render: WristOverlayRenderOptions::default(),
            locale: OverlayLocale::default(),
            dt_hour12: true,
            show_instance_id_in_location: false,
            wrist_pages: WristPageOrder::default(),
            wrist_players_sort: WristPlayersSort::Name,
            wrist_timeout_secs: 15, // Default to 15 seconds
        }
    }
}

impl VrOverlayRuntimeConfig {
    fn surface_config_key(self) -> WristSurfaceRuntimeConfig {
        WristSurfaceRuntimeConfig {
            button: self.button,
            hand: self.hand,
            size: self.render.size,
            hmd_enabled: self.hmd.enabled,
            hmd_position: self.hmd.position,
        }
    }

    fn should_clear_device_snapshot_for(self, next_config: Self) -> bool {
        self.surface_config_key() != next_config.surface_config_key()
            || self.render.show_devices != next_config.render.show_devices
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct WristSurfaceRuntimeConfig {
    button: OverlayActivationButton,
    hand: WristOverlayHand,
    size: WristOverlaySizePreset,
    hmd_enabled: bool,
    hmd_position: HmdNotificationPosition,
}

struct VrOverlayFrameInput {
    config: VrOverlayRuntimeConfig,
    devices: Vec<VrDeviceSnapshot>,
    wrist_visible: bool,
    /// Total wrist menu presses seen so far. Any change means the user pressed
    /// the menu button, including while the menu was already open.
    wrist_activations: u64,
    test_mode: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct ActiveOverlaySurfaces {
    wrist: bool,
    hmd: bool,
}

impl ActiveOverlaySurfaces {
    fn any(self) -> bool {
        self.wrist || self.hmd
    }
}

#[derive(Default)]
struct RefreshWake {
    sequence: Mutex<u64>,
    condvar: Condvar,
}

impl RefreshWake {
    fn new() -> Self {
        Self::default()
    }

    fn notify(&self) {
        if let Ok(mut sequence) = self.sequence.lock() {
            *sequence = sequence.wrapping_add(1);
        }
        self.condvar.notify_one();
    }

    fn wait_timeout(&self, timeout: Duration, observed_sequence: &mut u64) {
        let Ok(mut sequence) = self.sequence.lock() else {
            std::thread::sleep(timeout);
            return;
        };
        if *sequence == *observed_sequence {
            let Ok((next_sequence, _)) = self.condvar.wait_timeout(sequence, timeout) else {
                return;
            };
            sequence = next_sequence;
        }
        *observed_sequence = *sequence;
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrOverlayRuntimeSnapshot {
    pub enabled: bool,
    pub backend_available: bool,
    pub running: bool,
    pub steamvr_running: bool,
    pub active_backend: Option<String>,
    pub test_mode: bool,
}

pub struct VrOverlayRuntime {
    enabled: AtomicBool,
    test_mode: AtomicBool,
    game_running: AtomicBool,
    steamvr_running: AtomicBool,
    refresh_loop_started: AtomicBool,
    wrist_frame_release_requested: AtomicBool,
    hmd_frame_release_requested: AtomicBool,
    device_refresh_requested: AtomicBool,
    config_dirty: AtomicBool,
    config_generation: AtomicU64,
    backend_available: bool,
    pub(crate) services: Option<Arc<dyn VrOverlayRuntimeServices>>,
    config: Mutex<VrOverlayRuntimeConfig>,
    hmd_friend_membership_provider: Mutex<Option<HmdFriendMembershipProvider>>,
    hmd_friend_context_provider: Mutex<Option<HmdFriendContextProvider>>,
    refresh_wake: Arc<RefreshWake>,
    devices: Mutex<Vec<VrDeviceSnapshot>>,
    pub(crate) hmd_toasts: Mutex<VecDeque<HmdToastState>>,
    pub(crate) avatar_bitmap_cache: Arc<AvatarBitmapCache>,
    pub(crate) manager: Mutex<VrOverlayManager<HostVrOverlayService>>,
    running_mirror: AtomicBool,
    active_backend_mirror: Mutex<Option<&'static str>>,
    refresh_thread_id: Mutex<Option<ThreadId>>,
    frame_producer_factory: VrOverlayFrameProducerFactory,
    frame_producer: Mutex<Option<Box<dyn VrOverlayFrameProducer>>>,
}

#[derive(Clone)]
pub struct VrOverlayActivitySink {
    runtime: Weak<VrOverlayRuntime>,
}

impl VrOverlayActivitySink {
    pub fn new(runtime: &Arc<VrOverlayRuntime>) -> Self {
        Self {
            runtime: Arc::downgrade(runtime),
        }
    }
}

impl OverlayActivitySink for VrOverlayActivitySink {
    fn emit_overlay_activity_snapshot(&self, _snapshot: OverlayActivitySnapshot) {
        if let Some(runtime) = self.runtime.upgrade() {
            runtime.reconcile_current();
        }
    }

    fn emit_overlay_activity_delivery(&self, delivery: OverlayActivityDelivery) {
        if let Some(runtime) = self.runtime.upgrade() {
            runtime.ingest_hmd_delivery(delivery);
        }
    }
}

impl VrOverlayRuntime {
    pub fn new<S>(services: Arc<S>) -> Self
    where
        S: VrOverlayRuntimeServices + 'static,
    {
        let config = load_runtime_config(services.config());
        let services: Arc<dyn VrOverlayRuntimeServices> = services;
        let producer_services = Arc::clone(&services);
        Self::new_with_frame_producer_factory(
            HostVrOverlayService::backend_available(),
            Some(services.clone()),
            config,
            Box::new(move || {
                Box::new(RuntimeWristFrameProducer::new(Arc::clone(
                    &producer_services,
                )))
            }),
        )
    }

    pub fn new_for_test() -> Self {
        Self::new_for_test_with_backend_available(true)
    }

    pub fn new_for_test_with_backend_available(backend_available: bool) -> Self {
        Self::new_with_frame_producer_factory(
            backend_available,
            None,
            VrOverlayRuntimeConfig::default(),
            Box::new(|| Box::<StaticWristFrameProducer>::default()),
        )
    }

    fn new_with_frame_producer_factory(
        backend_available: bool,
        services: Option<Arc<dyn VrOverlayRuntimeServices>>,
        config: VrOverlayRuntimeConfig,
        frame_producer_factory: VrOverlayFrameProducerFactory,
    ) -> Self {
        let service_configs = Vec::new();
        let service = if services.is_some() {
            HostVrOverlayService::new_with_preference(service_configs, config.backend)
        } else {
            HostVrOverlayService::new_noop(service_configs)
        };
        let config_generation = services
            .as_ref()
            .map_or(0, |services| services.config().write_generation());
        Self {
            enabled: AtomicBool::new(false),
            test_mode: AtomicBool::new(false),
            game_running: AtomicBool::new(false),
            steamvr_running: AtomicBool::new(false),
            refresh_loop_started: AtomicBool::new(false),
            wrist_frame_release_requested: AtomicBool::new(false),
            hmd_frame_release_requested: AtomicBool::new(false),
            device_refresh_requested: AtomicBool::new(false),
            config_dirty: AtomicBool::new(false),
            config_generation: AtomicU64::new(config_generation),
            backend_available,
            services,
            manager: Mutex::new(VrOverlayManager::new(service)),
            running_mirror: AtomicBool::new(false),
            active_backend_mirror: Mutex::new(None),
            refresh_thread_id: Mutex::new(None),
            config: Mutex::new(config),
            hmd_friend_membership_provider: Mutex::new(None),
            hmd_friend_context_provider: Mutex::new(None),
            refresh_wake: Arc::new(RefreshWake::new()),
            devices: Mutex::new(Vec::new()),
            hmd_toasts: Mutex::new(VecDeque::new()),
            avatar_bitmap_cache: Arc::new(AvatarBitmapCache::new()),
            frame_producer_factory,
            frame_producer: Mutex::new(None),
        }
    }

    pub fn set_enabled(&self, enabled: bool) {
        if enabled && !self.backend_available {
            tracing::warn!("no VR overlay backend is available in this build");
        }
        self.enabled.store(enabled, Ordering::Release);
        self.reconcile(true, true);
        if !enabled && !self.current_runtime_config().hmd.enabled {
            self.release_frame_producer();
        }
    }

    pub fn set_test_mode(&self, test_mode: bool) {
        if self.test_mode.swap(test_mode, Ordering::AcqRel) == test_mode {
            return;
        }
        if !test_mode {
            self.clear_hmd_toasts();
        }
        self.reconcile(true, true);
        if !test_mode && !self.enabled.load(Ordering::Acquire) {
            self.release_frame_producer();
        }
    }

    pub fn is_test_mode(&self) -> bool {
        self.test_mode.load(Ordering::Acquire)
    }

    pub fn start_refresh_loop(self: &Arc<Self>, tasks: TaskSupervisor) {
        if self.refresh_loop_started.swap(true, Ordering::AcqRel) {
            return;
        }
        let runtime = Arc::clone(self);
        tasks.spawn_cancellable_thread("vr-overlay-refresh", move |stop_token| {
            runtime.set_refresh_thread_id(thread::current().id());
            let mut next_device_refresh = Instant::now();
            let mut refresh_wake_sequence = 0;
            while !stop_token.is_stop_requested() {
                runtime
                    .refresh_wake
                    .wait_timeout(runtime.refresh_interval(), &mut refresh_wake_sequence);
                if stop_token.is_stop_requested() {
                    break;
                }
                runtime.consume_slint_renderer_release_requests();
                if !runtime.has_active_surface() {
                    continue;
                }
                let now = Instant::now();
                let refresh_devices =
                    now >= next_device_refresh || runtime.consume_device_refresh_request();
                runtime.reconcile(refresh_devices, false);
                if refresh_devices {
                    next_device_refresh = now + WRIST_DEVICE_REFRESH_INTERVAL;
                }
            }
            runtime.clear_refresh_thread_id();
        });
    }

    fn set_refresh_thread_id(&self, thread_id: ThreadId) {
        if let Ok(mut current) = self.refresh_thread_id.lock() {
            *current = Some(thread_id);
        }
    }

    fn clear_refresh_thread_id(&self) {
        if let Ok(mut current) = self.refresh_thread_id.lock() {
            *current = None;
        }
    }

    fn is_refresh_thread(&self) -> bool {
        self.refresh_thread_id
            .lock()
            .ok()
            .and_then(|current| *current)
            .is_some_and(|thread_id| thread_id == thread::current().id())
    }

    fn should_defer_slint_render_to_refresh_thread(&self) -> bool {
        self.services.is_some() && !self.is_refresh_thread()
    }
}

impl VrOverlayRuntime {
    pub fn stop_detached(&self) {
        if let Ok(mut manager) = self.manager.lock() {
            manager.stop_detached();
            self.refresh_manager_mirror(&manager);
        }
        self.release_frame_producer();
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Acquire)
    }

    fn has_active_surface(&self) -> bool {
        self.active_surfaces(self.current_runtime_config()).any()
    }

    pub fn set_hmd_friend_membership_provider<F>(&self, provider: F)
    where
        F: Fn(&str) -> bool + Send + Sync + 'static,
    {
        if let Ok(mut current) = self.hmd_friend_membership_provider.lock() {
            *current = Some(Arc::new(provider));
        }
    }

    pub fn set_hmd_friend_context_provider<F>(&self, provider: F)
    where
        F: Fn(&str) -> Option<(FriendRecord, String)> + Send + Sync + 'static,
    {
        if let Ok(mut current) = self.hmd_friend_context_provider.lock() {
            *current = Some(Arc::new(provider));
        }
    }

    pub(crate) fn is_current_hmd_friend(&self, user_id: &str) -> bool {
        let user_id = user_id.trim();
        if !user_id.starts_with("usr_") {
            return false;
        }
        let provider = self
            .hmd_friend_membership_provider
            .lock()
            .ok()
            .and_then(|provider| provider.clone());
        provider.is_some_and(|provider| provider(user_id))
    }

    pub(crate) fn current_hmd_friend_context(
        &self,
        user_id: &str,
    ) -> Option<(FriendRecord, String)> {
        let provider = self
            .hmd_friend_context_provider
            .lock()
            .ok()
            .and_then(|provider| provider.clone());
        provider.and_then(|provider| provider(user_id))
    }
}

impl VrOverlayRuntime {
    fn refresh_interval(&self) -> Duration {
        match self.hmd_toast_refresh_hint(Instant::now()) {
            Some(hint) => WRIST_FRAME_REFRESH_INTERVAL.min(hint),
            None => WRIST_FRAME_REFRESH_INTERVAL,
        }
    }

    pub fn snapshot(&self) -> VrOverlayRuntimeSnapshot {
        let (running, active_backend) = if let Ok(manager) = self.manager.try_lock() {
            let running = manager.is_running();
            let active_backend = manager.active_backend();
            self.refresh_manager_mirror(&manager);
            (running, active_backend.map(str::to_string))
        } else {
            (
                self.running_mirror.load(Ordering::Acquire),
                self.active_backend_mirror(),
            )
        };
        VrOverlayRuntimeSnapshot {
            enabled: self.enabled.load(Ordering::Acquire),
            backend_available: self.backend_available,
            running,
            steamvr_running: self.steamvr_running.load(Ordering::Acquire),
            active_backend,
            test_mode: self.test_mode.load(Ordering::Acquire),
        }
    }

    pub fn is_running(&self) -> bool {
        if let Ok(manager) = self.manager.try_lock() {
            let running = manager.is_running();
            self.refresh_manager_mirror(&manager);
            return running;
        }
        self.running_mirror.load(Ordering::Acquire)
    }

    fn refresh_manager_mirror(&self, manager: &VrOverlayManager<HostVrOverlayService>) {
        self.running_mirror
            .store(manager.is_running(), Ordering::Release);
        if let Ok(mut active_backend) = self.active_backend_mirror.lock() {
            *active_backend = manager.active_backend();
        }
    }

    fn active_backend_mirror(&self) -> Option<String> {
        self.active_backend_mirror
            .lock()
            .ok()
            .and_then(|active_backend| *active_backend)
            .map(str::to_string)
    }

    fn update_process_status(&self, game_running: bool, steamvr_running: bool) {
        let previous_game_running = self.game_running.swap(game_running, Ordering::AcqRel);
        if previous_game_running && !game_running {
            self.avatar_bitmap_cache.clear();
        }
        self.steamvr_running
            .store(steamvr_running, Ordering::Release);
        self.reconcile(true, false);
    }

    pub fn reconcile_current(&self) {
        self.reconcile(false, false);
    }

    pub fn mark_config_dirty(&self) {
        self.config_dirty.store(true, Ordering::Release);
        self.refresh_wake.notify();
    }

    fn config_generation_advanced(&self) -> bool {
        let Some(services) = &self.services else {
            return false;
        };
        let generation = services.config().write_generation();
        self.config_generation.swap(generation, Ordering::AcqRel) != generation
    }

    fn reconcile(&self, refresh_devices: bool, reload_config: bool) {
        if self.is_refresh_thread() {
            self.consume_slint_renderer_release_requests();
        }
        let changed_config = if reload_config
            || self.config_dirty.swap(false, Ordering::AcqRel)
            || self.config_generation_advanced()
        {
            self.changed_runtime_config()
        } else {
            None
        };
        if let Ok(mut manager) = self.manager.lock() {
            let mut config = self.current_runtime_config();
            if let Some(next_config) = changed_config {
                if config.backend != next_config.backend {
                    manager.set_backend_preference(next_config.backend);
                }
                let clear_devices = config.should_clear_device_snapshot_for(next_config);
                self.commit_runtime_config(next_config, clear_devices);
                config = next_config;
            }
            let game_running = self.game_running.load(Ordering::Acquire);
            let steamvr_running = self.steamvr_running.load(Ordering::Acquire);
            let active_surfaces =
                self.active_surfaces_for_state(config, game_running, steamvr_running);
            if active_surfaces.any() {
                let configs = overlay_surface_configs(active_surfaces, config, self);
                if let Err(error) = manager.set_surface_configs(configs) {
                    tracing::warn!(
                        error = %error,
                        "failed to apply VR overlay surface config"
                    );
                }
            } else {
                self.clear_hmd_toasts();
            }
            let eligibility = VrOverlayEligibility {
                enabled: active_surfaces.any(),
                backend_available: self.backend_available,
                game_running,
                steamvr_running,
                start_mode: WristOverlayStartMode::SteamVr,
            };
            manager.reconcile(eligibility);
            if eligibility.can_run() && manager.is_running() {
                if active_surfaces.wrist {
                    if self.should_defer_slint_render_to_refresh_thread() {
                        self.defer_refresh_to_refresh_thread(refresh_devices);
                    } else {
                        self.refresh_devices_if_needed(
                            &mut manager,
                            refresh_devices,
                            config.render.show_devices,
                        );
                        self.push_wrist_frame(&mut manager, config);
                    }
                } else {
                    self.release_frame_producer();
                }
                if active_surfaces.hmd {
                    if self.should_defer_slint_render_to_refresh_thread() {
                        self.refresh_wake.notify();
                    } else {
                        self.push_hmd_frame(&mut manager, config, Instant::now());
                    }
                } else {
                    self.clear_hmd_toasts();
                }
            } else {
                self.release_frame_producer();
            }
            self.refresh_manager_mirror(&manager);
        }
    }

    fn defer_refresh_to_refresh_thread(&self, refresh_devices: bool) {
        if refresh_devices {
            self.device_refresh_requested.store(true, Ordering::Release);
        }
        self.refresh_wake.notify();
    }

    fn consume_device_refresh_request(&self) -> bool {
        self.device_refresh_requested.swap(false, Ordering::AcqRel)
    }

    pub(crate) fn is_hmd_surface_active(&self, config: VrOverlayRuntimeConfig) -> bool {
        self.active_surfaces(config).hmd
    }

    pub(crate) fn active_surfaces(&self, config: VrOverlayRuntimeConfig) -> ActiveOverlaySurfaces {
        self.active_surfaces_for_state(
            config,
            self.game_running.load(Ordering::Acquire),
            self.steamvr_running.load(Ordering::Acquire),
        )
    }

    fn active_surfaces_for_state(
        &self,
        config: VrOverlayRuntimeConfig,
        game_running: bool,
        steamvr_running: bool,
    ) -> ActiveOverlaySurfaces {
        let test_mode =
            self.test_mode.load(Ordering::Acquire) && self.backend_available && steamvr_running;
        ActiveOverlaySurfaces {
            wrist: test_mode
                || surface_active_for_start_mode(
                    self.enabled.load(Ordering::Acquire),
                    config.start_mode,
                    self.backend_available,
                    steamvr_running,
                    game_running,
                ),
            hmd: test_mode
                || surface_active_for_start_mode(
                    config.hmd.enabled,
                    config.hmd.start_mode,
                    self.backend_available,
                    steamvr_running,
                    game_running,
                ),
        }
    }

    fn changed_runtime_config(&self) -> Option<VrOverlayRuntimeConfig> {
        let Some(services) = &self.services else {
            return None;
        };
        let next_config = load_runtime_config(services.config());
        let Ok(current_config) = self.config.lock() else {
            return None;
        };
        if *current_config == next_config {
            return None;
        }
        Some(next_config)
    }

    fn commit_runtime_config(&self, next_config: VrOverlayRuntimeConfig, clear_devices: bool) {
        let Ok(mut current_config) = self.config.lock() else {
            return;
        };
        if *current_config == next_config {
            return;
        }
        *current_config = next_config;
        if clear_devices {
            if let Ok(mut devices) = self.devices.lock() {
                devices.clear();
            }
        }
    }

    pub(crate) fn current_runtime_config(&self) -> VrOverlayRuntimeConfig {
        self.config.lock().map(|config| *config).unwrap_or_default()
    }

    fn refresh_devices_if_needed(
        &self,
        manager: &mut VrOverlayManager<HostVrOverlayService>,
        refresh_devices: bool,
        show_devices: bool,
    ) {
        if !show_devices {
            if let Ok(mut devices) = self.devices.lock() {
                devices.clear();
            }
            return;
        }
        let devices_empty = self
            .devices
            .lock()
            .map(|devices| devices.is_empty())
            .unwrap_or(true);
        if !refresh_devices && !devices_empty {
            return;
        }
        match manager.snapshot_devices() {
            Ok(next_devices) => {
                if let Ok(mut devices) = self.devices.lock() {
                    *devices = next_devices;
                }
            }
            Err(error) => {
                tracing::warn!(error = %error, "failed to snapshot VR overlay devices");
            }
        }
    }

    fn push_wrist_frame(
        &self,
        manager: &mut VrOverlayManager<HostVrOverlayService>,
        config: VrOverlayRuntimeConfig,
    ) {
        let devices = self
            .devices
            .lock()
            .map(|devices| devices.clone())
            .unwrap_or_default();
        let wrist_ids = wrist_surface_ids(config.hand);
        let wrist_visible = wrist_ids
            .iter()
            .any(|surface_id| manager.is_surface_visible(surface_id));
        let wrist_activations = wrist_ids
            .iter()
            .map(|surface_id| manager.wrist_activation_count(surface_id))
            .max()
            .unwrap_or_default();
        let frame = match self
            .frame_producer
            .lock()
            .map_err(|_| "wrist frame producer lock poisoned".to_string())
            .and_then(|mut producer| {
                let producer = producer.get_or_insert_with(|| (self.frame_producer_factory)());
                producer.next_frame(VrOverlayFrameInput {
                    config,
                    devices,
                    wrist_visible,
                    wrist_activations,
                    test_mode: self.is_test_mode(),
                })
            }) {
            Ok(frame) => frame,
            Err(error) => {
                tracing::warn!(error = %error, "failed to render wrist overlay frame");
                return;
            }
        };

        for surface_id in wrist_surface_ids(config.hand) {
            if let Err(error) = manager.update_surface_frame(&surface_id, frame.clone()) {
                tracing::warn!(
                    error = %error,
                    surface_id = surface_id.as_str(),
                    "failed to update wrist overlay frame"
                );
            }
        }
    }

    fn release_frame_producer(&self) {
        if self.defer_slint_renderer_release(&self.wrist_frame_release_requested) {
            if let Ok(mut devices) = self.devices.lock() {
                devices.clear();
            }
            self.refresh_wake.notify();
            return;
        }
        self.release_frame_producer_on_current_thread();
    }

    fn consume_slint_renderer_release_requests(&self) {
        self.consume_slint_renderer_release_request(&self.wrist_frame_release_requested, || {
            self.release_frame_producer_on_current_thread();
        });
        self.consume_slint_renderer_release_request(&self.hmd_frame_release_requested, || {
            self.release_hmd_renderer_for_lifecycle_reset_on_current_thread();
        });
    }

    fn defer_slint_renderer_release(&self, request: &AtomicBool) -> bool {
        if self.should_defer_slint_render_to_refresh_thread() {
            request.store(true, Ordering::Release);
            true
        } else {
            false
        }
    }

    fn consume_slint_renderer_release_request(&self, request: &AtomicBool, release: impl FnOnce()) {
        if request.swap(false, Ordering::AcqRel) {
            release();
        }
    }

    pub(crate) fn release_hmd_renderer(&self) {
        if self.defer_slint_renderer_release(&self.hmd_frame_release_requested) {
            self.refresh_wake.notify();
            return;
        }
        self.release_hmd_renderer_for_lifecycle_reset_on_current_thread();
    }

    pub(crate) fn release_hmd_renderer_on_current_thread(&self) {
        self.hmd_frame_release_requested
            .store(false, Ordering::Release);
        clear_slint_hmd_renderer();
    }

    fn release_hmd_renderer_for_lifecycle_reset_on_current_thread(&self) {
        self.avatar_bitmap_cache.clear();
        self.release_hmd_renderer_on_current_thread();
    }

    fn release_frame_producer_on_current_thread(&self) {
        self.wrist_frame_release_requested
            .store(false, Ordering::Release);
        if let Ok(mut producer) = self.frame_producer.lock() {
            producer.take();
        }
        clear_slint_wrist_renderer();
        if let Ok(mut devices) = self.devices.lock() {
            devices.clear();
        }
    }
}

impl Default for VrOverlayRuntime {
    fn default() -> Self {
        Self::new_for_test()
    }
}

impl GameProcessEventSink for VrOverlayRuntime {
    fn on_game_process_event(
        &self,
        event: GameProcessEvent,
    ) -> vrcx_0_application_core::Result<()> {
        self.update_process_status(event.is_game_running, event.is_steamvr_running);
        Ok(())
    }
}

struct RuntimeWristFrameProducer {
    services: Arc<dyn VrOverlayRuntimeServices>,
    page: WristPage,
    presses: WristPressState,
}

impl RuntimeWristFrameProducer {
    fn new(services: Arc<dyn VrOverlayRuntimeServices>) -> Self {
        Self {
            services,
            page: WristPage::Feed,
            presses: WristPressState::default(),
        }
    }
}

/// Tracks menu presses so the page can follow them.
#[derive(Clone, Copy, Debug, Default)]
struct WristPressState {
    /// Menu presses seen on the previous frame. The first frame only records a
    /// baseline; the overlay is closed then, so it is not treated as a press.
    last_activations: Option<u64>,
    /// Whether a press has already opened the menu.
    opened: bool,
}

/// Fork: the first press opens the first configured page and every later press
/// moves to the next one, while the backend restarts the inactivity timeout. The
/// menu never has to be closed and reopened to switch pages.
fn track_wrist_page(
    config: &VrOverlayRuntimeConfig,
    page: &mut WristPage,
    state: &mut WristPressState,
    activations: u64,
) {
    if state.last_activations != Some(activations) {
        let is_press = state.last_activations.is_some();
        state.last_activations = Some(activations);
        if is_press {
            *page = if state.opened {
                config.wrist_pages.next_after(*page)
            } else {
                config.wrist_pages.first()
            };
            state.opened = true;
        }
    }
    *page = config.wrist_pages.normalize(*page);
}

impl VrOverlayFrameProducer for RuntimeWristFrameProducer {
    fn next_frame(&mut self, input: VrOverlayFrameInput) -> Result<RgbaFrame, String> {
        track_wrist_page(
            &input.config,
            &mut self.page,
            &mut self.presses,
            input.wrist_activations,
        );
        let page = self.page;
        let frame_input = if input.test_mode {
            test_wrist_frame_input(
                input.config,
                input.devices,
                local_time_text(input.config.dt_hour12),
                now_ms(),
            )
        } else {
            build_wrist_frame_input(
                self.services.as_ref(),
                input.config,
                input.devices,
                input.wrist_visible,
                page,
            )
        };
        let model = build_wrist_surface_model(frame_input);
        render_slint_wrist_frame(&model)
    }
}

fn render_slint_wrist_frame(model: &WristSurfaceModel) -> Result<RgbaFrame, String> {
    SLINT_WRIST_RENDERER.with(|renderer| {
        renderer
            .borrow_mut()
            .get_or_insert_with(SlintWristRenderer::new)
            .render(model)
    })
}

fn clear_slint_wrist_renderer() {
    SLINT_WRIST_RENDERER.with(|renderer| {
        renderer.borrow_mut().take();
    });
}

pub(crate) fn render_slint_hmd_frame(model: &MainSurfaceModel) -> Result<RgbaFrame, String> {
    SLINT_HMD_RENDERER.with(|renderer| {
        renderer
            .borrow_mut()
            .get_or_insert_with(SlintHmdRenderer::new)
            .render(model)
    })
}

fn clear_slint_hmd_renderer() {
    SLINT_HMD_RENDERER.with(|renderer| {
        renderer.borrow_mut().take();
    });
}

#[derive(Default)]
struct StaticWristFrameProducer;

impl VrOverlayFrameProducer for StaticWristFrameProducer {
    fn next_frame(&mut self, _input: VrOverlayFrameInput) -> Result<RgbaFrame, String> {
        Ok(RgbaFrame::new(OverlaySize::new(16, 8), vec![0; 16 * 8 * 4]))
    }
}

fn start_mode_allows(start_mode: WristOverlayStartMode, game_running: bool) -> bool {
    match start_mode {
        WristOverlayStartMode::SteamVr => true,
        WristOverlayStartMode::Vrchat => game_running,
    }
}

fn surface_active_for_start_mode(
    enabled: bool,
    start_mode: WristOverlayStartMode,
    backend_available: bool,
    steamvr_running: bool,
    game_running: bool,
) -> bool {
    enabled && backend_available && steamvr_running && start_mode_allows(start_mode, game_running)
}

fn overlay_surface_configs(
    active_surfaces: ActiveOverlaySurfaces,
    config: VrOverlayRuntimeConfig,
    runtime: &VrOverlayRuntime,
) -> Vec<OverlaySurfaceConfig> {
    let force_visible = runtime.is_test_mode();
    let mut configs = Vec::new();
    if active_surfaces.wrist {
        configs.extend(wrist_surface_configs(config, force_visible));
    }
    if active_surfaces.hmd {
        configs.push(hmd_surface_config(config.hmd.position));
    }
    configs
}

fn wrist_surface_configs(
    config: VrOverlayRuntimeConfig,
    force_visible: bool,
) -> Vec<OverlaySurfaceConfig> {
    wrist_surface_ids(config.hand)
        .into_iter()
        .map(|surface_id| {
            let device_hint = if surface_id.as_str() == "wrist-right" {
                "right-hand"
            } else {
                "left-hand"
            };
            wrist_surface_config(
                surface_id.as_str(),
                device_hint,
                config.render.size,
                config.button,
                force_visible,
                config.wrist_timeout_secs,
            )
        })
        .collect()
}

fn wrist_surface_ids(hand: WristOverlayHand) -> Vec<OverlaySurfaceId> {
    let mut surface_ids = Vec::new();
    if matches!(hand, WristOverlayHand::Left | WristOverlayHand::Both) {
        surface_ids.push(OverlaySurfaceId::new("wrist-left"));
    }
    if matches!(hand, WristOverlayHand::Right | WristOverlayHand::Both) {
        surface_ids.push(OverlaySurfaceId::new("wrist-right"));
    }
    surface_ids
}

fn wrist_surface_config(
    surface_id: &str,
    device_hint: &str,
    size: WristOverlaySizePreset,
    button: OverlayActivationButton,
    force_visible: bool,
    timeout_secs: u8,
) -> OverlaySurfaceConfig {
    let timeout_ms = u64::from(timeout_secs) * 1_000;
    OverlaySurfaceConfig {
        surface_id: OverlaySurfaceId::new(surface_id),
        size: size.overlay_size(),
        physical_width_meters: size.physical_width_meters(),
        placement: OverlayPlacement::TrackedDeviceRelative {
            device_hint: device_hint.to_string(),
        },
        activation_button: button,
        force_visible,
        visible_duration_ms: timeout_ms,
    }
}

fn hmd_surface_config(position: HmdNotificationPosition) -> OverlaySurfaceConfig {
    let timeout_ms = 5_000; // Default 5 seconds for HMD notifications
    OverlaySurfaceConfig {
        surface_id: OverlaySurfaceId::new(MAIN_SURFACE_ID),
        size: OverlaySize::new(960, 528),
        physical_width_meters: 0.95,
        placement: OverlayPlacement::TrackedDeviceRelative {
            device_hint: position.as_device_hint().to_string(),
        },
        activation_button: OverlayActivationButton::Grip,
        force_visible: false,
        visible_duration_ms: timeout_ms,
    }
}

pub(super) fn build_wrist_frame_input(
    services: &dyn VrOverlayRuntimeServices,
    config: VrOverlayRuntimeConfig,
    devices: Vec<VrDeviceSnapshot>,
    live_now_playing: bool,
    page: WristPage,
) -> WristOverlayFrameInput {
    let game_log = services.game_log_snapshot();
    let now_playing = services.now_playing();
    let captured_at_ms = now_ms();
    // Fork: player rows (with local notes) only when a player page is shown.
    let players = if page == WristPage::Feed {
        Vec::new()
    } else {
        let ids: Vec<String> = game_log
            .players
            .iter()
            .map(|player| player.user_id.clone())
            .collect();
        let notes = services.user_notes(&ids);
        let mut rows: Vec<(Option<i64>, WristPlayerRow)> = game_log
            .players
            .iter()
            .map(|player| {
                (
                    player.join_time_ms,
                    WristPlayerRow {
                        display_name: player.display_name.clone(),
                        note: notes.get(&player.user_id).cloned().unwrap_or_default(),
                        joined_text: player
                            .join_time_ms
                            .map(|joined| compact_duration((captured_at_ms - joined).max(0)))
                            .unwrap_or_default(),
                        is_friend: false,
                    },
                )
            })
            .collect();
        sort_wrist_players(&mut rows, config.wrist_players_sort);
        rows.into_iter().map(|(_, row)| row).collect()
    };
    let mut activity = services.overlay_activity().snapshot();
    for entry in &mut activity.entries {
        refresh_cached_world_name(services.world_cache(), entry);
    }
    WristOverlayFrameInput {
        activity,
        devices,
        now_playing: (!now_playing.url.trim().is_empty()).then(|| WristRuntimeNowPlaying {
            title: first_non_empty_owned([now_playing.name.as_str(), now_playing.url.as_str()]),
            length_seconds: now_playing.length,
            position_seconds: now_playing.position,
            started_at: now_playing.started_at.clone().unwrap_or_default(),
        }),
        live_now_playing,
        footer: WristRuntimeFooter {
            player_count: game_log.players.len() as u32,
            instance_duration: instance_duration_text(
                &game_log.location,
                &game_log.started_at,
                captured_at_ms,
            ),
            local_time: local_time_text(config.dt_hour12),
        },
        options: config.render,
        locale: config.locale.as_str().to_string(),
        show_instance_id_in_location: config.show_instance_id_in_location,
        captured_at_ms,
        page,
        players,
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

fn local_time_text(hour12: bool) -> String {
    let now = Local::now();
    format_local_time(now.hour(), now.minute(), hour12)
}

fn format_local_time(hour: u32, minute: u32, hour12: bool) -> String {
    if !hour12 {
        return format!("{hour:02}:{minute:02}");
    }
    let period = if hour < 12 { "AM" } else { "PM" };
    let display_hour = match hour % 12 {
        0 => 12,
        value => value,
    };
    format!("{display_hour}:{minute:02} {period}")
}

fn instance_duration_text(location: &str, started_at: &str, now_ms: i64) -> String {
    if !is_real_instance_location(location) {
        return String::new();
    }
    let Some(started_at_ms) = DateTime::parse_from_rfc3339(started_at)
        .ok()
        .map(|value| value.timestamp_millis())
    else {
        return String::new();
    };
    if now_ms < started_at_ms {
        return String::new();
    }
    compact_duration(now_ms - started_at_ms)
}

fn is_real_instance_location(location: &str) -> bool {
    let location = location.trim().to_ascii_lowercase();
    location.starts_with("wrld_") && location.contains(':')
}

/// Name order (case-insensitive) or most recent join first; ties by name.
fn sort_wrist_players(rows: &mut [(Option<i64>, WristPlayerRow)], sort: WristPlayersSort) {
    rows.sort_by(|(a_joined, a), (b_joined, b)| {
        let by_name = || {
            a.display_name
                .to_lowercase()
                .cmp(&b.display_name.to_lowercase())
        };
        match sort {
            WristPlayersSort::Name => by_name(),
            WristPlayersSort::Joined => b_joined.cmp(a_joined).then_with(by_name),
        }
    });
}

#[cfg(test)]
mod wrist_page_tests {
    use super::*;

    fn config_with(pages: &str) -> VrOverlayRuntimeConfig {
        VrOverlayRuntimeConfig {
            wrist_pages: WristPageOrder::from_config(pages),
            ..Default::default()
        }
    }

    #[test]
    fn each_press_advances_the_page_without_closing_the_menu() {
        let config = config_with("feed,players,notes");
        let mut page = WristPage::Feed;
        let mut state = WristPressState::default();

        // Nothing pressed yet.
        track_wrist_page(&config, &mut page, &mut state, 0);
        assert_eq!(page, WristPage::Feed);

        // The first press opens on the first configured page.
        track_wrist_page(&config, &mut page, &mut state, 1);
        assert_eq!(page, WristPage::Feed);

        // Pressing again while the menu is still open advances the page.
        track_wrist_page(&config, &mut page, &mut state, 2);
        assert_eq!(page, WristPage::Players);
        track_wrist_page(&config, &mut page, &mut state, 3);
        assert_eq!(page, WristPage::Notes);

        // And wraps around.
        track_wrist_page(&config, &mut page, &mut state, 4);
        assert_eq!(page, WristPage::Feed);
    }

    #[test]
    fn frames_without_a_press_keep_the_current_page() {
        let config = config_with("feed,players,notes");
        let mut page = WristPage::Feed;
        let mut state = WristPressState::default();

        track_wrist_page(&config, &mut page, &mut state, 0);
        track_wrist_page(&config, &mut page, &mut state, 1);
        track_wrist_page(&config, &mut page, &mut state, 2);
        assert_eq!(page, WristPage::Players);

        // The menu stays open on the same page until the user presses again.
        for _ in 0..5 {
            track_wrist_page(&config, &mut page, &mut state, 2);
        }
        assert_eq!(page, WristPage::Players);
    }

    #[test]
    fn hidden_pages_are_skipped_when_cycling() {
        let config = config_with("feed,notes");
        let mut page = WristPage::Feed;
        let mut state = WristPressState::default();

        track_wrist_page(&config, &mut page, &mut state, 0);
        track_wrist_page(&config, &mut page, &mut state, 1);
        assert_eq!(page, WristPage::Feed);
        track_wrist_page(&config, &mut page, &mut state, 2);
        assert_eq!(page, WristPage::Notes);
        track_wrist_page(&config, &mut page, &mut state, 3);
        assert_eq!(page, WristPage::Feed);
    }

    fn row(name: &str) -> WristPlayerRow {
        WristPlayerRow {
            display_name: name.into(),
            ..Default::default()
        }
    }

    #[test]
    fn players_sort_by_name_or_latest_join() {
        let mut rows = vec![
            (Some(10), row("bea")),
            (Some(30), row("Cid")),
            (None, row("Abe")),
            (Some(30), row("ann")),
        ];
        sort_wrist_players(&mut rows, WristPlayersSort::Name);
        let names: Vec<_> = rows.iter().map(|(_, r)| r.display_name.as_str()).collect();
        assert_eq!(names, ["Abe", "ann", "bea", "Cid"]);
        sort_wrist_players(&mut rows, WristPlayersSort::Joined);
        let names: Vec<_> = rows.iter().map(|(_, r)| r.display_name.as_str()).collect();
        assert_eq!(names, ["ann", "Cid", "bea", "Abe"]);
    }
}

#[cfg(test)]
mod activity_sink_tests;
#[cfg(test)]
mod config_reload_tests;
