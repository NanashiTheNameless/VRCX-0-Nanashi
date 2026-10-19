use std::time::Duration;

use super::SlintDesktopWidgetHost;
use crate::{AvatarBitmap, DesktopWidgetAction, DesktopWidgetRow, DesktopWidgetSurfaceModel};

const WIDTH: u32 = 320;
const HEIGHT: u32 = 200;

#[test]
fn a_see_through_empty_widget_is_invisible_but_can_still_be_grabbed() {
    let frame = Widget::new().render(&model(Vec::new(), 0, true));

    assert!(frame.max_alpha() <= 1, "{}", frame.max_alpha());
    assert_eq!(frame.alpha(WIDTH / 2, HEIGHT / 2), 1);
}

#[test]
fn a_see_through_click_through_widget_draws_nothing_at_all() {
    let frame = Widget::new().render(&model(Vec::new(), 0, false));

    assert_eq!(frame.max_alpha(), 0);
}

#[test]
fn background_opacity_sets_how_solid_the_panel_is() {
    let solid = Widget::new().render(&model(Vec::new(), 100, false));
    let half = Widget::new().render(&model(Vec::new(), 50, false));

    assert_eq!(solid.alpha(WIDTH / 2, HEIGHT / 2), 255);
    let half_alpha = half.alpha(WIDTH / 2, HEIGHT / 2);
    assert!((110..=145).contains(&half_alpha), "{half_alpha}");
}

#[test]
fn listing_newest_at_the_bottom_draws_rows_from_the_bottom() {
    let mut bottom = model(vec![row(1, "Ada", false)], 0, false);
    bottom.newest_on_top = false;
    let frame = Widget::new().settled(&bottom);

    let painted = frame.painted_rows();
    assert!(!painted.is_empty());
    assert!(
        painted.iter().all(|y| *y > HEIGHT * 3 / 4),
        "painted rows {:?}",
        painted.first()
    );
}

#[test]
fn listing_newest_on_top_draws_rows_from_the_top() {
    let frame = Widget::new().settled(&model(vec![row(1, "Ada", false)], 0, false));

    let painted = frame.painted_rows();
    assert!(!painted.is_empty());
    assert!(
        painted.iter().all(|y| *y < HEIGHT / 4),
        "painted rows end at {:?}",
        painted.last()
    );
}

#[test]
fn with_newest_on_top_the_top_row_is_the_newest_even_when_rows_overflow() {
    let rows = (1..=30).map(|id| row(id, "Ada", false)).collect();
    let mut widget = Widget::new();
    widget.settled(&model(rows, 0, true));

    assert_eq!(
        widget.click(14.0, top_row_y()),
        [DesktopWidgetAction::Actor(30)]
    );
}

#[test]
fn with_newest_at_the_bottom_the_bottom_row_is_the_newest_even_when_rows_overflow() {
    let rows = (1..=30).map(|id| row(id, "Ada", false)).collect();
    let mut bottom = model(rows, 0, true);
    bottom.newest_on_top = false;
    let mut widget = Widget::new();
    widget.settled(&bottom);

    assert_eq!(
        widget.click(14.0, bottom_row_y()),
        [DesktopWidgetAction::Actor(30)]
    );
}

#[test]
fn switching_the_order_moves_the_newest_row_to_the_other_end() {
    let rows: Vec<_> = (1..=3).map(|id| row(id, "Ada", false)).collect();
    let mut widget = Widget::new();
    let mut bottom = model(rows.clone(), 0, true);
    bottom.newest_on_top = false;
    widget.settled(&bottom);

    widget.settled(&model(rows, 0, true));

    assert_eq!(
        widget.click(14.0, top_row_y()),
        [DesktopWidgetAction::Actor(3)]
    );
}

#[test]
fn switching_the_order_repaints_exactly_like_a_freshly_opened_widget() {
    let rows: Vec<_> = (1..=3).map(|id| row(id, "Ada", false)).collect();
    let mut bottom = model(rows.clone(), 60, true);
    bottom.newest_on_top = false;
    let mut switched = Widget::new();
    switched.settled(&model(rows, 60, true));

    let after_switch = switched.settled(&bottom);
    let fresh = Widget::new().settled(&bottom);

    assert!(
        after_switch.0 == fresh.0,
        "the switched widget kept stale pixels"
    );
}

#[test]
#[cfg_attr(
    not(windows),
    ignore = "the desktop widget only ships on Windows and text placement follows the system fonts"
)]
fn every_rows_avatar_sits_level_with_its_text() {
    let rows = vec![
        DesktopWidgetRow {
            show_avatar_slot: true,
            actor: "スケムライク34".to_string(),
            detail: "加入了房间".to_string(),
            ..row(1, "", false)
        },
        DesktopWidgetRow {
            show_avatar_slot: true,
            actor: "sozo412".to_string(),
            detail: "离开了房间".to_string(),
            ..row(2, "", false)
        },
        DesktopWidgetRow {
            show_avatar_slot: true,
            actor: "HOSIKOTO".to_string(),
            detail: "离开了房间".to_string(),
            ..row(3, "", false)
        },
        DesktopWidgetRow {
            show_avatar_slot: true,
            actor: "千Firefly".to_string(),
            detail: "现在位于 VRChat Home 好友+ #66111".to_string(),
            favorite: true,
            avatar: Some(solid_avatar()),
            ..row(4, "", false)
        },
    ];
    let frame = Widget::new().settled(&model(rows, 0, false));

    let avatars = frame.avatar_spans();
    assert_eq!(avatars.len(), 4);
    for (top, bottom) in avatars {
        let avatar = (top + bottom) as f32 / 2.0;
        let text = frame.first_text_line_centroid(top);
        assert!(
            (text - avatar).abs() <= 1.25,
            "avatar centre {avatar} text centre {text}"
        );
    }
}

#[test]
fn clicking_a_name_reports_that_rows_person() {
    let mut widget = Widget::new();
    widget.settled(&model(vec![row(7, "Ada", false)], 0, true));

    assert_eq!(
        widget.click(14.0, top_row_y()),
        [DesktopWidgetAction::Actor(7)]
    );
}

#[test]
fn clicking_what_happened_reports_that_rows_detail() {
    let mut widget = Widget::new();
    widget.settled(&model(vec![row(7, "Ada", false)], 0, true));

    assert_eq!(
        widget.click(80.0, top_row_y()),
        [DesktopWidgetAction::Detail(7)]
    );
}

#[test]
fn pressing_on_empty_space_starts_moving_the_widget() {
    let mut widget = Widget::new();
    widget.settled(&model(vec![row(7, "Ada", false)], 0, true));

    assert_eq!(
        widget.click(20.0, HEIGHT as f32 - 20.0),
        [DesktopWidgetAction::Drag]
    );
}

#[test]
fn dragging_a_name_moves_the_widget() {
    let mut widget = Widget::new();
    widget.settled(&model(vec![row(7, "Ada", false)], 0, true));

    assert_eq!(
        widget.press_and_move(14.0, top_row_y(), 12.0),
        [DesktopWidgetAction::Drag]
    );
}

#[test]
fn dragging_what_happened_moves_the_widget() {
    let mut widget = Widget::new();
    widget.settled(&model(vec![row(7, "Ada", false)], 0, true));

    assert_eq!(
        widget.press_and_move(80.0, top_row_y(), 12.0),
        [DesktopWidgetAction::Drag]
    );
}

#[test]
fn a_slightly_shaky_click_on_a_name_still_opens_that_person() {
    let mut widget = Widget::new();
    widget.settled(&model(vec![row(7, "Ada", false)], 0, true));

    let mut actions = widget.press_and_move(14.0, top_row_y(), 2.0);
    widget.host.pointer_released(16.0, top_row_y());
    actions.extend(widget.host.take_actions());

    assert_eq!(actions, [DesktopWidgetAction::Actor(7)]);
}

#[test]
fn pressing_beside_a_short_line_of_what_happened_starts_moving_the_widget() {
    let mut short = row(7, "Ada", false);
    short.detail = "left".to_string();
    let mut widget = Widget::new();
    widget.settled(&model(vec![short], 0, true));

    assert_eq!(
        widget.click(200.0, top_row_y()),
        [DesktopWidgetAction::Drag]
    );
    assert_eq!(
        widget.click(48.0, top_row_y()),
        [DesktopWidgetAction::Detail(7)]
    );
}

#[test]
fn hovering_a_clickable_widget_shows_a_faint_frame() {
    let mut hovered = model(Vec::new(), 0, true);
    hovered.hovered = true;
    let mut click_through_hovered = model(Vec::new(), 0, false);
    click_through_hovered.hovered = true;

    assert!(Widget::new().render(&hovered).alpha(WIDTH / 2, 0) > 1);
    assert_eq!(
        Widget::new()
            .render(&click_through_hovered)
            .alpha(WIDTH / 2, 0),
        0
    );
}

#[test]
fn a_new_row_animates_in() {
    let mut widget = Widget::new();
    widget.render(&model(vec![row(1, "Ada", false)], 0, false));

    assert!(widget.host.is_animating());
}

#[test]
fn a_blocked_player_row_reads_in_dark_red() {
    let warning = Widget::new().settled(&model(vec![row(1, "Ghost", true)], 100, false));
    let normal = Widget::new().settled(&model(vec![row(1, "Ghost", false)], 100, false));

    let warning_tint = warning.red_minus_blue_in_top_row();
    let normal_tint = normal.red_minus_blue_in_top_row();
    assert!(
        warning_tint > normal_tint + 1000,
        "warning {warning_tint} normal {normal_tint}"
    );
}

#[test]
fn moving_to_a_screen_with_a_larger_scale_keeps_filling_the_same_window() {
    let mut widget = Widget::new();
    widget.host.set_scale_factor(1.25);

    let frame = widget.render(&model(Vec::new(), 100, false));

    assert_eq!(frame.alpha(WIDTH - 20, HEIGHT - 20), 255);
}

#[test]
fn a_resize_that_arrives_before_the_new_scale_still_fills_the_resized_window() {
    let (width, height) = (WIDTH * 5 / 4, HEIGHT * 5 / 4);
    let mut host = SlintDesktopWidgetHost::new(WIDTH, HEIGHT, 1.0).unwrap();
    let mut out = vec![0; (width * height * 4) as usize];
    host.resize(width, height);
    host.set_scale_factor(1.25);

    host.write_model(&model(Vec::new(), 100, false));
    host.render_bgra(&mut out);

    assert_eq!(
        out[(((height - 20) * width + width - 20) * 4 + 3) as usize],
        255
    );
}

struct Widget {
    host: SlintDesktopWidgetHost,
    out: Vec<u8>,
}

struct Frame(Vec<u8>);

impl Widget {
    fn new() -> Self {
        Self {
            host: SlintDesktopWidgetHost::new(WIDTH, HEIGHT, 1.0).unwrap(),
            out: vec![0; (WIDTH * HEIGHT * 4) as usize],
        }
    }

    fn render(&mut self, model: &DesktopWidgetSurfaceModel) -> Frame {
        self.host.write_model(model);
        self.host.render_bgra(&mut self.out);
        Frame(self.out.clone())
    }

    fn settled(&mut self, model: &DesktopWidgetSurfaceModel) -> Frame {
        self.render(model);
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        while self.host.is_animating() && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(16));
            self.host.render_bgra(&mut self.out);
        }
        Frame(self.out.clone())
    }

    fn press_and_move(&mut self, x: f32, y: f32, distance: f32) -> Vec<DesktopWidgetAction> {
        self.host.take_actions();
        self.host.pointer_moved(x, y);
        self.host.pointer_pressed(x, y);
        self.host.pointer_moved(x + distance, y);
        self.host.take_actions()
    }

    fn click(&mut self, x: f32, y: f32) -> Vec<DesktopWidgetAction> {
        self.host.take_actions();
        self.host.pointer_moved(x, y);
        self.host.pointer_pressed(x, y);
        self.host.pointer_released(x, y);
        self.host.take_actions()
    }
}

impl Frame {
    fn alpha(&self, x: u32, y: u32) -> u8 {
        self.0[((y * WIDTH + x) * 4 + 3) as usize]
    }

    fn max_alpha(&self) -> u8 {
        self.0
            .as_chunks::<4>()
            .0
            .iter()
            .map(|pixel| pixel[3])
            .max()
            .unwrap_or(0)
    }

    fn painted_rows(&self) -> Vec<u32> {
        (0..HEIGHT)
            .filter(|y| (0..WIDTH).any(|x| self.alpha(x, *y) > 1))
            .collect()
    }

    fn avatar_spans(&self) -> Vec<(u32, u32)> {
        let mut spans = Vec::new();
        let mut start = None;
        for y in 0..HEIGHT {
            let covered = (10..26).any(|x| self.alpha(x, y) > 128);
            match (covered, start) {
                (true, None) => start = Some(y),
                (false, Some(top)) => {
                    spans.push((top, y - 1));
                    start = None;
                }
                _ => {}
            }
        }
        if let Some(top) = start {
            spans.push((top, HEIGHT - 1));
        }
        spans
    }

    fn first_text_line_centroid(&self, from: u32) -> f32 {
        let (weighted, total) = (from..HEIGHT)
            .map(|y| {
                let ink: f32 = (33..240)
                    .map(|x| f32::from(self.0[((y * WIDTH + x) * 4 + 2) as usize]))
                    .filter(|red| *red > 120.0)
                    .sum();
                (y, ink)
            })
            .skip_while(|(_, ink)| *ink == 0.0)
            .take_while(|(_, ink)| *ink > 0.0)
            .fold((0.0, 0.0), |(weighted, total), (y, ink)| {
                (weighted + y as f32 * ink, total + ink)
            });
        assert!(total > 0.0, "no text found");
        weighted / total
    }

    fn red_minus_blue_in_top_row(&self) -> i64 {
        (0..32)
            .flat_map(|y| (0..WIDTH).map(move |x| (x, y)))
            .map(|(x, y)| {
                let index = ((y * WIDTH + x) * 4) as usize;
                i64::from(self.0[index + 2]) - i64::from(self.0[index])
            })
            .sum()
    }
}

fn bottom_row_y() -> f32 {
    HEIGHT as f32 - 18.0
}

fn top_row_y() -> f32 {
    18.0
}

fn model(
    rows: Vec<DesktopWidgetRow>,
    background_opacity: u8,
    interactive: bool,
) -> DesktopWidgetSurfaceModel {
    DesktopWidgetSurfaceModel {
        rows,
        background_opacity,
        interactive,
        hovered: false,
        newest_on_top: true,
    }
}

fn row(id: u64, actor: &str, warning: bool) -> DesktopWidgetRow {
    DesktopWidgetRow {
        id,
        time_text: "12:34".to_string(),
        actor: actor.to_string(),
        detail: "has logged in somewhere far away".to_string(),
        favorite: false,
        warning,
        show_avatar_slot: false,
        avatar: None,
    }
}

fn solid_avatar() -> AvatarBitmap {
    let size = 64_u32;
    let rgba = (0..size * size)
        .flat_map(|index| {
            let dx = (index % size) as f32 - 31.5;
            let dy = (index / size) as f32 - 31.5;
            if dx * dx + dy * dy <= 32.0 * 32.0 {
                [200, 180, 230, 255]
            } else {
                [0, 0, 0, 0]
            }
        })
        .collect::<Vec<u8>>();
    AvatarBitmap {
        width: size,
        height: size,
        rgba: std::sync::Arc::from(rgba),
    }
}
