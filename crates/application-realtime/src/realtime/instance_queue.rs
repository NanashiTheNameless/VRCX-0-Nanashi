use serde_json::Value;
use vrcx_0_core::realtime::RealtimeWsMessagePayload;

use vrcx_0_core::location::world_id_from_location;

use super::event_kind::RealtimeWsEventKind;
use super::{RealtimeInstanceQueueKind, RealtimeInstanceQueueProjection};
use vrcx_0_core::json::trimmed_text_of as string_field;
use vrcx_0_core::text::first_owned;

pub(crate) fn apply_instance_queue_ws_event(
    generation: u64,
    event_kind: &RealtimeWsEventKind,
    payload: &RealtimeWsMessagePayload,
) -> Option<RealtimeInstanceQueueProjection> {
    let kind = match event_kind {
        RealtimeWsEventKind::InstanceQueueJoined | RealtimeWsEventKind::InstanceQueuePosition => {
            RealtimeInstanceQueueKind::Update
        }
        RealtimeWsEventKind::InstanceQueueReady => RealtimeInstanceQueueKind::Ready,
        RealtimeWsEventKind::InstanceQueueLeft => RealtimeInstanceQueueKind::Left,
        _ => return None,
    };
    let content = payload.json.get("content").unwrap_or(&Value::Null);
    let instance_location = first_owned([
        string_field(content.get("instanceLocation")),
        string_field(content.get("location")),
    ]);
    if instance_location.is_empty() {
        return None;
    }

    Some(RealtimeInstanceQueueProjection {
        generation,
        kind,
        world_id: world_id_from_location(&instance_location),
        instance_location,
        world_name: String::new(),
        position: number_field(content.get("position")),
        queue_size: number_field(content.get("queueSize")),
        received_at: payload.received_at.clone(),
    })
}

fn number_field(value: Option<&Value>) -> i64 {
    let Some(value) = value else {
        return 0;
    };
    if let Some(number) = value.as_i64() {
        return number.max(0);
    }
    if let Some(number) = value.as_u64() {
        return number.min(i64::MAX as u64) as i64;
    }
    if let Some(number) = value.as_f64() {
        if number.is_finite() {
            return number.max(0.0).round() as i64;
        }
    }
    string_field(Some(value))
        .parse::<i64>()
        .map(|number| number.max(0))
        .unwrap_or_default()
}
