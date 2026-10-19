use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct OverlayNowPlaying {
    pub title: String,
    pub artist: String,
    pub time_text: String,
    pub progress_permille: Option<u16>,
}
