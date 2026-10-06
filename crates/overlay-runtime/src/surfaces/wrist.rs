use chrono::{DateTime, Local, Timelike};
use vrcx_0_application_activity::{
    ActivityActorRelation, ActivityCategory, ActivityEntry, ActivitySnapshot, ActivityText,
};
use vrcx_0_core::location::world_id_from_location;
use vrcx_0_core::text::first_non_empty_owned;
use vrcx_0_host_desktop::vr_overlay::{
    VrDeviceSnapshot, VrDeviceStatus, WristAnchor, WristPlacementAdjust,
};
use vrcx_0_i18n::OverlayMessage;
use vrcx_0_vr_overlay::{
    DeviceChip, DeviceRole, DeviceStatus, FeedAccent, FeedKind, FeedLine, FeedRelation,
    FeedSeverity, OverlayFooter, OverlayNowPlaying, OverlaySize, PlayerCell, WristSurfaceModel,
};

use super::super::localization::{OverlayLocale, OverlayLocalizer, OverlayPanelLocalizer};
use vrcx_0_contracts::activity::ActivityKind;

const MAX_FEED_ROWS: usize = 24;

/// Players / Notes grid: a new column starts every this many players, up to
/// `MAX_PLAYER_COLUMNS`; after that columns grow taller. No one is dropped.
const PLAYERS_PER_COLUMN: usize = 10;
const MAX_PLAYER_COLUMNS: usize = 4;
const PLAYER_COLUMN_WIDTH: u32 = 256;

/// Maximum wrist overlay width (2x normal preset = 1024px).
/// Preset width (compact=448, normal=512, large=640) is used as minimum.
const MAX_WRIST_WIDTH: u32 = 1024;

/// Initial wrist canvas height. The rendered panel resizes to its content: the
/// feed up to twice its width, the Players / Notes grid as tall as needed.
const MAX_WRIST_HEIGHT: u32 = 640;

/// Estimate the pixel width of a text string using average character width.
/// This is a rough approximation since we don't have font metrics in Rust.
fn estimate_text_width(text: &str, font_size: f32) -> f32 {
    // Average character width is roughly 0.6 * font_size for variable-width fonts
    text.chars().count() as f32 * font_size * 0.6
}

/// Calculate the required wrist overlay width based on content.
fn calculate_wrist_width(input: &WristOverlayFrameInput) -> u32 {
    let preset_width = input.options.size.overlay_size().width as f32;
    let mut max_width: f32 = preset_width;

    // Header: device labels + battery percentages
    // Layout: 18px left padding + device labels + 18px right padding
    let mut header_width: f32 = 36.0; // padding
    for device in &input.devices {
        let label_width = estimate_text_width(&device.label, 14.0);
        let percent_width = device
            .battery_percent
            .map_or(0.0, |pct| estimate_text_width(&format!("{}%", pct), 12.0));
        let battery_width = if device.battery_percent.is_some() {
            23.0
        } else {
            0.0
        };
        header_width += label_width + percent_width + battery_width + 10.0; // spacing
    }
    max_width = max_width.max(header_width);

    // Feed lines: time (42px) + actor + detail
    // Layout: 14px left + 42px time + 8px spacing + actor + 5px spacing + detail + 14px right
    const FEED_BASE_WIDTH: f32 = 14.0 + 42.0 + 8.0 + 5.0 + 14.0; // ~83px base
    for entry in &input.activity.entries {
        let actor = entry.actor_display_name.trim();
        let detail = entry.content.detail.trim();
        let actor_width = if !actor.is_empty() {
            estimate_text_width(actor, 16.0)
        } else {
            0.0
        };
        let detail_width = estimate_text_width(detail, 16.0);
        let line_width = FEED_BASE_WIDTH + actor_width + detail_width;
        max_width = max_width.max(line_width);
    }

    // Now playing title
    if let Some(np) = &input.now_playing {
        let title = np.title.trim();
        if !title.is_empty() {
            // 18px left + title + 18px right + ellipsis space
            let title_width = estimate_text_width(title, 14.0) + 36.0 + 30.0;
            max_width = max_width.max(title_width);
        }
    }

    // Footer: player_count + instance_duration + local_time (computed same as build_wrist_surface_model)
    let footer_left = match input.page {
        WristPage::Feed => format!("{} players", input.footer.player_count),
        WristPage::Players => format!("Players ({})", input.players.len()),
        WristPage::Notes => format!(
            "Notes ({})",
            input
                .players
                .iter()
                .filter(|p| !p.note.trim().is_empty())
                .count()
        ),
    };
    let footer_center = input.footer.instance_duration.clone();
    let footer_right = input.footer.local_time.clone();
    let footer_width = 36.0
        + estimate_text_width(&footer_left, 12.0)
        + 60.0 // center space
        + estimate_text_width(&footer_center, 12.0)
        + 60.0 // center space
        + estimate_text_width(&footer_right, 12.0);
    max_width = max_width.max(footer_width);

    // Clamp to bounds (preset width as minimum, MAX_WRIST_WIDTH as maximum)
    max_width.clamp(preset_width, MAX_WRIST_WIDTH as f32) as u32
}

#[derive(
    Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type,
)]
#[serde(rename_all = "camelCase")]
pub enum WristOverlaySizePreset {
    Compact,
    #[default]
    Normal,
    Large,
}

impl WristOverlaySizePreset {
    pub fn from_config(value: &str) -> Self {
        match value.trim() {
            "compact" => Self::Compact,
            "large" => Self::Large,
            _ => Self::Normal,
        }
    }

    pub fn as_config(self) -> &'static str {
        match self {
            Self::Compact => "compact",
            Self::Normal => "normal",
            Self::Large => "large",
        }
    }

    pub fn overlay_size(self) -> OverlaySize {
        match self {
            Self::Compact => OverlaySize::new(448, 448),
            Self::Normal => OverlaySize::new(512, 512),
            Self::Large => OverlaySize::new(640, 640),
        }
    }

    pub fn physical_width_meters(self) -> f32 {
        match self {
            Self::Compact => 0.32,
            Self::Normal => 0.40,
            Self::Large => 0.48,
        }
    }
}

/// Fork: wrist menu placement from Settings > VR, in whole centimeters and
/// degrees so the runtime config stays comparable.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WristPlacement {
    pub width_cm: u8,
    pub anchor: WristAnchor,
    pub side_cm: i8,
    pub up_cm: i8,
    pub out_cm: i8,
    pub tilt_degrees: i8,
}

impl WristPlacement {
    pub const MIN_WIDTH_CM: u8 = 10;
    pub const MAX_WIDTH_CM: u8 = 80;
    pub const MAX_OFFSET_CM: i8 = 50;
    pub const MAX_TILT_DEGREES: i8 = 90;

    pub fn for_size(size: WristOverlaySizePreset) -> Self {
        Self {
            width_cm: (size.physical_width_meters() * 100.0).round() as u8,
            anchor: WristAnchor::Bottom,
            side_cm: 0,
            up_cm: 0,
            out_cm: 0,
            tilt_degrees: 0,
        }
    }

    pub fn physical_width_meters(self) -> f32 {
        f32::from(self.width_cm) / 100.0
    }

    pub fn adjust(self) -> WristPlacementAdjust {
        WristPlacementAdjust {
            anchor: self.anchor,
            side_meters: f32::from(self.side_cm) / 100.0,
            up_meters: f32::from(self.up_cm) / 100.0,
            out_meters: f32::from(self.out_cm) / 100.0,
            tilt_degrees: f32::from(self.tilt_degrees),
        }
    }
}

impl Default for WristPlacement {
    fn default() -> Self {
        Self::for_size(WristOverlaySizePreset::Normal)
    }
}

pub fn wrist_anchor_from_config(value: &str) -> WristAnchor {
    match value.trim() {
        "center" => WristAnchor::Center,
        "top" => WristAnchor::Top,
        _ => WristAnchor::Bottom,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WristOverlayRenderOptions {
    pub size: WristOverlaySizePreset,
    pub hide_private_worlds: bool,
    pub dark_background: bool,
    pub show_devices: bool,
    pub show_battery_percent: bool,
}

impl Default for WristOverlayRenderOptions {
    fn default() -> Self {
        Self {
            size: WristOverlaySizePreset::Normal,
            hide_private_worlds: false,
            dark_background: true,
            show_devices: true,
            show_battery_percent: false,
        }
    }
}

/// Fork: wrist overlay pages, cycled by showing the wrist again shortly after hiding it.
#[derive(
    Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type,
)]
#[serde(rename_all = "camelCase")]
pub enum WristPage {
    #[default]
    Feed,
    /// Everyone in the instance, with their local note when there is one.
    Players,
    /// Only players in the instance that have a local note.
    Notes,
}

impl WristPage {
    pub const ALL: [Self; 3] = [Self::Feed, Self::Players, Self::Notes];

    pub fn as_config(self) -> &'static str {
        match self {
            Self::Feed => "feed",
            Self::Players => "players",
            Self::Notes => "notes",
        }
    }

    pub fn from_config(value: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|page| page.as_config() == value.trim())
    }
}

/// Fork: which wrist pages are shown and in what order (Settings > VR). Stored as
/// a comma list such as "feed,players,notes"; never empty (falls back to Feed).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WristPageOrder {
    pages: [WristPage; 3],
    len: usize,
}

impl Default for WristPageOrder {
    fn default() -> Self {
        Self {
            pages: WristPage::ALL,
            len: WristPage::ALL.len(),
        }
    }
}

impl WristPageOrder {
    pub const DEFAULT_CONFIG: &'static str = "feed,players,notes";

    pub fn from_config(value: &str) -> Self {
        let mut pages = [WristPage::Feed; 3];
        let mut len = 0;
        for page in value.split(',').filter_map(WristPage::from_config) {
            if !pages[..len].contains(&page) {
                pages[len] = page;
                len += 1;
            }
        }
        if len == 0 {
            len = 1;
        }
        Self { pages, len }
    }

    pub fn pages(&self) -> &[WristPage] {
        &self.pages[..self.len]
    }

    pub fn first(&self) -> WristPage {
        self.pages[0]
    }

    /// The page after `page`, wrapping; the first page when `page` is not shown.
    pub fn next_after(&self, page: WristPage) -> WristPage {
        let pages = self.pages();
        pages
            .iter()
            .position(|candidate| *candidate == page)
            .map(|index| pages[(index + 1) % pages.len()])
            .unwrap_or_else(|| self.first())
    }

    /// `page` if it is still shown, otherwise the first shown page.
    pub fn normalize(&self, page: WristPage) -> WristPage {
        if self.pages().contains(&page) {
            page
        } else {
            self.first()
        }
    }
}

/// Fork: order of rows on the Players / Notes pages.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum WristPlayersSort {
    #[default]
    Name,
    /// Most recent join first.
    Joined,
}

impl WristPlayersSort {
    pub fn from_config(value: &str) -> Self {
        match value.trim() {
            "joined" => Self::Joined,
            _ => Self::Name,
        }
    }
}

/// Fork: a player in the current instance for the Players / Notes pages.
#[derive(
    Clone, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type,
)]
#[serde(rename_all = "camelCase")]
pub struct WristPlayerRow {
    pub display_name: String,
    pub note: String,
    pub joined_text: String,
    pub is_friend: bool,
    /// Presence state: "online", "offline", "busy", etc.
    pub state: String,
    /// Platform: "standalonewindows" (PC VR), "android" (Quest), "windows" (Desktop)
    pub platform: String,
    /// Status description (e.g., "In VRChat", "In a private world")
    pub status_description: String,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WristOverlayFrameInput {
    pub activity: ActivitySnapshot,
    pub devices: Vec<VrDeviceSnapshot>,
    pub now_playing: Option<WristRuntimeNowPlaying>,
    pub live_now_playing: bool,
    pub footer: WristRuntimeFooter,
    pub options: WristOverlayRenderOptions,
    pub locale: String,
    pub show_instance_id_in_location: bool,
    pub captured_at_ms: i64,
    #[serde(default)]
    pub page: WristPage,
    #[serde(default)]
    pub players: Vec<WristPlayerRow>,
}

#[derive(
    Clone, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type,
)]
#[serde(rename_all = "camelCase")]
pub struct WristRuntimeFooter {
    pub player_count: u32,
    pub instance_duration: String,
    pub local_time: String,
}

#[derive(
    Clone, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type,
)]
#[serde(rename_all = "camelCase")]
pub struct WristRuntimeNowPlaying {
    pub title: String,
    pub length_seconds: i64,
    pub position_seconds: i64,
    pub started_at: String,
}

const HIDDEN_NOW_PLAYING_STEP_SECONDS: i64 = 60;

fn now_playing_model(
    input: &WristRuntimeNowPlaying,
    captured_at_ms: i64,
    live: bool,
) -> Option<OverlayNowPlaying> {
    let title = input.title.trim();
    if title.is_empty() {
        return None;
    }
    let started_at_ms = DateTime::parse_from_rfc3339(input.started_at.trim())
        .ok()
        .map(|value| value.timestamp_millis());
    let elapsed_seconds = input.position_seconds.max(0)
        + started_at_ms.map_or(0, |started_at_ms| {
            (captured_at_ms - started_at_ms).max(0) / 1000
        });
    let elapsed_seconds = if live {
        elapsed_seconds
    } else {
        elapsed_seconds - elapsed_seconds % HIDDEN_NOW_PLAYING_STEP_SECONDS
    };
    let (time_text, progress_permille) = if input.length_seconds > 0 {
        let elapsed_seconds = elapsed_seconds.min(input.length_seconds);
        (
            format!(
                "{} / {}",
                clock_duration(elapsed_seconds),
                clock_duration(input.length_seconds)
            ),
            Some((elapsed_seconds * 1000 / input.length_seconds) as u16),
        )
    } else {
        (clock_duration(elapsed_seconds), None)
    };
    Some(OverlayNowPlaying {
        title: title.to_string(),
        time_text,
        progress_permille,
    })
}

fn clock_duration(total_seconds: i64) -> String {
    let hours = total_seconds / 3600;
    let minutes = total_seconds % 3600 / 60;
    let seconds = total_seconds % 60;
    if hours > 0 {
        format!("{hours}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes}:{seconds:02}")
    }
}

pub(crate) fn compact_duration(duration_ms: i64) -> String {
    let total_minutes = duration_ms / 60_000;
    if total_minutes < 1 {
        return "<1m".to_string();
    }
    let total_hours = total_minutes / 60;
    let minutes = total_minutes % 60;
    if total_hours < 1 {
        return format!("{minutes}m");
    }
    if total_hours < 24 {
        return format!("{total_hours}h {minutes}m");
    }
    let days = total_hours / 24;
    let hours = total_hours % 24;
    format!("{days}d {hours}h")
}

pub fn build_wrist_surface_model(input: WristOverlayFrameInput) -> WristSurfaceModel {
    let localizer = OverlayLocalizer::with_instance_id(
        OverlayLocale::from_config(&input.locale),
        input.show_instance_id_in_location,
    );
    let feed_rows = match input.page {
        WristPage::Feed => input
            .activity
            .entries
            .iter()
            .rev()
            .filter(|entry| !should_hide_private_world(entry, input.options.hide_private_worlds))
            .take(MAX_FEED_ROWS)
            .map(|entry| feed_line_from_activity(entry, &localizer))
            .collect(),
        WristPage::Players | WristPage::Notes => Vec::new(),
    };
    let player_cells = match input.page {
        WristPage::Feed => Vec::new(),
        WristPage::Players => player_cells(&input.players, false),
        WristPage::Notes => player_cells(&input.players, true),
    };
    let feed_rows = if input.page != WristPage::Feed && player_cells.is_empty() {
        vec![empty_players_line(input.page == WristPage::Notes)]
    } else {
        feed_rows
    };
    let player_columns = player_columns(player_cells);
    let footer_left = match input.page {
        WristPage::Feed => localizer.text(&ActivityText::message(
            OverlayMessage::overlay_footer_players(input.footer.player_count),
        )),
        WristPage::Players => format!("Players ({})", input.players.len()),
        WristPage::Notes => format!(
            "Notes ({})",
            input
                .players
                .iter()
                .filter(|p| !p.note.trim().is_empty())
                .count()
        ),
    };
    let calculated_width = calculate_wrist_width(&input)
        .max(player_grid_width(player_columns.len()))
        .min(MAX_WRIST_WIDTH);
    let preset_height = input.options.size.overlay_size().height;
    let safe_height = preset_height.min(MAX_WRIST_HEIGHT);
    WristSurfaceModel {
        size: OverlaySize::new(calculated_width, safe_height),
        dark_background: input.options.dark_background,
        show_battery_percent: input.options.show_battery_percent,
        devices: if input.options.show_devices {
            input
                .devices
                .into_iter()
                .map(device_chip_from_snapshot)
                .collect()
        } else {
            Vec::new()
        },
        feed_rows,
        player_columns,
        now_playing: input.now_playing.as_ref().and_then(|now_playing| {
            now_playing_model(now_playing, input.captured_at_ms, input.live_now_playing)
        }),
        footer: OverlayFooter {
            left: footer_left,
            center: localized_instance_duration(&localizer, &input.footer.instance_duration),
            right: input.footer.local_time,
        },
    }
}

/// Every player for the Players / Notes pages, with all of their details
/// (English-only fork; no localization keys).
fn player_cells(players: &[WristPlayerRow], notes_only: bool) -> Vec<PlayerCell> {
    players
        .iter()
        .filter(|player| !notes_only || !player.note.trim().is_empty())
        .map(|player| {
            let mut status_parts = Vec::new();
            if player.is_friend {
                if !player.state.is_empty() {
                    status_parts.push(player.state.clone());
                }
                if !player.platform.is_empty() {
                    let platform_label = match player.platform.as_str() {
                        "standalonewindows" => "PC VR",
                        "android" => "Quest",
                        "windows" => "Desktop",
                        _ => &player.platform,
                    };
                    status_parts.push(platform_label.to_string());
                }
                if !player.status_description.is_empty() {
                    status_parts.push(player.status_description.clone());
                }
            }
            PlayerCell {
                name: player.display_name.clone(),
                joined: player.joined_text.clone(),
                status: status_parts.join(" / "),
                note: player.note.trim().to_string(),
                is_friend: player.is_friend,
            }
        })
        .collect()
}

fn player_columns(cells: Vec<PlayerCell>) -> Vec<Vec<PlayerCell>> {
    if cells.is_empty() {
        return Vec::new();
    }
    let columns = cells
        .len()
        .div_ceil(PLAYERS_PER_COLUMN)
        .clamp(1, MAX_PLAYER_COLUMNS);
    let per_column = cells.len().div_ceil(columns);
    cells.chunks(per_column).map(<[_]>::to_vec).collect()
}

fn player_grid_width(columns: usize) -> u32 {
    if columns <= 1 {
        return 0;
    }
    columns as u32 * PLAYER_COLUMN_WIDTH
}

fn empty_players_line(notes_only: bool) -> FeedLine {
    FeedLine {
        time_text: String::new(),
        kind: FeedKind::System,
        actor_text: String::new(),
        detail: if notes_only {
            "No one here has a note."
        } else {
            "No players in this instance yet."
        }
        .to_string(),
        relation: FeedRelation::None,
        severity: FeedSeverity::Normal,
        accent: FeedAccent::None,
    }
}

fn localized_instance_duration(localizer: &OverlayLocalizer, duration: &str) -> String {
    let duration = duration.trim();
    if duration.is_empty() {
        return String::new();
    }
    localizer.text(&ActivityText::message(
        OverlayMessage::overlay_footer_instance_duration(duration),
    ))
}

fn device_chip_from_snapshot(snapshot: VrDeviceSnapshot) -> DeviceChip {
    let status = match snapshot.status {
        VrDeviceStatus::Normal => DeviceStatus::Normal,
        VrDeviceStatus::LowBattery => DeviceStatus::LowBattery,
        VrDeviceStatus::CriticalBattery => DeviceStatus::CriticalBattery,
        VrDeviceStatus::Charging => DeviceStatus::Charging,
        VrDeviceStatus::TrackingWarning => DeviceStatus::TrackingWarning,
        VrDeviceStatus::Disconnected => DeviceStatus::Disconnected,
    };
    let text = match (snapshot.battery_percent, snapshot.status) {
        (Some(percent), VrDeviceStatus::LowBattery) => format!("{percent} low"),
        (Some(percent), VrDeviceStatus::CriticalBattery) => format!("{percent} crit"),
        (Some(percent), VrDeviceStatus::Charging) => format!("{percent} chg"),
        (Some(percent), VrDeviceStatus::TrackingWarning) => format!("{percent} warn"),
        (Some(percent), VrDeviceStatus::Disconnected) => format!("{percent} off"),
        (Some(percent), VrDeviceStatus::Normal) => percent.to_string(),
        (None, VrDeviceStatus::TrackingWarning) => "warn".to_string(),
        (None, VrDeviceStatus::Disconnected) => "off".to_string(),
        (None, VrDeviceStatus::Charging) => "chg".to_string(),
        (None, _) => String::new(),
    };
    let priority = match snapshot.status {
        VrDeviceStatus::CriticalBattery | VrDeviceStatus::Disconnected => 40,
        VrDeviceStatus::LowBattery | VrDeviceStatus::TrackingWarning => 30,
        VrDeviceStatus::Charging => 20,
        VrDeviceStatus::Normal => 10,
    };
    DeviceChip {
        role: device_role(&snapshot.label),
        label: snapshot.label,
        status,
        battery_percent: snapshot.battery_percent,
        text,
        priority,
    }
}

fn device_role(label: &str) -> DeviceRole {
    match label.trim() {
        "HMD" => DeviceRole::Hmd,
        "L" => DeviceRole::LeftController,
        "R" => DeviceRole::RightController,
        value if value.starts_with('T') && value[1..].parse::<u32>().is_ok() => DeviceRole::Tracker,
        _ => DeviceRole::Other,
    }
}

fn feed_line_from_activity(entry: &ActivityEntry, localizer: &OverlayLocalizer) -> FeedLine {
    FeedLine {
        time_text: time_text(&entry.created_at),
        kind: feed_kind(entry),
        actor_text: feed_actor(entry, localizer),
        detail: feed_detail(entry, localizer),
        relation: feed_relation(entry.actor_relation),
        severity: feed_severity(entry),
        accent: feed_accent(entry),
    }
}

fn feed_actor(entry: &ActivityEntry, localizer: &OverlayLocalizer) -> String {
    let localized_title = localized_entry_text(entry, localizer, &entry.content.title);
    let source_title = entry.content.title.source_text();
    first_non_empty_owned([
        localized_title.as_str(),
        source_title.as_str(),
        entry.actor_display_name.as_str(),
    ])
}

fn feed_relation(relation: ActivityActorRelation) -> FeedRelation {
    match relation {
        ActivityActorRelation::Favorite => FeedRelation::Favorite,
        ActivityActorRelation::Friend => FeedRelation::Friend,
        ActivityActorRelation::None => FeedRelation::None,
    }
}

fn feed_detail(entry: &ActivityEntry, localizer: &OverlayLocalizer) -> String {
    let localized_summary = localized_activity_summary(entry, localizer);
    let localized_body = localized_entry_text(entry, localizer, &entry.content.body);
    let localized_title = localized_entry_text(entry, localizer, &entry.content.title);
    let summary = entry.content.summary.trim();
    let detail = entry.content.detail.trim();
    let source_body = entry.content.body.source_text();
    let source_title = entry.content.title.source_text();
    let body = source_body.trim();
    let title = source_title.trim();
    let actor = entry.actor_display_name.trim();
    let world_name = meaningful_world_name(entry);

    if let Some(world_name) = world_name {
        for value in [
            localized_summary.as_str(),
            detail,
            localized_body.as_str(),
            summary,
            body,
        ] {
            let replaced = replace_location_ids(value, entry, world_name);
            if !replaced.trim().is_empty() {
                return replaced;
            }
        }
    }

    let candidate = first_non_empty_owned([
        localized_summary.as_str(),
        detail,
        localized_body.as_str(),
        summary,
        body,
        localized_title.as_str(),
        title,
        actor,
    ]);
    if contains_location_id(&candidate) {
        location_id_free_detail(entry, localized_title.as_str(), title, actor, localizer)
    } else {
        candidate
    }
}

fn localized_activity_summary(entry: &ActivityEntry, localizer: &OverlayLocalizer) -> String {
    let title = localized_entry_text(entry, localizer, &entry.content.title);
    let body = localized_entry_text(entry, localizer, &entry.content.body);
    if !body.trim().is_empty() {
        return join_non_empty([title.as_str(), body.as_str()]);
    }
    if entry.content.title.as_message().is_some() {
        return title;
    }
    String::new()
}

fn localized_entry_text(
    entry: &ActivityEntry,
    localizer: &OverlayLocalizer,
    text: &ActivityText,
) -> String {
    localizer.activity_text(
        text,
        &entry.content.location,
        &entry.content.world_name,
        &entry.content.group_name,
    )
}

fn meaningful_world_name(entry: &ActivityEntry) -> Option<&str> {
    let world_name = entry.content.world_name.trim();
    if world_name.is_empty() || is_location_id_like(world_name) {
        None
    } else {
        Some(world_name)
    }
}

fn replace_location_ids(value: &str, entry: &ActivityEntry, world_name: &str) -> String {
    let mut output = value.trim().to_string();
    let location_world_id = world_id_from_location(entry.content.location.trim());
    for location in [
        entry.content.world_name.trim(),
        entry.content.location.trim(),
        location_world_id.as_str(),
    ] {
        if is_location_id_like(location) {
            output = output.replace(location, world_name);
        }
    }
    output
}

fn location_id_free_detail(
    entry: &ActivityEntry,
    localized_title: &str,
    fallback_title: &str,
    actor: &str,
    localizer: &OverlayLocalizer,
) -> String {
    let subject = first_non_empty_owned([localized_title, fallback_title, actor]);
    match entry.kind {
        ActivityKind::Gps if !subject.is_empty() => {
            let action = localizer.text(&ActivityText::message(OverlayMessage::notifications_gps(
                localizer.generic_instance_location(),
            )));
            join_non_empty([subject.as_str(), action.as_str()])
        }
        ActivityKind::Online if !subject.is_empty() => {
            let action = localizer.text(&ActivityText::message(
                OverlayMessage::notifications_online(),
            ));
            join_non_empty([subject.as_str(), action.as_str()])
        }
        ActivityKind::Invite if !subject.is_empty() => {
            let action = localizer.text(&ActivityText::message(
                OverlayMessage::notifications_invite(localizer.generic_instance_location(), ""),
            ));
            join_non_empty([subject.as_str(), action.as_str()])
        }
        _ => subject,
    }
}

pub fn should_hide_private_world(entry: &ActivityEntry, enabled: bool) -> bool {
    if !enabled || !is_private_filtered_activity_type(entry.kind) {
        return false;
    }
    let has_visible_location =
        !entry.content.location.trim().is_empty() || !entry.content.world_name.trim().is_empty();
    has_visible_location && is_private_location(&entry.content.location)
}

fn is_private_filtered_activity_type(kind: ActivityKind) -> bool {
    matches!(
        kind,
        ActivityKind::Gps | ActivityKind::Online | ActivityKind::Invite
    )
}

fn is_private_location(location: &str) -> bool {
    let normalized = location.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }
    if normalized == "private" || normalized == "private:private" {
        return true;
    }
    normalized.contains("~private(")
        || normalized.contains("~hidden(")
        || normalized.contains("~friends(")
        || normalized.contains("~group(")
}

fn contains_location_id(value: &str) -> bool {
    value
        .split_whitespace()
        .any(|part| is_location_id_like(part.trim_matches(|ch: char| ch.is_ascii_punctuation())))
}

fn is_location_id_like(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed == "private" || trimmed == "private:private" {
        return true;
    }
    trimmed.starts_with("wrld_")
}

fn feed_kind(entry: &ActivityEntry) -> FeedKind {
    match entry.category {
        ActivityCategory::ActionRequired => FeedKind::Invite,
        ActivityCategory::CurrentInstance => FeedKind::Instance,
        ActivityCategory::FavoriteMovement => FeedKind::Friend,
        ActivityCategory::ProfileChange => FeedKind::Profile,
        ActivityCategory::GroupSocial => FeedKind::Group,
        ActivityCategory::SystemSafety => FeedKind::System,
        ActivityCategory::Media => FeedKind::Media,
    }
}

fn feed_severity(entry: &ActivityEntry) -> FeedSeverity {
    match entry.category {
        ActivityCategory::ActionRequired => FeedSeverity::Important,
        ActivityCategory::SystemSafety => FeedSeverity::Warning,
        _ => FeedSeverity::Normal,
    }
}

fn feed_accent(entry: &ActivityEntry) -> FeedAccent {
    match entry.kind {
        ActivityKind::Online => FeedAccent::Online,
        ActivityKind::Gps => FeedAccent::Location,
        ActivityKind::Offline => FeedAccent::Offline,
        ActivityKind::Status | ActivityKind::AvatarChange | ActivityKind::Bio => FeedAccent::Muted,
        _ => FeedAccent::None,
    }
}

fn time_text(value: &str) -> String {
    time_text_in_timezone(value, &Local).unwrap_or_else(|| raw_time_text(value))
}

fn time_text_in_timezone<Tz>(value: &str, timezone: &Tz) -> Option<String>
where
    Tz: chrono::TimeZone,
{
    let local_time = DateTime::parse_from_rfc3339(value)
        .ok()?
        .with_timezone(timezone);
    Some(format!(
        "{:02}:{:02}",
        local_time.hour(),
        local_time.minute()
    ))
}

fn raw_time_text(value: &str) -> String {
    let Some(time_start) = value.find('T').map(|index| index + 1) else {
        return String::new();
    };
    value
        .get(time_start..time_start + 5)
        .unwrap_or_default()
        .to_string()
}

fn join_non_empty<'a, I>(values: I) -> String
where
    I: IntoIterator<Item = &'a str>,
{
    values
        .into_iter()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod page_tests {
    use super::*;

    fn player(name: &str, note: &str) -> WristPlayerRow {
        WristPlayerRow {
            display_name: name.into(),
            note: note.into(),
            joined_text: "5m".into(),
            is_friend: false,
            state: String::new(),
            platform: String::new(),
            status_description: String::new(),
        }
    }

    #[test]
    fn pages_cycle_feed_players_notes_by_default() {
        let order = WristPageOrder::from_config(WristPageOrder::DEFAULT_CONFIG);
        assert_eq!(order, WristPageOrder::default());
        assert_eq!(order.next_after(WristPage::Feed), WristPage::Players);
        assert_eq!(order.next_after(WristPage::Players), WristPage::Notes);
        assert_eq!(order.next_after(WristPage::Notes), WristPage::Feed);
    }

    #[test]
    fn page_order_is_customizable_deduplicated_and_never_empty() {
        let order = WristPageOrder::from_config("notes, feed,notes,bogus");
        assert_eq!(order.pages(), &[WristPage::Notes, WristPage::Feed]);
        assert_eq!(order.next_after(WristPage::Feed), WristPage::Notes);
        assert_eq!(order.next_after(WristPage::Players), WristPage::Notes);
        assert_eq!(order.normalize(WristPage::Players), WristPage::Notes);
        let single = WristPageOrder::from_config("players");
        assert_eq!(single.next_after(WristPage::Players), WristPage::Players);
        assert_eq!(WristPageOrder::from_config("").pages(), &[WristPage::Feed]);
    }

    #[test]
    fn notes_page_lists_only_players_with_notes() {
        let players = vec![player("Ada", "met at the club"), player("Bob", "  ")];
        let all = player_cells(&players, false);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].name, "Ada");
        assert_eq!(all[0].note, "met at the club");
        let notes = player_cells(&players, true);
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].name, "Ada");
        assert!(player_cells(&[player("Bob", "")], true).is_empty());
        assert_eq!(empty_players_line(true).detail, "No one here has a note.");
    }

    #[test]
    fn player_grid_keeps_every_player_and_their_details() {
        let players = (0..80)
            .map(|index| WristPlayerRow {
                display_name: format!("Player {index}"),
                note: format!("note {index}"),
                joined_text: "5m".to_string(),
                is_friend: true,
                state: "active".to_string(),
                platform: "android".to_string(),
                status_description: "chilling".to_string(),
            })
            .collect::<Vec<_>>();
        let columns = player_columns(player_cells(&players, false));
        assert_eq!(columns.len(), MAX_PLAYER_COLUMNS);
        let cells = columns.concat();
        assert_eq!(cells.len(), 80);
        assert_eq!(cells[79].name, "Player 79");
        assert_eq!(cells[79].note, "note 79");
        assert_eq!(cells[79].status, "active / Quest / chilling");
        assert_eq!(cells[79].joined, "5m");
        assert_eq!(player_columns(player_cells(&players[..7], false)).len(), 1);
        assert_eq!(player_columns(player_cells(&players[..11], false)).len(), 2);
    }
}

#[cfg(test)]
mod tests {
    use vrcx_0_application_activity::{
        ActivityActorRelation, ActivityCategory, ActivityContent, ActivityEntry, ActivityText,
    };

    use super::*;

    #[test]
    fn hide_private_worlds_only_filters_location_bearing_gps_online_and_invites() {
        assert!(should_hide_private_world(
            &entry("GPS", "private", "Private World"),
            true
        ));
        assert!(should_hide_private_world(
            &entry("Online", "wrld_1:123~friends(usr_1)", "Friends World"),
            true
        ));
        assert!(should_hide_private_world(
            &entry("invite", "wrld_1:123~group(grp_1)", "Group World"),
            true
        ));
        assert!(!should_hide_private_world(
            &entry(
                "OnPlayerJoined",
                "wrld_1:123~friends(usr_1)",
                "Friends World"
            ),
            true
        ));
        assert!(!should_hide_private_world(
            &entry("VideoPlay", "private", "Private World"),
            true
        ));
        assert!(!should_hide_private_world(
            &entry("Online", "public", "Public World"),
            true
        ));
        assert!(!should_hide_private_world(
            &entry("invite", "private", "Private World"),
            false
        ));
    }

    #[test]
    fn feed_detail_replaces_world_id_with_meaningful_world_name() {
        let mut entry = entry("Online", "wrld_1:123", "Test World");
        entry.content.title = ActivityText::literal("Ada");
        entry.content.summary = "Ada online in wrld_1".to_string();

        assert_eq!(feed_line(&entry, "en").detail, "Ada online in Test World");
    }

    #[test]
    fn feed_time_uses_target_timezone_instead_of_raw_utc_text() {
        let daylight_offset = chrono::FixedOffset::west_opt(4 * 60 * 60).unwrap();

        assert_eq!(
            time_text_in_timezone("2026-06-01T12:34:56.000Z", &daylight_offset),
            Some("08:34".to_string())
        );
    }

    #[test]
    fn feed_time_falls_back_to_raw_iso_time_for_invalid_timestamps() {
        assert_eq!(time_text("not-a-dateT12:34:56"), "12:34");
    }

    #[test]
    fn feed_detail_does_not_render_raw_world_id_when_world_name_is_unknown() {
        let mut entry = entry("Online", "wrld_1:123", "wrld_1");
        entry.actor_display_name = "Ada".to_string();
        entry.content.title = ActivityText::literal("Ada");
        entry.content.summary = "Ada online in wrld_1".to_string();

        assert_eq!(feed_line(&entry, "en").detail, "Ada has logged in");
    }

    #[test]
    fn feed_detail_uses_runtime_locale_for_notification_body() {
        let mut entry = entry("OnPlayerJoined", "", "");
        entry.category = ActivityCategory::CurrentInstance;
        entry.content.title = ActivityText::literal("Ada");
        entry.content.body = ActivityText::message(OverlayMessage::notifications_has_joined());

        assert_eq!(feed_line(&entry, "en").detail, "Ada has joined");
    }

    #[test]
    fn feed_detail_replaces_world_id_after_localization() {
        let mut entry = entry("Online", "wrld_1:123", "Test World");
        entry.content.title = ActivityText::literal("Ada");
        entry.content.body =
            ActivityText::message(OverlayMessage::notifications_online_location("wrld_1"));

        assert_eq!(
            feed_line(&entry, "en").detail,
            "Ada has logged in to Test World"
        );
    }

    #[test]
    fn feed_detail_uses_localized_generic_location_when_world_name_is_unknown() {
        let mut entry = entry("GPS", "wrld_1:123", "wrld_1");
        entry.content.title = ActivityText::literal("Ada");
        entry.content.body = ActivityText::message(OverlayMessage::notifications_gps("wrld_1"));

        assert_eq!(feed_line(&entry, "en").detail, "Ada is in an instance");
    }

    #[test]
    fn feed_detail_localizes_display_location_access_labels() {
        let mut entry = entry(
            "GPS",
            "wrld_1:123~group(grp_a)~groupAccessType(plus)",
            "Group World",
        );
        entry.content.group_name = "Group Name".to_string();
        entry.content.title = ActivityText::literal("Ada");
        entry.content.body = ActivityText::message(OverlayMessage::notifications_gps(
            "Group World groupPlus(Group Name)",
        ));

        assert_eq!(
            feed_line(&entry, "en").detail,
            "Ada is in Group World Group+(Group Name)"
        );
    }

    #[test]
    fn feed_detail_appends_instance_id_when_enabled() {
        let mut entry = entry("GPS", "wrld_1:12345~region(use)", "Test World");
        entry.content.title = ActivityText::literal("Ada");
        entry.content.body = ActivityText::message(OverlayMessage::notifications_gps("Test World"));

        assert_eq!(
            feed_line_with_instance_id(&entry, "en", true).detail,
            "Ada is in Test World Public #12345"
        );
        assert_eq!(
            feed_line_with_instance_id(&entry, "en", false).detail,
            "Ada is in Test World Public"
        );
    }

    fn entry(activity_type: &str, location: &str, world_name: &str) -> ActivityEntry {
        ActivityEntry {
            sequence: 1,
            source_id: format!("source:{activity_type}"),
            kind: ActivityKind::from_key(activity_type).expect("known activity kind"),
            category: ActivityCategory::FavoriteMovement,
            created_at: "2026-06-01T12:34:56.000Z".to_string(),
            actor_user_id: "usr_1".to_string(),
            actor_display_name: "User".to_string(),
            content: ActivityContent {
                location: location.to_string(),
                world_name: world_name.to_string(),
                title: text(),
                body: text(),
                ..ActivityContent::default()
            },
            actor_relation: ActivityActorRelation::None,
        }
    }

    fn text() -> ActivityText {
        ActivityText::default()
    }

    fn feed_line(entry: &ActivityEntry, locale: &str) -> FeedLine {
        let localizer = OverlayLocalizer::new(OverlayLocale::from_config(locale));
        feed_line_from_activity(entry, &localizer)
    }

    fn feed_line_with_instance_id(
        entry: &ActivityEntry,
        locale: &str,
        show_instance_id: bool,
    ) -> FeedLine {
        let localizer = OverlayLocalizer::with_instance_id(
            OverlayLocale::from_config(locale),
            show_instance_id,
        );
        feed_line_from_activity(entry, &localizer)
    }
}
