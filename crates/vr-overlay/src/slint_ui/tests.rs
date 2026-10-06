use super::*;
use super::{
    platform::{ensure_platform, to_slint_color},
    wrist::{wrist_device_item, wrist_device_tokens, wrist_feed_item, wrist_muted_text},
};
use crate::{
    AvatarBitmap, DeviceChip, DeviceRole, DeviceStatus, FeedAccent, FeedKind, FeedLine,
    FeedRelation, FeedSeverity, MainSurfaceModel, OverlayFooter, OverlayNowPlaying, OverlaySize,
    PlayerCell, RgbaFrame, ToastCard, WristSurfaceModel, WristTextScale,
};
use std::{sync::Arc, thread};

#[test]
fn slint_platform_init_is_available_on_each_render_thread() {
    ensure_platform().unwrap();
    thread::spawn(|| {
        let mut renderer = SlintWristRenderer::new();
        let frame = renderer.render(&sample_wrist_model()).unwrap();
        assert_eq!(frame.size.width, 512);
    })
    .join()
    .unwrap();
}

fn player_grid_model(players: usize, max_height: u32, note: &str) -> WristSurfaceModel {
    WristSurfaceModel {
        size: OverlaySize::new(1024, max_height),
        feed_rows: Vec::new(),
        players: (0..players)
            .map(|index| PlayerCell {
                name: format!("Player number {index}"),
                joined: "12m".to_string(),
                status: "active / PC VR / exploring".to_string(),
                note: note.to_string(),
                is_friend: index % 2 == 0,
            })
            .collect(),
        ..sample_wrist_model()
    }
}

const LONG_NOTE: &str = "a long note that has to wrap across several lines in a narrow column";

#[test]
fn wrist_player_grid_grows_with_its_players_up_to_the_max_height() {
    let mut renderer = SlintWristRenderer::new();
    let few = renderer.render(&player_grid_model(4, 4000, "")).unwrap();
    let full = renderer.render(&player_grid_model(80, 4000, "")).unwrap();
    let noted = renderer
        .render(&player_grid_model(80, 4000, LONG_NOTE))
        .unwrap();

    assert_eq!(full.size.width, 1024);
    assert!(full.size.height > few.size.height);
    assert!(noted.size.height > full.size.height);
}

#[test]
fn wrist_player_grid_adds_columns_then_shrinks_text_to_fit_the_max_height() {
    let mut renderer = SlintWristRenderer::new();
    let roomy = renderer
        .render(&player_grid_model(80, 4000, LONG_NOTE))
        .unwrap();
    let fitted = renderer
        .render(&player_grid_model(80, 900, LONG_NOTE))
        .unwrap();
    let tight = renderer
        .render(&player_grid_model(80, 500, LONG_NOTE))
        .unwrap();

    assert!(roomy.size.height > 900, "{:?}", roomy.size);
    assert!(fitted.size.height <= 900, "{:?}", fitted.size);
    assert!(tight.size.height <= 500, "{:?}", tight.size);
}

#[test]
fn wrist_player_grid_wraps_long_names_instead_of_clipping_them() {
    let mut renderer = SlintWristRenderer::new();
    let short = renderer.render(&player_grid_model(40, 4000, "")).unwrap();
    let mut model = player_grid_model(40, 4000, "");
    model.players[0].name =
        "An extremely long display name that cannot fit on one line".to_string();
    let long = renderer.render(&model).unwrap();

    assert!(long.size.height > short.size.height);
}

#[test]
fn wrist_player_grid_reuses_its_resized_host() {
    let mut renderer = SlintWristRenderer::new();
    let model = player_grid_model(80, 4000, "note");
    let first = renderer.render(&model).unwrap();
    let mut changed = model.clone();
    changed.players[0].joined = "13m".to_string();
    let second = renderer.render(&changed).unwrap();

    assert_eq!(first.size, second.size);
    assert_eq!(renderer.render_count(), 2);
}

#[test]
fn wrist_text_scales_resize_their_areas() {
    let mut renderer = SlintWristRenderer::new();
    let mut model = sample_wrist_model();
    model.size = OverlaySize::new(512, 4000);
    model.feed_rows = (0..4).map(feed_row).collect();
    let base = renderer.render(&model).unwrap().size.height;
    for text in [
        WristTextScale {
            header_percent: 150,
            ..Default::default()
        },
        WristTextScale {
            footer_percent: 150,
            ..Default::default()
        },
        WristTextScale {
            content_percent: 150,
            ..Default::default()
        },
    ] {
        model.text = text;
        let height = renderer.render(&model).unwrap().size.height;
        assert!(height > base, "{text:?}: {height} <= {base}");
    }
}

#[test]
fn slint_wrist_renderer_reuses_cached_frame_for_equal_model() {
    let mut renderer = SlintWristRenderer::new();
    let model = sample_wrist_model();

    let first = renderer.render(&model).unwrap();
    let second = renderer.render(&model).unwrap();

    assert_eq!(first, second);
    assert_eq!(renderer.render_count(), 1);

    let mut changed = model.clone();
    changed.footer.right = "12:35".to_string();
    let third = renderer.render(&changed).unwrap();

    assert_ne!(first, third);
    assert_eq!(renderer.render_count(), 2);
}

#[test]
fn hmd_toasts_put_the_newest_card_on_the_inner_edge_of_the_stack() {
    use slint::Model;

    let mut model = sample_main_model();
    model.toasts = ["oldest", "middle", "newest", "latest"]
        .into_iter()
        .map(|actor| ToastCard {
            actor_name: actor.to_string(),
            show_avatar: false,
            avatar: None,
            ..model.toasts[0].clone()
        })
        .collect();
    let actors = |model: &MainSurfaceModel| {
        ensure_platform().unwrap();
        let items = hmd::hmd_toast_model(model, &mut platform::AvatarImageCache::new());
        (0..items.row_count())
            .filter_map(|row| items.row_data(row))
            .map(|item| item.actor.to_string())
            .collect::<Vec<_>>()
    };

    assert_eq!(actors(&model), ["latest", "newest", "middle"]);
    model.stack_upward = true;
    assert_eq!(actors(&model), ["middle", "newest", "latest"]);
}

const LONG_HMD_ACTION: &str = "joined wrld_4cf5a0c2-7f7b-4e19-9a3a-6b2e5c8d9f01:12345~private(usr_c1644b5b-3ca4-45b4-97c6-a2a0de70d469)~region(jp)";

fn painted_rows(frame: &RgbaFrame) -> (u32, u32) {
    let column = frame.size.width / 2;
    let rows = (0..frame.size.height)
        .filter(|y| frame.data[((y * frame.size.width + column) * 4 + 3) as usize] > 0)
        .collect::<Vec<_>>();
    (rows[0], rows[rows.len() - 1])
}

fn painted_width(frame: &RgbaFrame, row: u32) -> u32 {
    let columns = (0..frame.size.width)
        .filter(|x| frame.data[((row * frame.size.width + x) * 4 + 3) as usize] > 0)
        .collect::<Vec<_>>();
    columns[columns.len() - 1] - columns[0] + 1
}

#[test]
fn hmd_newest_card_keeps_its_outer_edge_when_it_wraps() {
    for compact in [false, true] {
        for stack_upward in [false, true] {
            let mut renderer = SlintHmdRenderer::new();
            let mut model = sample_main_model();
            model.compact = compact;
            model.stack_upward = stack_upward;
            model.toasts[0].show_avatar = false;
            let short = renderer.render(&model).unwrap();
            let (top, bottom) = painted_rows(&short);

            model.toasts[0].action = LONG_HMD_ACTION.to_string();
            let wrapped = renderer.render(&model).unwrap();
            let (wrapped_top, wrapped_bottom) = painted_rows(&wrapped);

            let label = format!("compact = {compact}, stack_upward = {stack_upward}");
            assert!(wrapped_bottom - wrapped_top > bottom - top, "{label}");
            if stack_upward {
                assert_eq!(
                    wrapped.size.height - wrapped_bottom,
                    short.size.height - bottom,
                    "{label}"
                );
            } else {
                assert_eq!(wrapped_top, top, "{label}");
            }
        }
    }
}

#[test]
fn hmd_cards_hug_short_text_and_wrap_long_text() {
    for compact in [false, true] {
        let mut renderer = SlintHmdRenderer::new();
        let mut model = sample_main_model();
        model.compact = compact;
        model.toasts[0].show_avatar = false;
        model.toasts[0].action = "online".to_string();
        let short = renderer.render(&model).unwrap();
        model.toasts[0].action = LONG_HMD_ACTION.to_string();
        let long = renderer.render(&model).unwrap();

        let label = format!("compact = {compact}");
        assert!(painted_width(&short, 40) < 640, "{label}");
        assert!(
            painted_width(&long, 40) > painted_width(&short, 40),
            "{label}"
        );
        assert!(long.size.height > short.size.height, "{label}");
        assert!(painted_width(&long, 40) <= long.size.width - 40, "{label}");
    }
}

#[test]
fn hmd_text_size_scales_the_cards() {
    let mut renderer = SlintHmdRenderer::new();
    let mut model = sample_main_model();
    let normal = renderer.render(&model).unwrap();
    model.text_percent = 150;
    let large = renderer.render(&model).unwrap();

    assert!(large.size.height > normal.size.height);
    assert!(painted_width(&large, 40) > painted_width(&normal, 40));
}

#[test]
fn slint_hmd_renderer_reuses_cached_frame_for_equal_model() {
    let mut renderer = SlintHmdRenderer::new();
    let model = sample_main_model();

    let first = renderer.render(&model).unwrap();
    let second = renderer.render(&model).unwrap();

    assert_eq!(first, second);
    assert_eq!(renderer.render_count(), 1);

    let mut changed = model.clone();
    changed.toasts[0].action = "joined a private instance".to_string();
    let third = renderer.render(&changed).unwrap();

    assert_ne!(first, third);
    assert_eq!(renderer.render_count(), 2);
}

#[test]
fn slint_hmd_renderer_shows_late_arriving_avatar() {
    let mut renderer = SlintHmdRenderer::new();
    let mut model = sample_main_model();
    let avatar = model.toasts[0].avatar.take();

    let without_avatar = renderer.render(&model).unwrap();

    model.toasts[0].avatar = avatar;
    let with_avatar = renderer.render(&model).unwrap();

    assert_ne!(without_avatar, with_avatar);
    assert_eq!(renderer.render_count(), 2);
}

#[test]
fn slint_hmd_renderer_hides_avatar_placeholder_when_avatar_slot_is_disabled() {
    let mut renderer = SlintHmdRenderer::new();
    let mut model = sample_main_model();
    model.toasts[0].avatar = None;
    model.toasts[0].show_avatar = true;

    let with_placeholder = renderer.render(&model).unwrap();

    model.toasts[0].show_avatar = false;
    let without_slot = renderer.render(&model).unwrap();

    assert_ne!(with_placeholder, without_slot);
    assert_eq!(renderer.render_count(), 2);
}

#[test]
fn wrist_panel_height_fits_the_feed_rows() {
    let mut renderer = SlintWristRenderer::new();
    let mut model = sample_wrist_model();
    let alpha_at =
        |frame: &RgbaFrame, y: u32| frame.data[((y * frame.size.width + 250) * 4 + 3) as usize];

    model.feed_rows = Vec::new();
    let empty = renderer.render(&model).unwrap();
    model.feed_rows = (0..2).map(feed_row).collect();
    let short = renderer.render(&model).unwrap();
    model.feed_rows = (0..8).map(feed_row).collect();
    let tall = renderer.render(&model).unwrap();

    assert_eq!(empty.size.height, 44 + 34);
    assert_eq!(short.size.height, 49 + 2 * 38 + 34);
    assert_eq!(tall.size.height, 49 + 8 * 38 + 34);
    for frame in [&empty, &short, &tall] {
        assert!(alpha_at(frame, frame.size.height - 3) > 200);
    }
}

#[test]
fn wrist_panel_fills_the_width_of_every_overlay_size_preset() {
    for size in overlay_size_presets() {
        let mut renderer = SlintWristRenderer::new();
        let mut model = sample_wrist_model();
        model.size = size;
        model.feed_rows = (0..4).map(feed_row).collect();

        let frame = renderer.render(&model).unwrap();

        let right_edge = ((60 * size.width + size.width - 4) * 4 + 3) as usize;
        assert!(
            frame.data[right_edge] > 200,
            "panel does not reach the right edge at {}x{}",
            size.width,
            size.height
        );
    }
}

#[test]
fn wrist_panel_feed_grows_up_to_the_max_height() {
    for preset in overlay_size_presets() {
        let max_height = preset.width * 2;
        let size = OverlaySize::new(preset.width, max_height);
        let capacity = (max_height - 49 - 34) / 38;
        let mut renderer = SlintWristRenderer::new();
        let mut model = sample_wrist_model();
        model.size = size;
        model.feed_rows = (0..capacity + 3).map(feed_row).collect();

        let frame = renderer.render(&model).unwrap();
        let alpha_at = |y: u32| frame.data[((y * size.width + 250) * 4 + 3) as usize];

        let panel_height = 49 + capacity * 38 + 34;
        assert!(panel_height <= max_height);
        assert_eq!(
            frame.size.height, panel_height,
            "at {}x{}",
            size.width, size.height
        );
        assert!(
            alpha_at(panel_height - 3) > 200,
            "panel ends before the bottom at {}x{}",
            size.width,
            size.height
        );
    }
}

#[test]
fn wrist_panel_reserves_up_to_two_title_lines_for_now_playing_above_the_footer() {
    let mut renderer = SlintWristRenderer::new();
    let mut model = sample_wrist_model();
    model.feed_rows = (0..2).map(feed_row).collect();
    let panel_bottom = |frame: &RgbaFrame| {
        (0..frame.size.height)
            .rev()
            .find(|y| frame.data[((y * frame.size.width + 250) * 4 + 3) as usize] > 200)
            .unwrap()
    };

    let without = panel_bottom(&renderer.render(&model).unwrap());
    model.now_playing = Some(now_playing("Never Gonna Give You Up", Some(400)));
    let one_line = panel_bottom(&renderer.render(&model).unwrap());
    model.now_playing = Some(now_playing(
        "【MV】YOASOBI「アイドル」/ Idol (Official Music Video) - TVアニメ『【推しの子】』OPテーマ 4K Remaster",
        Some(400),
    ));
    let two_lines = panel_bottom(&renderer.render(&model).unwrap());
    model.now_playing = Some(now_playing(
        &"【MV】YOASOBI「アイドル」/ Idol (Official Music Video) - TVアニメ ".repeat(6),
        Some(400),
    ));
    let truncated = panel_bottom(&renderer.render(&model).unwrap());
    model.now_playing = Some(now_playing("https://stream.example.test/live", None));
    let unknown_length = panel_bottom(&renderer.render(&model).unwrap());

    assert!(one_line > without + 40);
    assert!(two_lines > one_line + 10);
    assert!((two_lines..=two_lines + 2).contains(&truncated));
    assert_eq!(unknown_length, one_line);
}

#[test]
fn wrist_panel_redraws_only_when_the_now_playing_model_changes() {
    let mut renderer = SlintWristRenderer::new();
    let mut model = sample_wrist_model();
    model.now_playing = Some(now_playing("Never Gonna Give You Up", Some(400)));

    let first = renderer.render(&model).unwrap();
    let second = renderer.render(&model).unwrap();
    assert_eq!(first, second);
    assert_eq!(renderer.render_count(), 1);

    model.now_playing = Some(now_playing("Never Gonna Give You Up", Some(405)));
    let advanced = renderer.render(&model).unwrap();
    assert_ne!(first, advanced);
    assert_eq!(renderer.render_count(), 2);
}

fn now_playing(title: &str, progress_permille: Option<u16>) -> OverlayNowPlaying {
    OverlayNowPlaying {
        title: title.to_string(),
        time_text: "1:25 / 3:32".to_string(),
        progress_permille,
    }
}
fn overlay_size_presets() -> [OverlaySize; 3] {
    [
        OverlaySize::new(448, 448),
        OverlaySize::new(512, 512),
        OverlaySize::new(640, 640),
    ]
}

#[test]
fn wrist_device_tokens_prioritize_abnormal_trackers_and_filter_normal_other_devices() {
    let devices = vec![
        device("HMD", DeviceRole::Hmd, DeviceStatus::Normal, Some(90), 10),
        device(
            "L",
            DeviceRole::LeftController,
            DeviceStatus::LowBattery,
            Some(20),
            30,
        ),
        device(
            "R",
            DeviceRole::RightController,
            DeviceStatus::Normal,
            Some(80),
            10,
        ),
        device(
            "T1",
            DeviceRole::Tracker,
            DeviceStatus::TrackingWarning,
            None,
            30,
        ),
        device(
            "T2",
            DeviceRole::Tracker,
            DeviceStatus::CriticalBattery,
            Some(7),
            40,
        ),
        device(
            "T3",
            DeviceRole::Tracker,
            DeviceStatus::Normal,
            Some(70),
            10,
        ),
        device(
            "T5",
            DeviceRole::Tracker,
            DeviceStatus::LowBattery,
            Some(21),
            30,
        ),
        device(
            "Dongle",
            DeviceRole::Other,
            DeviceStatus::Disconnected,
            None,
            40,
        ),
        device("Camera", DeviceRole::Other, DeviceStatus::Normal, None, 10),
    ];

    let labels = wrist_device_tokens(&devices, 512.0)
        .into_iter()
        .map(|token| token.label)
        .collect::<Vec<_>>();

    assert_eq!(labels, ["HMD", "L", "R", "T2", "T1", "+1", "T×1", "Dongle"]);
}

#[test]
fn wrist_device_without_a_battery_reading_does_not_draw_a_full_battery() {
    let devices = [device(
        "L",
        DeviceRole::LeftController,
        DeviceStatus::Normal,
        None,
        10,
    )];
    let tokens = wrist_device_tokens(&devices, 512.0);
    let item = wrist_device_item(&tokens[0], true, true);

    assert!(!item.show_battery);
    assert!(!item.show_percent);
    assert_eq!(item.battery_fill, 0.0);
}

#[test]
fn wrist_battery_glyph_only_survives_when_it_still_carries_information() {
    let healthy = [device(
        "HMD",
        DeviceRole::Hmd,
        DeviceStatus::Normal,
        Some(82),
        20,
    )];
    let low = [device(
        "L",
        DeviceRole::LeftController,
        DeviceStatus::LowBattery,
        Some(18),
        20,
    )];
    let healthy_token = &wrist_device_tokens(&healthy, 512.0)[0];

    assert!(!wrist_device_item(healthy_token, true, true).show_battery);
    assert!(wrist_device_item(healthy_token, false, true).show_battery);
    assert!(wrist_device_item(&wrist_device_tokens(&low, 512.0)[0], true, true).show_battery);
}

#[test]
fn wrist_secondary_text_lifts_when_the_background_stops_being_opaque() {
    let devices = [device(
        "HMD",
        DeviceRole::Hmd,
        DeviceStatus::Normal,
        Some(82),
        20,
    )];
    let token = &wrist_device_tokens(&devices, 512.0)[0];

    let opaque = wrist_device_item(token, true, true);
    let translucent = wrist_device_item(token, true, false);

    assert_eq!(opaque.label_color, to_slint_color(wrist_muted_text(true)));
    assert_eq!(
        translucent.label_color,
        to_slint_color(wrist_muted_text(false))
    );
    assert!(wrist_muted_text(false).r > wrist_muted_text(true).r);
}

#[test]
fn wrist_charging_device_shows_a_charging_marker() {
    let devices = [device(
        "HMD",
        DeviceRole::Hmd,
        DeviceStatus::Charging,
        Some(82),
        20,
    )];
    let tokens = wrist_device_tokens(&devices, 512.0);
    let item = wrist_device_item(&tokens[0], true, true);

    assert_eq!(item.percent.as_str(), "82%+");
}

#[test]
fn wrist_feed_item_preserves_actor_detail_and_muted_media_detail() {
    let favorite = FeedLine {
        time_text: "16:31".to_string(),
        kind: FeedKind::Invite,
        actor_text: "Ada".to_string(),
        detail: "Ada invited you".to_string(),
        relation: FeedRelation::Favorite,
        severity: FeedSeverity::Important,
        accent: FeedAccent::None,
    };
    let media = FeedLine {
        time_text: String::new(),
        kind: FeedKind::Media,
        actor_text: "Player".to_string(),
        detail: "Muted media row".to_string(),
        relation: FeedRelation::None,
        severity: FeedSeverity::Normal,
        accent: FeedAccent::None,
    };

    let favorite_item = wrist_feed_item(&favorite, true);
    let media_item = wrist_feed_item(&media, true);

    assert!(favorite_item.has_actor);
    assert_eq!(favorite_item.actor.to_string(), "Ada");
    assert_eq!(favorite_item.detail.to_string(), "invited you");
    assert!(favorite_item.show_accent);
    assert!(media_item.has_actor);
    assert_eq!(media_item.actor.to_string(), "Player");
    assert_eq!(media_item.detail.to_string(), "Muted media row");
    assert_eq!(
        media_item.detail_color,
        to_slint_color(wrist_muted_text(true))
    );
}

#[test]
fn wrist_feed_item_uses_feed_type_accents_and_keeps_severity_precedence() {
    let mut row = FeedLine {
        time_text: "16:31".to_string(),
        kind: FeedKind::Friend,
        actor_text: "Ada".to_string(),
        detail: "Ada is online".to_string(),
        relation: FeedRelation::Friend,
        severity: FeedSeverity::Normal,
        accent: FeedAccent::Online,
    };

    let online = wrist_feed_item(&row, true);
    assert!(online.show_accent);
    assert_eq!(
        online.accent_color,
        to_slint_color(crate::Color::rgba(46, 211, 25, 255))
    );

    row.accent = FeedAccent::Location;
    let location = wrist_feed_item(&row, true);
    assert_eq!(
        location.accent_color,
        to_slint_color(crate::Color::rgba(14, 165, 233, 255))
    );

    row.severity = FeedSeverity::Warning;
    let warning = wrist_feed_item(&row, true);
    assert_eq!(
        warning.accent_color,
        to_slint_color(crate::Color::rgba(239, 68, 68, 255))
    );
}

fn sample_wrist_model() -> WristSurfaceModel {
    WristSurfaceModel {
        size: OverlaySize::new(512, 512),
        dark_background: true,
        show_battery_percent: true,
        devices: vec![
            DeviceChip {
                label: "HMD".to_string(),
                role: DeviceRole::Hmd,
                status: DeviceStatus::Normal,
                battery_percent: Some(82),
                text: "82".to_string(),
                priority: 10,
            },
            DeviceChip {
                label: "L".to_string(),
                role: DeviceRole::LeftController,
                status: DeviceStatus::LowBattery,
                battery_percent: Some(18),
                text: "18 low".to_string(),
                priority: 20,
            },
        ],
        feed_rows: vec![FeedLine {
            time_text: "16:31".to_string(),
            kind: FeedKind::Invite,
            actor_text: "Ada".to_string(),
            detail: "Ada invited you to 测试世界".to_string(),
            relation: FeedRelation::Favorite,
            severity: FeedSeverity::Important,
            accent: FeedAccent::None,
        }],
        players: Vec::new(),
        text: WristTextScale::default(),
        now_playing: None,
        footer: OverlayFooter {
            left: "8 players".to_string(),
            center: "Instance 12m".to_string(),
            right: "12:34".to_string(),
        },
    }
}

fn sample_main_model() -> MainSurfaceModel {
    MainSurfaceModel {
        size: OverlaySize::new(960, 528),
        dark_background: true,
        accent: crate::Color::rgba(94, 234, 212, 255),
        compact: false,
        stack_upward: false,
        text_percent: 100,
        toasts: vec![ToastCard {
            actor_name: "Ada".to_string(),
            relation: FeedRelation::Favorite,
            action: "joined your instance".to_string(),
            severity: FeedSeverity::Important,
            avatar: Some(AvatarBitmap {
                width: 2,
                height: 2,
                rgba: Arc::from(vec![
                    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255,
                ]),
            }),
            show_avatar: true,
        }],
    }
}

fn feed_row(index: u32) -> FeedLine {
    FeedLine {
        time_text: format!("12:{index:02}"),
        kind: FeedKind::System,
        actor_text: String::new(),
        detail: format!("row {index}"),
        relation: FeedRelation::None,
        severity: FeedSeverity::Normal,
        accent: FeedAccent::None,
    }
}

fn device(
    label: &str,
    role: DeviceRole,
    status: DeviceStatus,
    battery_percent: Option<u8>,
    priority: u8,
) -> DeviceChip {
    DeviceChip {
        label: label.to_string(),
        role,
        status,
        battery_percent,
        text: String::new(),
        priority,
    }
}
