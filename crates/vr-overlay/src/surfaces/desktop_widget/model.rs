use crate::{AvatarBitmap, OverlayBadge};

#[derive(Clone, Debug, PartialEq)]
pub struct DesktopWidgetRow {
    pub id: u64,
    pub time_text: String,
    pub actor: String,
    pub detail: String,
    pub favorite: bool,
    pub warning: bool,
    pub show_avatar_slot: bool,
    pub avatar: Option<AvatarBitmap>,
    /// Fork: the actor's user badges.
    pub badges: Vec<OverlayBadge>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DesktopWidgetSurfaceModel {
    pub rows: Vec<DesktopWidgetRow>,
    pub background_opacity: u8,
    pub interactive: bool,
    pub hovered: bool,
    pub newest_on_top: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DesktopWidgetAction {
    Actor(u64),
    Detail(u64),
    Drag,
}
