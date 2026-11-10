//! Fork: user badges the app window resolved, for the wrist menu, HMD
//! notifications and the Desktop Overlay. The window resends the whole table
//! whenever it changes; until it does, names show without badges.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use vrcx_0_contracts::overlay_badges::{OverlayBadgeStyle, OverlayUserBadges};
use vrcx_0_vr_overlay::{BadgeEffects, Color, OverlayBadge, MAX_OVERLAY_BADGES};

const MAX_STYLES: usize = 4096;
const MAX_USERS: usize = 50_000;
const MAX_ICON_LEN: usize = 16_384;

static TABLE: RwLock<Option<BadgeTable>> = RwLock::new(None);

struct BadgeTable {
    users: HashMap<String, Arc<[OverlayBadge]>>,
}

/// Replaces the badge table. Malformed styles are dropped, and so are their
/// uses.
pub fn set_overlay_user_badges(input: OverlayUserBadges) {
    let animations = input.animations;
    let styles: Vec<Option<OverlayBadge>> = input
        .styles
        .into_iter()
        .take(MAX_STYLES)
        .map(|style| overlay_badge(style, animations))
        .collect();
    let mut users = HashMap::new();
    for (user_id, indexes) in input.users {
        if users.len() >= MAX_USERS {
            break;
        }
        let user_id = user_id.trim();
        if !user_id.starts_with("usr_") {
            continue;
        }
        let badges: Vec<OverlayBadge> = indexes
            .into_iter()
            .filter_map(|index| styles.get(index as usize).cloned().flatten())
            .take(MAX_OVERLAY_BADGES)
            .collect();
        if !badges.is_empty() {
            users.insert(user_id.to_string(), Arc::from(badges));
        }
    }
    let mut table = TABLE.write().unwrap_or_else(|error| error.into_inner());
    *table = Some(BadgeTable { users });
}

/// The badges to draw after this user's name, in display order.
pub(crate) fn user_badges(user_id: &str) -> Vec<OverlayBadge> {
    let user_id = user_id.trim();
    if user_id.is_empty() {
        return Vec::new();
    }
    TABLE
        .read()
        .unwrap_or_else(|error| error.into_inner())
        .as_ref()
        .and_then(|table| table.users.get(user_id))
        .map(|badges| badges.to_vec())
        .unwrap_or_default()
}

fn overlay_badge(style: OverlayBadgeStyle, animations: bool) -> Option<OverlayBadge> {
    let icon = style.icon.trim();
    if icon.is_empty() || icon.len() > MAX_ICON_LEN || !is_path_data(icon) {
        return None;
    }
    let from = parse_hex_color(&style.color_from)?;
    Some(OverlayBadge {
        icon: Arc::from(icon),
        from,
        to: parse_hex_color(&style.color_to).unwrap_or(from),
        border: parse_hex_color(&style.color_border).unwrap_or(from),
        icon_color: parse_hex_color(&style.color_icon).unwrap_or(Color::rgba(255, 255, 255, 255)),
        glow_color: parse_hex_color(&style.color_glow).unwrap_or(Color { a: 153, ..from }),
        round: style.round,
        effects: BadgeEffects::from_names(style.effects.iter().map(String::as_str)),
        animations,
    })
}

/// SVG path commands, numbers and separators only.
fn is_path_data(value: &str) -> bool {
    value.chars().all(|c| {
        c.is_ascii_digit()
            || matches!(
                c,
                'M' | 'm'
                    | 'L'
                    | 'l'
                    | 'H'
                    | 'h'
                    | 'V'
                    | 'v'
                    | 'C'
                    | 'c'
                    | 'S'
                    | 's'
                    | 'Q'
                    | 'q'
                    | 'T'
                    | 't'
                    | 'A'
                    | 'a'
                    | 'Z'
                    | 'z'
                    | 'e'
                    | 'E'
                    | '.'
                    | ','
                    | '-'
                    | '+'
                    | ' '
            )
    })
}

/// `#rgb`, `#rrggbb` or `#rrggbbaa`.
fn parse_hex_color(value: &str) -> Option<Color> {
    let hex = value.trim().strip_prefix('#')?;
    if !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let channel = |index: usize| u8::from_str_radix(&hex[index..index + 2], 16).ok();
    match hex.len() {
        3 => {
            let digits: Vec<u8> = hex
                .chars()
                .map(|c| c.to_digit(16).map(|d| d as u8 * 17))
                .collect::<Option<_>>()?;
            Some(Color::rgba(digits[0], digits[1], digits[2], 255))
        }
        6 => Some(Color::rgba(channel(0)?, channel(2)?, channel(4)?, 255)),
        8 => Some(Color::rgba(
            channel(0)?,
            channel(2)?,
            channel(4)?,
            channel(6)?,
        )),
        _ => None,
    }
}

#[cfg(test)]
pub(crate) fn reset_overlay_user_badges_for_tests() {
    *TABLE.write().unwrap_or_else(|error| error.into_inner()) = None;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn style(icon: &str, color: &str) -> OverlayBadgeStyle {
        OverlayBadgeStyle {
            icon: icon.to_string(),
            color_from: color.to_string(),
            color_to: String::new(),
            color_border: "#e5202e".to_string(),
            color_icon: "#ffffff".to_string(),
            color_glow: "#e5202e99".to_string(),
            round: false,
            effects: vec!["glow".to_string(), "bogus".to_string()],
        }
    }

    #[test]
    fn parses_hex_colors_and_rejects_anything_else() {
        assert_eq!(
            parse_hex_color("#0b0b0c"),
            Some(Color::rgba(11, 11, 12, 255))
        );
        assert_eq!(
            parse_hex_color("#fff"),
            Some(Color::rgba(255, 255, 255, 255))
        );
        assert_eq!(
            parse_hex_color("#11223344"),
            Some(Color::rgba(17, 34, 51, 68))
        );
        assert_eq!(parse_hex_color("red"), None);
        assert_eq!(parse_hex_color("#12345"), None);
        assert_eq!(parse_hex_color("#ggg"), None);
    }

    #[test]
    fn keeps_valid_badges_in_order_drops_broken_ones_and_caps_each_user() {
        reset_overlay_user_badges_for_tests();
        let mut users = HashMap::new();
        users.insert("usr_a".to_string(), vec![2, 0, 1, 9]);
        users.insert("not-a-user".to_string(), vec![0]);
        users.insert("usr_empty".to_string(), vec![1]);
        set_overlay_user_badges(OverlayUserBadges {
            styles: vec![
                style("M 12 2 L 22 22 Z", "#3b82f6"),
                // Script-like icon text is not path data.
                style("<script>", "#3b82f6"),
                style("M4 4a8 8 0 1 0 16 0", "#0b0b0c"),
            ],
            users,
            animations: true,
        });
        let badges = user_badges("usr_a");
        assert!(badges[0].effects.glow);
        assert!(!badges[0].effects.shimmer);
        assert_eq!(badges.len(), 2);
        assert_eq!(&*badges[0].icon, "M4 4a8 8 0 1 0 16 0");
        assert_eq!(badges[0].to, badges[0].from);
        assert_eq!(&*badges[1].icon, "M 12 2 L 22 22 Z");
        assert!(user_badges("not-a-user").is_empty());
        assert!(user_badges("usr_empty").is_empty());
        assert!(user_badges("usr_missing").is_empty());

        // The table is process-wide, so the cap is checked in the same test.
        let mut users = HashMap::new();
        users.insert("usr_many".to_string(), vec![0; 20]);
        set_overlay_user_badges(OverlayUserBadges {
            styles: vec![style("M 0 0 L 24 24", "#ffffff")],
            users,
            // Reduce Effects: badges stay still.
            animations: false,
        });
        let many = user_badges("usr_many");
        assert_eq!(many.len(), MAX_OVERLAY_BADGES);
        assert!(many[0].effects.glow);
        assert!(!many[0].animations);
        reset_overlay_user_badges_for_tests();
    }
}
