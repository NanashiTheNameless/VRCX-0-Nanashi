use serde_json::{Map, Value};
use vrcx_0_contracts::realtime::{
    AvatarHistoryUpsert, AvatarTimeSpentUpsert, RealtimePersistenceBatch,
};
use vrcx_0_core::derived_keys;

use vrcx_0_application_core::LocalGameContextSnapshot;

use super::state::RealtimeCurrentUserStateSnapshot;
use super::utils::first_positive;
use crate::realtime::event_time::EventTime;

pub(super) fn insert_avatar_swap_time(
    snapshot: &RealtimeCurrentUserStateSnapshot,
    patch: &mut Map<String, Value>,
) {
    patch.insert(
        derived_keys::PREVIOUS_AVATAR_SWAP_TIME.into(),
        snapshot
            .raw
            .get(derived_keys::PREVIOUS_AVATAR_SWAP_TIME)
            .cloned()
            .unwrap_or(Value::Null),
    );
}

pub(super) fn apply_avatar_wear_transition(
    mut next: RealtimeCurrentUserStateSnapshot,
    previous: &RealtimeCurrentUserStateSnapshot,
    game: &LocalGameContextSnapshot,
    now: &EventTime,
    records_current_avatar_history: bool,
) -> (RealtimeCurrentUserStateSnapshot, RealtimePersistenceBatch) {
    let previous_avatar_id = previous.current_avatar.clone();
    let next_avatar_id = next.current_avatar.clone();
    let previous_swap_time = previous.previous_avatar_swap_time;
    let mut persistence = RealtimePersistenceBatch::default();

    if !game.is_available() {
        next.previous_avatar_swap_time = previous_swap_time;
        match previous
            .raw
            .get(derived_keys::PREVIOUS_AVATAR_SWAP_TIME)
            .cloned()
        {
            Some(value) => {
                next.raw
                    .insert(derived_keys::PREVIOUS_AVATAR_SWAP_TIME.into(), value);
            }
            None => {
                next.raw.remove(derived_keys::PREVIOUS_AVATAR_SWAP_TIME);
            }
        }
        return (next, persistence);
    }

    if !game.is_game_running() {
        if !previous_avatar_id.is_empty() && previous_swap_time > 0 {
            persistence
                .avatar_time_spent_upserts
                .push(AvatarTimeSpentUpsert {
                    avatar_id: previous_avatar_id,
                    created_at: now.iso.clone(),
                    time_spent: now.timestamp_ms.saturating_sub(previous_swap_time),
                    started_at_ms: previous_swap_time,
                    ended_at_ms: now.timestamp_ms,
                });
        }
        next.set_previous_avatar_swap_time(None);
        return (next, persistence);
    }
    if next_avatar_id.is_empty() {
        next.set_previous_avatar_swap_time((previous_swap_time > 0).then_some(previous_swap_time));
        return (next, persistence);
    }
    if previous_avatar_id.is_empty() {
        let swap_time = first_positive([next.previous_avatar_swap_time, now.timestamp_ms]);
        next.set_previous_avatar_swap_time(Some(swap_time));
        persistence
            .avatar_history_upserts
            .push(AvatarHistoryUpsert {
                avatar_id: next_avatar_id,
                created_at: now.iso.clone(),
            });
        return (next, persistence);
    }
    if previous_avatar_id != next_avatar_id {
        next.set_previous_avatar_swap_time(Some(now.timestamp_ms));
        persistence
            .avatar_history_upserts
            .push(AvatarHistoryUpsert {
                avatar_id: next_avatar_id,
                created_at: now.iso.clone(),
            });
        if previous_swap_time > 0 {
            persistence
                .avatar_time_spent_upserts
                .push(AvatarTimeSpentUpsert {
                    avatar_id: previous_avatar_id,
                    created_at: now.iso.clone(),
                    time_spent: now.timestamp_ms.saturating_sub(previous_swap_time),
                    started_at_ms: previous_swap_time,
                    ended_at_ms: now.timestamp_ms,
                });
        }
        return (next, persistence);
    }
    let next_swap_time = next.previous_avatar_swap_time;
    if records_current_avatar_history || (previous_swap_time <= 0 && next_swap_time <= 0) {
        persistence
            .avatar_history_upserts
            .push(AvatarHistoryUpsert {
                avatar_id: next_avatar_id,
                created_at: now.iso.clone(),
            });
    }
    next.set_previous_avatar_swap_time(Some(first_positive([
        previous_swap_time,
        next_swap_time,
        now.timestamp_ms,
    ])));
    (next, persistence)
}
