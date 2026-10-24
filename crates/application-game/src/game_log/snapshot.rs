use serde::Serialize;

use super::runtime_state::world_id_from_location;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum PlayerListSnapshotSource {
    None,
    Runtime,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PlayerListSnapshotContext {
    pub created_at: i64,
    pub location: String,
    pub world_id: String,
    pub world_name: String,
    pub time: i64,
    pub group_name: String,
    pub source: PlayerListSnapshotSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub player_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub observed_player_event_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub player_facts_known: Option<bool>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PlayerListSnapshotPlayer {
    pub id: String,
    pub user_id: String,
    pub display_name: String,
    pub joined_at: i64,
    pub joined_at_ms: i64,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PlayerListSnapshotOutput {
    pub context: PlayerListSnapshotContext,
    pub players: Vec<PlayerListSnapshotPlayer>,
}

fn empty_context(location: String, source: PlayerListSnapshotSource) -> PlayerListSnapshotContext {
    PlayerListSnapshotContext {
        created_at: 0,
        location,
        world_id: String::new(),
        world_name: String::new(),
        time: 0,
        group_name: String::new(),
        source,
        player_count: None,
        observed_player_event_count: None,
        player_facts_known: None,
    }
}

pub fn player_list_runtime_snapshot(
    snapshot: &super::RuntimeSnapshot,
    requested_location: &str,
) -> PlayerListSnapshotOutput {
    let location_matches =
        if requested_location.is_empty() || requested_location == snapshot.location {
            true
        } else {
            let requested = vrcx_0_core::location::parse_location(requested_location);
            let current = vrcx_0_core::location::parse_location(&snapshot.location);
            !requested.world_id.is_empty()
                && !requested.instance_id.is_empty()
                && requested.world_id == current.world_id
                && requested.instance_id == current.instance_id
        };
    let ready = snapshot.ready && location_matches;
    if !ready {
        let mut context = empty_context(
            requested_location.to_string(),
            PlayerListSnapshotSource::None,
        );
        context.player_facts_known = Some(false);
        return PlayerListSnapshotOutput {
            context,
            players: Vec::new(),
        };
    }
    let mut context = empty_context(snapshot.location.clone(), PlayerListSnapshotSource::Runtime);
    context.created_at = snapshot.started_at;
    context.world_id = world_id_from_location(&snapshot.location);
    context.world_name = snapshot.world_name.clone();
    context.player_facts_known = Some(snapshot.has_player_events);
    let players: Vec<_> = snapshot
        .players
        .iter()
        .map(|player| PlayerListSnapshotPlayer {
            id: super::runtime_state::player_key(&player.user_id, &player.display_name),
            user_id: player.user_id.clone(),
            display_name: player.display_name.clone(),
            joined_at: player
                .join_time_ms
                .map(vrcx_0_core::time::epoch_from_millis)
                .unwrap_or(0),
            joined_at_ms: player.join_time_ms.unwrap_or(0),
        })
        .collect();
    context.player_count = Some(players.len() as i64);
    PlayerListSnapshotOutput { context, players }
}

#[cfg(test)]
mod tests;
