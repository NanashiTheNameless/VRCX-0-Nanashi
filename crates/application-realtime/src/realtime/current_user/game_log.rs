use serde_json::{Map, Value};
use vrcx_0_contracts::game_log::GameLogLocationTimeUpdate;
use vrcx_0_contracts::realtime::RealtimePersistenceBatch;
use vrcx_0_core::derived_keys;
use vrcx_0_core::location::parse_location;
use vrcx_0_core::text::first_owned;

use crate::realtime::RealtimeCurrentUserAuthority;

use super::location::location_game_log_entry;
use super::state::{
    RealtimeCurrentUserState, RealtimeCurrentUserStateSnapshot, RemoteGameLogInterval,
};
use super::utils::EventTime;
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

pub(super) fn game_log_authority_patch(
    authority: &RealtimeCurrentUserAuthority,
) -> Option<Map<String, Value>> {
    if !authority.is_game_running() {
        return None;
    }
    let game_log = authority.game_log()?;
    let game_log_location = game_log.location.trim();
    let game_log_destination = game_log.destination.trim();
    let (location, traveling_to_location) = if game_log_location.eq_ignore_ascii_case("traveling")
        && is_real_instance(game_log_destination)
    {
        ("traveling", game_log_destination)
    } else if is_real_instance(game_log_location) {
        (game_log_location, "")
    } else {
        return None;
    };
    let parsed = parse_location(location);
    let parsed_traveling = parse_location(traveling_to_location);
    let world_id = first_owned([parsed.world_id.clone(), parsed_traveling.world_id.clone()]);
    let mut patch = Map::new();
    patch.insert("location".into(), Value::String(location.to_string()));
    patch.insert("worldId".into(), Value::String(world_id));
    patch.insert(
        "instanceId".into(),
        Value::String(parsed.instance_id.clone()),
    );
    patch.insert(
        "travelingToLocation".into(),
        Value::String(traveling_to_location.to_string()),
    );
    patch.insert(
        "travelingToWorld".into(),
        Value::String(parsed_traveling.world_id.clone()),
    );
    patch.insert(
        "travelingToInstance".into(),
        Value::String(parsed_traveling.instance_id.clone()),
    );
    patch.insert(
        derived_keys::LOCATION_PROJECTION.into(),
        parsed.to_frontend_value(location),
    );
    patch.insert(
        derived_keys::TRAVELING_TO_LOCATION_PROJECTION.into(),
        parsed_traveling.to_frontend_value(traveling_to_location),
    );
    let world_name = game_log.world_name.trim();
    if !world_name.is_empty() {
        patch.insert("worldName".into(), Value::String(world_name.to_string()));
    }
    Some(patch)
}
