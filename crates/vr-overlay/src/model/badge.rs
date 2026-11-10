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
    pub glow_color: Color,
    pub round: bool,
    pub effects: BadgeEffects,
    pub animations: bool,
}

/// Fork: badge animations, drawn in the overlay the way the app draws them.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct BadgeEffects {
    pub shimmer: bool,
    pub flow: bool,
    pub sparkle: bool,
    pub glow: bool,
    pub embers: bool,
    pub wiggle: bool,
    pub flip: bool,
    /// The fork developer badge's glitch, scan line and breathing rim.
    pub glitch: bool,
    pub upstream_glint: bool,
    pub flip_before_wiggle: bool,
}

impl BadgeEffects {
    pub fn any(self) -> bool {
        self != Self::default()
    }

    /// Effects by name; unknown names are ignored.
    pub fn from_names<'a>(names: impl IntoIterator<Item = &'a str>) -> Self {
        let mut effects = Self::default();
        for name in names {
            match name.trim() {
                "shimmer" => effects.shimmer = true,
                "flow" => effects.flow = true,
                "sparkle" => effects.sparkle = true,
                "glow" => effects.glow = true,
                "embers" => effects.embers = true,
                "wiggle" => {
                    effects.wiggle = true;
                    effects.flip_before_wiggle = effects.flip;
                }
                "flip" => effects.flip = true,
                "glitch" => effects.glitch = true,
                "upstream-glint" => effects.upstream_glint = true,
                _ => {}
            }
        }
        effects
    }
}

/// Most badges drawn after one name; the rest are left out so the name keeps
/// its room.
pub const MAX_OVERLAY_BADGES: usize = 6;
