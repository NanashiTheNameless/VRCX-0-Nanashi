use std::sync::Arc;

use super::Color;

/// Fork: a user badge drawn next to a name. `icon` is SVG path data in a 24
/// by 24 box, stroked in `icon_color` over a `from` to `to` gradient.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OverlayBadge {
    pub icon: Arc<str>,
    pub from: Color,
    pub to: Color,
    pub border: Color,
    pub icon_color: Color,
    pub round: bool,
}

/// Most badges drawn after one name; the rest are left out so the name keeps
/// its room.
pub const MAX_OVERLAY_BADGES: usize = 6;
