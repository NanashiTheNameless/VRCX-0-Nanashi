use vrcx_0_core::json::JsonExt;
use vrcx_0_core::presence::{Place, PresencePlace, PresenceView};

use vrcx_0_application_core::LocalGameContextSnapshot;

use super::state::RealtimeCurrentUserState;
use super::utils::has_remote_current_user_presence;

pub(super) fn current_user_presence(
    state: &RealtimeCurrentUserState,
    game: &LocalGameContextSnapshot,
) -> PresenceView {
    let platform = state.snapshot.raw.text_field("last_platform");
    let online = |place: Place| PresenceView::Online {
        place: PresencePlace::new(&place),
        platform: platform.clone(),
        online_since_ms: None,
    };
    if let LocalGameContextSnapshot::Available {
        is_game_running: true,
        location,
        destination,
        ..
    } = game
    {
        return online(Place::from_location(location, destination));
    }
    let remote = &state.remote_snapshot;
    if state.pending_offline.is_some() || has_remote_current_user_presence(remote) {
        return online(Place::from_location(
            &remote.location,
            &remote.traveling_to_location,
        ));
    }
    PresenceView::Active { platform }
}
