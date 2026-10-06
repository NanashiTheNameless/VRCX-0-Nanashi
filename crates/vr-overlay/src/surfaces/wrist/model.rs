use crate::model::{DeviceChip, FeedLine, OverlayFooter, OverlayNowPlaying, OverlaySize};

#[derive(Clone, Debug, PartialEq)]
pub struct WristSurfaceModel {
    /// Width of the canvas and the tallest the panel may grow; the rendered
    /// frame is only as tall as its content needs.
    pub size: OverlaySize,
    pub dark_background: bool,
    pub show_battery_percent: bool,
    pub devices: Vec<DeviceChip>,
    pub feed_rows: Vec<FeedLine>,
    /// Fork: Players / Notes pages. Every player is listed in full; the
    /// renderer adds columns, then shrinks the grid text, to fit the height.
    pub players: Vec<PlayerCell>,
    /// Fork: text size per area, in percent of the default.
    pub text: WristTextScale,
    pub now_playing: Option<OverlayNowPlaying>,
    pub footer: OverlayFooter,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PlayerCell {
    pub name: String,
    pub joined: String,
    pub status: String,
    pub note: String,
    pub is_friend: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WristTextScale {
    pub header_percent: u8,
    pub footer_percent: u8,
    pub content_percent: u8,
}

impl Default for WristTextScale {
    fn default() -> Self {
        Self {
            header_percent: 100,
            footer_percent: 100,
            content_percent: 100,
        }
    }
}
