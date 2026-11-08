//! Fork: badges the maintainer awards by hand (donators, contributors, bug
//! finders, ...), read from `data/global-badges.jsonc`.
use serde::{Deserialize, Serialize};

/// A kind of global badge. `icon`, `style` and `animation` are names the
/// frontend knows; unknown names fall back to safe defaults there. The
/// `color_*` fields are `#rrggbb` overrides for the style's colours, empty
/// when the style's own colour is used.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(default, rename_all = "camelCase")]
pub struct GlobalBadgeDefinition {
    pub id: String,
    pub label: String,
    pub description: String,
    pub icon: String,
    pub style: String,
    pub animation: String,
    pub color_from: String,
    pub color_to: String,
    pub color_border: String,
    pub color_text: String,
}

/// One person holding one badge. Dates are UTC epoch seconds; `until` is
/// exclusive, and `None` means open-ended. `overrides` changes how the badge
/// looks for this person only; empty fields keep the badge type's values.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(default, rename_all = "camelCase")]
pub struct GlobalBadgeGrant {
    pub user_id: String,
    pub badge: String,
    pub reason: String,
    pub since: Option<i64>,
    pub until: Option<i64>,
    pub overrides: GlobalBadgeOverrides,
}

/// Per-person appearance overrides for an award. Empty means "inherit". For a
/// one-off award (badge [`CUSTOM_AWARD_BADGE`]) they are the whole badge.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(default, rename_all = "camelCase")]
pub struct GlobalBadgeOverrides {
    pub label: String,
    pub description: String,
    pub icon: String,
    pub style: String,
    pub animation: String,
    pub color_from: String,
    pub color_to: String,
    pub color_border: String,
    pub color_text: String,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum GlobalBadgeSource {
    /// The copy built into this release.
    #[default]
    Embedded,
    /// A signed copy downloaded earlier and kept in the data folder.
    Cached,
    /// A signed copy downloaded during this run.
    Downloaded,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(default, rename_all = "camelCase")]
pub struct GlobalBadgeCatalog {
    pub revision: u32,
    pub badges: Vec<GlobalBadgeDefinition>,
    pub awards: Vec<GlobalBadgeGrant>,
    pub source: GlobalBadgeSource,
}

/// The `badge` of a one-off award that has no badge type: the award itself
/// carries the label (required) and the rest of the look. No badge type may
/// use this id.
pub const CUSTOM_AWARD_BADGE: &str = "custom";
