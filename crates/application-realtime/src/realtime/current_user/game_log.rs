use serde_json::{Map, Value};
use vrcx_0_contracts::game_log::GameLogLocationTimeUpdate;
use vrcx_0_contracts::realtime::RealtimePersistenceBatch;
use vrcx_0_core::location::parse_location;

use vrcx_0_application_core::LocalGameContextSnapshot;

use super::location::build_location_patch;
use super::location::location_game_log_entry;
use super::state::{
    RealtimeCurrentUserState, RealtimeCurrentUserStateSnapshot, RemoteGameLogInterval,
};
use crate::realtime::event_time::EventTime;
use vrcx_0_core::location::is_real_instance;

pub(super) fn reconcile_remote_game_log_interval(
    state: &mut RealtimeCurrentUserState,
    snapshot: &RealtimeCurrentUserStateSnapshot,
    now: &EventTime,
    game_log_enabled: bool,
    persistence: &mut RealtimePersistenceBatch,
) {
    let location = snapshot.location.trim();
    if !game_log_enabled || !is_real_instance(location) {
        close_remote_game_log_interval(state, now, persistence);
        return;
    }
    if state
        .remote_game_log_interval
        .as_ref()
        .is_some_and(|interval| interval.location == location)
    {
        return;
    }
    close_remote_game_log_interval(state, now, persistence);
    let Some(entry) = location_game_log_entry(snapshot, now) else {
        return;
    };
    state.remote_game_log_interval = Some(RemoteGameLogInterval {
        created_at: entry.created_at.clone(),
        started_at_ms: now.timestamp_ms,
        location: entry.location.clone(),
    });
    persistence.game_log_locations.push(entry);
}

pub(super) fn close_remote_game_log_interval(
    state: &mut RealtimeCurrentUserState,
    now: &EventTime,
    persistence: &mut RealtimePersistenceBatch,
) {
    let Some(interval) = state.remote_game_log_interval.take() else {
        return;
    };
    persistence
        .game_log_location_time_updates
        .push(GameLogLocationTimeUpdate {
            created_at: interval.created_at,
            time: now.timestamp_ms.saturating_sub(interval.started_at_ms),
        });
}

pub(super) fn local_game_location_patch(
    game: &LocalGameContextSnapshot,
) -> Option<Map<String, Value>> {
    let LocalGameContextSnapshot::Available {
        is_game_running: true,
        location: game_log_location,
        destination: game_log_destination,
        world_name,
        ..
    } = game
    else {
        return None;
    };
    let game_log_location = game_log_location.trim();
    let game_log_destination = game_log_destination.trim();
    let (location, traveling_to_location) = if game_log_location.eq_ignore_ascii_case("traveling")
        && is_real_instance(game_log_destination)
    {
        ("traveling", game_log_destination)
    } else if is_real_instance(game_log_location) {
        (game_log_location, "")
    } else {
        return None;
    };
    let mut patch = build_location_patch(
        Some(&Value::from(location)),
        Some(&Value::from(traveling_to_location)),
        Some(&Value::from(parse_location(traveling_to_location).world_id)),
    );
    let world_name = world_name.trim();
    if !world_name.is_empty() {
        patch.insert("worldName".into(), Value::String(world_name.to_string()));
    }
    Some(patch)
}
