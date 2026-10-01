use vrcx_0_core::presence::PresenceView;

use super::RealtimeFriendsRuntime;

pub(super) fn friend_view(runtime: &RealtimeFriendsRuntime, user_id: &str) -> PresenceView {
    runtime
        .snapshot()
        .expect("baseline present")
        .presence_by_id
        .remove(user_id)
        .expect("friend presence present")
        .view
}

pub(super) fn location_tag(view: &PresenceView) -> Option<&str> {
    view.place().map(|place| place.location.tag.as_str())
}

pub(super) fn traveling_to_tag(view: &PresenceView) -> Option<&str> {
    view.place()
        .and_then(|place| place.traveling_to.as_ref())
        .map(|destination| destination.tag.as_str())
}

pub(super) fn is_pending_offline(view: &PresenceView) -> bool {
    matches!(view, PresenceView::PendingOffline { .. })
}
