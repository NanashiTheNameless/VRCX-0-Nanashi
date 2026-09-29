use serde_json::{json, Map, Value};
use vrcx_0_contracts::game_log::GameLogLocationEntry;
use vrcx_0_core::derived_keys;
use vrcx_0_core::json::text_of;
use vrcx_0_core::location::parse_location;
use vrcx_0_core::text::first_owned;

use super::state::RealtimeCurrentUserStateSnapshot;
use super::utils::{map_from_json, EventTime};
use vrcx_0_core::location::is_real_instance;

pub(super) fn build_location_patch(
    location: Option<&Value>,
    traveling_to_location: Option<&Value>,
    world_id: Option<&Value>,
) -> Map<String, Value> {
    let location = text_of(location);
    let traveling = text_of(traveling_to_location);
    let parsed_location = parse_location(&location);
    let parsed_traveling = parse_location(&traveling);
    let mut patch = Map::new();
    patch.insert("location".into(), Value::String(location.clone()));
    patch.insert(
        "worldId".into(),
        Value::String(first_owned([
            text_of(world_id),
            parsed_location.world_id.clone(),
        ])),
    );
    patch.insert(
        "instanceId".into(),
        Value::String(parsed_location.instance_id.clone()),
    );
    patch.insert(
        "travelingToLocation".into(),
        Value::String(traveling.clone()),
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
        parsed_location.to_frontend_value(&location),
    );
    patch.insert(
        derived_keys::TRAVELING_TO_LOCATION_PROJECTION.into(),
        parsed_traveling.to_frontend_value(&traveling),
    );
    patch
}

pub(super) fn location_game_log_entry(
    snapshot: &RealtimeCurrentUserStateSnapshot,
    now: &EventTime,
) -> Option<GameLogLocationEntry> {
    let location = snapshot.location.clone();
    if !is_real_instance(&location) {
        return None;
    }
    let parsed = parse_location(&location);
    let world_name = snapshot.world_name.trim().to_string();
    Some(GameLogLocationEntry {
        created_at: now.iso.clone(),
        location,
        world_id: parsed.world_id,
        world_name,
        time: 0,
        group_name: parsed.group_id.unwrap_or_default(),
    })
}

pub(super) fn location_game_state_patch(
    snapshot: &RealtimeCurrentUserStateSnapshot,
    now: &EventTime,
) -> Map<String, Value> {
    let location = snapshot.location.clone();
    if !is_real_instance(&location) {
        return map_from_json(json!({
            "currentLocation": "",
            "currentWorldId": "",
            "currentWorldName": "",
            "currentDestination": "",
            "currentLocationStartedAt": null,
            "currentLocationPlayerIds": [],
            "currentLocationPlayers": [],
        }));
    }
    let parsed = parse_location(&location);
    let world_name = snapshot.world_name.trim().to_string();
    map_from_json(json!({
        "currentLocation": location,
        "currentWorldId": parsed.world_id,
        "currentWorldName": world_name,
        "currentDestination": "",
        "currentLocationStartedAt": now.iso,
        "currentLocationPlayerIds": [],
        "currentLocationPlayers": [],
        "lastGameLogAt": now.iso,
        "lastGameLogType": "location",
    }))
}
