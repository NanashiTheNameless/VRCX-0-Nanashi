use vrcx_0_application_activity::{
    ActivityActorRelation, ActivityCategory, ActivityEntry, ActivityText,
};
use vrcx_0_contracts::activity::ActivityKind;
use vrcx_0_core::text::first_non_empty_owned;
use vrcx_0_i18n::OverlayMessage;
use vrcx_0_vr_overlay::{
    AvatarBitmap, Color, FeedRelation, FeedSeverity, MainSurfaceModel, OverlaySize, ToastCard,
};

use super::super::localization::{OverlayLocale, OverlayLocalizer};

/// Minimum and maximum HMD toast overlay widths.
const MIN_HMD_WIDTH: u32 = 960;
const MAX_HMD_WIDTH: u32 = 1280;
/// Maximum HMD toast overlay height.
const MAX_HMD_HEIGHT: u32 = 528;

#[derive(Clone, Debug)]
pub(crate) struct HmdToastView {
    pub entry: ActivityEntry,
    pub avatar: Option<AvatarBitmap>,
    pub show_avatar: bool,
    pub merge_count: u32,
}

#[derive(Clone, Debug)]
pub(crate) struct MainOverlayFrameInput {
    pub toasts: Vec<HmdToastView>,
    pub locale: OverlayLocale,
    pub show_instance_id_in_location: bool,
    pub compact: bool,
    pub stack_upward: bool,
}

/// Estimate the pixel width of a text string using average character width.
fn estimate_text_width(text: &str, font_size: f32) -> f32 {
    // Average character width is roughly 0.6 * font_size for variable-width fonts
    text.chars().count() as f32 * font_size * 0.6
}

/// Calculate the required HMD overlay width based on toast content.
fn calculate_hmd_width(toasts: &[ToastCard]) -> u32 {
    let mut max_width: f32 = MIN_HMD_WIDTH as f32;

    // Toast card layout: 24px left + (118px avatar or 0) + content + 24px right
    // Avatar area: 20px + 78px + some spacing = ~118px when show_avatar
    const TOAST_BASE_WIDTH: f32 = 24.0 + 24.0; // left + right padding
    const AVATAR_AREA_WIDTH: f32 = 118.0;
    const ACTION_FONT_SIZE: f32 = 20.0;
    const ACTOR_FONT_SIZE: f32 = 28.0;

    for toast in toasts {
        let actor_width = estimate_text_width(&toast.actor_name, ACTOR_FONT_SIZE);
        let action_width = estimate_text_width(&toast.action, ACTION_FONT_SIZE);
        let content_width = actor_width.max(action_width);

        let card_width = TOAST_BASE_WIDTH
            + if toast.show_avatar {
                AVATAR_AREA_WIDTH
            } else {
                0.0
            }
            + content_width;

        // Total panel width = card_width + margins for centering
        let panel_width = card_width + 100.0; // Extra margin
        max_width = max_width.max(panel_width);
    }

    // Clamp to bounds
    max_width.clamp(MIN_HMD_WIDTH as f32, MAX_HMD_WIDTH as f32) as u32
}

pub(crate) fn build_main_surface_model(input: MainOverlayFrameInput) -> MainSurfaceModel {
    let localizer =
        OverlayLocalizer::with_instance_id(input.locale, input.show_instance_id_in_location);
    let toasts: Vec<ToastCard> = input
        .toasts
        .into_iter()
        .map(|toast| toast_card_from_activity(toast, &localizer))
        .collect();
    let calculated_width = calculate_hmd_width(&toasts);
    let safe_height = 528u32.min(MAX_HMD_HEIGHT);
    MainSurfaceModel {
        size: OverlaySize::new(calculated_width, safe_height),
        dark_background: true,
        accent: Color::rgba(94, 234, 212, 255),
        compact: input.compact,
        stack_upward: input.stack_upward,
        toasts,
    }
}

fn toast_card_from_activity(toast: HmdToastView, localizer: &OverlayLocalizer) -> ToastCard {
    let entry = toast.entry;
    ToastCard {
        actor_name: actor_text(&entry, localizer),
        relation: feed_relation(entry.actor_relation),
        action: action_text(&entry, toast.merge_count, localizer),
        severity: feed_severity(&entry),
        avatar: toast.avatar,
        show_avatar: toast.show_avatar,
    }
}

fn actor_text(entry: &ActivityEntry, localizer: &OverlayLocalizer) -> String {
    let localized_title = localized_entry_text(entry, localizer, &entry.content.title);
    let source_title = entry.content.title.source_text();
    first_non_empty_owned([
        localized_title.as_str(),
        source_title.as_str(),
        entry.actor_display_name.as_str(),
    ])
}

fn action_text(entry: &ActivityEntry, merge_count: u32, localizer: &OverlayLocalizer) -> String {
    if merge_count > 1 {
        let others = merge_count - 1;
        let message = match entry.kind {
            ActivityKind::OnPlayerLeft => OverlayMessage::notifications_left_with_others(others),
            _ => OverlayMessage::notifications_joined_with_others(others),
        };
        return localizer.text(&ActivityText::message(message));
    }
    let localized_body = localized_entry_text(entry, localizer, &entry.content.body);
    let source_body = entry.content.body.source_text();
    first_non_empty_owned([
        localized_body.as_str(),
        source_body.as_str(),
        entry.content.summary.as_str(),
        entry.content.detail.as_str(),
        entry.kind.key(),
    ])
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

fn feed_relation(relation: ActivityActorRelation) -> FeedRelation {
    match relation {
        ActivityActorRelation::Favorite => FeedRelation::Favorite,
        ActivityActorRelation::Friend => FeedRelation::Friend,
        ActivityActorRelation::None => FeedRelation::None,
    }
}

fn feed_severity(entry: &ActivityEntry) -> FeedSeverity {
    match entry.category {
        ActivityCategory::ActionRequired => FeedSeverity::Important,
        ActivityCategory::SystemSafety => FeedSeverity::Warning,
        _ => FeedSeverity::Normal,
    }
}
