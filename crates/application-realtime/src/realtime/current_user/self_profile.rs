use serde_json::{Map, Value};
use vrcx_0_contracts::realtime::{
    RealtimePersistenceBatch, SelfProfileField, SelfProfileObservation,
};

use crate::realtime::event_time::EventTime;

pub(super) fn append_self_profile_observations(
    patch: &Map<String, Value>,
    now: &EventTime,
    persistence: &mut RealtimePersistenceBatch,
) {
    for field in [
        SelfProfileField::Status,
        SelfProfileField::StatusDescription,
        SelfProfileField::Bio,
    ] {
        let Some(value) = patch.get(field.as_str()).and_then(Value::as_str) else {
            continue;
        };
        persistence
            .self_profile_observations
            .push(SelfProfileObservation {
                observed_at: now.iso.clone(),
                field,
                value: value.to_string(),
            });
    }
}
