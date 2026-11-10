use std::cell::RefCell;
use std::sync::Arc;

use vrcx_0_core::text::first_non_empty_owned;
use vrcx_0_vr_overlay::{
    MainSurfaceModel, OverlaySize, RgbaFrame, SlintHmdRenderer, SlintWristRenderer,
    WristSurfaceModel,
};
use vrcx_0_vr_overlay_backend::VrDeviceSnapshot;

use crate::config::VrOverlayRuntimeConfig;
use crate::surfaces::hmd_toast::refresh_cached_location_names;
use crate::test_preview::test_wrist_frame_input;
use crate::{
    build_wrist_surface_model, VrOverlayRuntimeServices, WristOverlayFrameInput,
    WristRuntimeFooter, WristRuntimeNowPlaying,
};

use super::text::{elapsed_minutes_text, instance_duration_text, local_time_text, now_ms};
use super::{
    shared_languages, sort_wrist_players, track_wrist_page, VrOverlayFrameInput, WristPressState,
};
use crate::surfaces::wrist::compact_duration;
use crate::{WristPage, WristPlayerRow};

pub(super) trait VrOverlayFrameProducer: Send {
    /// `None` when there is nothing new to show, such as while the wrist is hidden.
    fn next_frame(&mut self, input: VrOverlayFrameInput) -> Result<Option<RgbaFrame>, String>;
}

pub(super) type VrOverlayFrameProducerFactory =
    Box<dyn Fn() -> Box<dyn VrOverlayFrameProducer> + Send + Sync>;

thread_local! {
    static SLINT_WRIST_RENDERER: RefCell<Option<SlintWristRenderer>> = const { RefCell::new(None) };
    static SLINT_HMD_RENDERER: RefCell<Option<SlintHmdRenderer>> = const { RefCell::new(None) };
}

pub(super) struct RuntimeWristFrameProducer {
    services: Arc<dyn VrOverlayRuntimeServices>,
    page: WristPage,
    presses: WristPressState,
}

impl RuntimeWristFrameProducer {
    pub(super) fn new(services: Arc<dyn VrOverlayRuntimeServices>) -> Self {
        Self {
            services,
            page: WristPage::Feed,
            presses: WristPressState::default(),
        }
    }
}

impl VrOverlayFrameProducer for RuntimeWristFrameProducer {
    fn next_frame(&mut self, input: VrOverlayFrameInput) -> Result<Option<RgbaFrame>, String> {
        track_wrist_page(
            &input.config,
            &mut self.page,
            &mut self.presses,
            input.wrist_activations,
        );
        if !input.wrist_visible && !input.test_mode {
            return Ok(None);
        }
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
        render_slint_wrist_frame(&model).map(Some)
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

pub(super) fn clear_slint_wrist_renderer() {
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

pub(super) fn clear_slint_hmd_renderer() {
    SLINT_HMD_RENDERER.with(|renderer| {
        renderer.borrow_mut().take();
    });
}

#[derive(Default)]
pub(super) struct StaticWristFrameProducer;

impl VrOverlayFrameProducer for StaticWristFrameProducer {
    fn next_frame(&mut self, _input: VrOverlayFrameInput) -> Result<Option<RgbaFrame>, String> {
        Ok(Some(RgbaFrame::new(
            OverlaySize::new(16, 8),
            vec![0; 16 * 8 * 4],
        )))
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
        let friends = services.friend_records(&ids);
        let cached = services.cached_user_statuses(&ids);
        let current_user_id = services.auth_scope().snapshot().current_user_id;
        let local_languages = cached
            .get(&current_user_id)
            .map(|status| status.languages.as_slice())
            .unwrap_or_default();
        let mut rows: Vec<(Option<i64>, WristPlayerRow)> = game_log
            .players
            .iter()
            .map(|player| {
                let friend = friends.get(&player.user_id);
                let cached = cached.get(&player.user_id);
                (
                    player.join_time_ms,
                    WristPlayerRow {
                        user_id: player.user_id.clone(),
                        display_name: player.display_name.clone(),
                        note: notes.get(&player.user_id).cloned().unwrap_or_default(),
                        joined_text: player
                            .join_time_ms
                            .map(|joined| compact_duration((captured_at_ms - joined).max(0)))
                            .unwrap_or_default(),
                        is_friend: friend.is_some(),
                        // Everyone listed here is in the current instance, so
                        // a player without friend presence is online.
                        state: friend
                            .map(|(_, presence)| presence.section().as_str().to_string())
                            .unwrap_or_else(|| "online".to_string()),
                        platform: friend
                            .map(|(_, presence)| presence.platform().to_string())
                            .filter(|platform| !platform.is_empty())
                            .or_else(|| cached.map(|status| status.platform.clone()))
                            .unwrap_or_default(),
                        status_description: friend
                            .map(|(record, _)| record.status_description.to_string())
                            .filter(|description| !description.is_empty())
                            .or_else(|| cached.map(|status| status.status_description.clone()))
                            .unwrap_or_default(),
                        age_verified: friend
                            .and_then(|(record, _)| record.extra.get("ageVerificationStatus"))
                            .and_then(serde_json::Value::as_str)
                            .map(|status| status == "18+")
                            .or_else(|| cached.map(|status| status.age_verified))
                            .unwrap_or_default(),
                        is_local: !current_user_id.is_empty() && player.user_id == current_user_id,
                        languages: if player.user_id == current_user_id {
                            local_languages
                                .iter()
                                .map(|code| code.to_ascii_uppercase())
                                .collect()
                        } else {
                            shared_languages(
                                local_languages,
                                cached.map_or(&[], |status| status.languages.as_slice()),
                            )
                        },
                    },
                )
            })
            .collect();
        sort_wrist_players(&mut rows, config.wrist_players_sort);
        rows.into_iter().map(|(_, row)| row).collect()
    };
    let mut activity = services.activity_router().snapshot();
    for entry in &mut activity.entries {
        refresh_cached_location_names(services, entry);
    }
    WristOverlayFrameInput {
        activity,
        devices,
        now_playing: (!now_playing.url.trim().is_empty()).then(|| WristRuntimeNowPlaying {
            title: first_non_empty_owned([now_playing.name.as_str(), now_playing.url.as_str()]),
            artist: now_playing.artist.clone(),
            length_seconds: now_playing.length,
            position_seconds: now_playing.position,
            started_at: now_playing.started_at.unwrap_or_default(),
        }),
        live_now_playing,
        footer: WristRuntimeFooter {
            player_count: game_log.players.len() as u32,
            instance_duration: instance_duration_text(
                &game_log.location,
                game_log.started_at,
                captured_at_ms,
            ),
            online_duration: services
                .game_started_at()
                .map(|started_at| elapsed_minutes_text(started_at, captured_at_ms))
                .unwrap_or_default(),
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
