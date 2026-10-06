use crate::model::{DeviceChip, FeedLine, OverlayFooter, OverlayNowPlaying, OverlaySize};

#[derive(Clone, Debug, PartialEq)]
pub struct WristSurfaceModel {
    pub size: OverlaySize,
    pub dark_background: bool,
    pub show_battery_percent: bool,
    pub devices: Vec<DeviceChip>,
    pub feed_rows: Vec<FeedLine>,
    /// Fork: Players / Notes pages. Every player is listed in full; the panel
    /// grows taller to fit instead of dropping or eliding anyone.
    pub player_columns: Vec<Vec<PlayerCell>>,
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
