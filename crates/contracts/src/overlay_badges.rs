//! Fork: user badges as the app window resolved them, handed to the VR
//! overlay, HMD notifications and the Desktop Overlay, which draw them next
//! to names. Custom badge rules only exist in the app window, so it sends the
//! result rather than the rules. Nothing here leaves the PC.
use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// How one badge looks. `icon` is SVG path data in a 24 by 24 box, drawn as
/// a stroke like Lucide icons. Colors are hex RGB or RGBA. `round` badges are the
/// user's own custom badges; everyone-visible badges are rounded squares.
/// `effects` names the badge's animations: the global badge effects
/// (`shimmer`, `flow`, `sparkle`, `glow`, `embers`, `wiggle`, `flip`) and the
/// developer badges' `glitch` and `upstream-glint`; unknown names are ignored.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(default, rename_all = "camelCase")]
pub struct OverlayBadgeStyle {
    pub icon: String,
    pub color_from: String,
    pub color_to: String,
    pub color_border: String,
    pub color_icon: String,
    pub color_glow: String,
    pub round: bool,
    pub effects: Vec<String>,
}

/// Every badge style in use, and for each user the indexes of their badges
/// in `styles`, in display order. `animations` is off when the user turned
/// on Reduce Effects, and then no badge moves.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(default, rename_all = "camelCase")]
pub struct OverlayUserBadges {
    pub styles: Vec<OverlayBadgeStyle>,
    pub users: HashMap<String, Vec<u32>>,
    pub animations: bool,
}
