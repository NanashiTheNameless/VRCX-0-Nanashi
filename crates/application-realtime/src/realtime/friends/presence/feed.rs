use serde_json::Value;
use vrcx_0_contracts::feed_live::FeedLiveEntry;
use vrcx_0_core::friends::{meaningful_display_name, FriendRecord};
use vrcx_0_core::location::parse_location;
use vrcx_0_core::presence::Place;

use super::model::{OnlineState, Phase};

pub(crate) fn presence_feed(
    user_id: &str,
    record: &FriendRecord,
    prev: &Phase,
    next: &Phase,
    now_ms: i64,
    created_at: &str,
) -> Vec<FeedLiveEntry> {
    let names = FeedNames::new(user_id, record, created_at);
    let mut entries = Vec::new();
    match (prev.online_state(), next) {
        (None, Phase::Online(state)) => {
            entries.push(names.online(state.place.tag()));
        }
        (Some(held), Phase::Offline { .. } | Phase::Active { .. }) => {
            entries.push(names.offline(held, now_ms));
        }
        (Some(before), Phase::Online(after)) => {
            entries.extend(names.gps(before, after, now_ms));
        }
        _ => {}
    }
    entries
}

pub(crate) fn joining_feed(
    user_id: &str,
    record: &FriendRecord,
    prev: &Phase,
    next: &Phase,
    created_at: &str,
) -> Option<FeedLiveEntry> {
    let Phase::Online(after) = next else {
        return None;
    };
    FeedNames::new(user_id, record, created_at).joining(prev.online_state(), after)
}

struct FeedNames<'a> {
    user_id: &'a str,
    record: &'a FriendRecord,
    display_name: String,
    created_at: &'a str,
}

impl<'a> FeedNames<'a> {
    fn new(user_id: &'a str, record: &'a FriendRecord, created_at: &'a str) -> Self {
        let display_name = meaningful_display_name(&record.display_name, &record.username, user_id)
            .unwrap_or_else(|| "Unknown".to_string());
        Self {
            user_id,
            record,
            display_name,
            created_at,
        }
    }

    fn location_names(&self, location: &str) -> (String, String) {
        let parsed = parse_location(location);
        if !parsed.is_real_instance {
            return (String::new(), String::new());
        }
        let extra = |key: &str| {
            self.record
                .extra
                .get(key)
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        };
        (
            extra("worldName").unwrap_or(parsed.world_id),
            extra("groupName").unwrap_or_else(|| parsed.group_id.unwrap_or_default()),
        )
    }

    fn online(&self, location: &str) -> FeedLiveEntry {
        let (world_name, group_name) = self.location_names(location);
        FeedLiveEntry::Online {
            created_at: self.created_at.to_string(),
            user_id: self.user_id.to_string(),
            display_name: self.display_name.clone(),
            location: location.to_string(),
            world_name,
            group_name,
            time: None,
            world_id: None,
            display_location: None,
            owner_user_id: String::new(),
        }
    }

    fn offline(&self, held: &OnlineState, now_ms: i64) -> FeedLiveEntry {
        let location = held.place.tag().to_string();
        let (world_name, group_name) = self.location_names(&location);
        FeedLiveEntry::Offline {
            created_at: self.created_at.to_string(),
            user_id: self.user_id.to_string(),
            display_name: self.display_name.clone(),
            location,
            world_name,
            group_name,
            time: duration(now_ms, held.since_ms),
            world_id: None,
            display_location: None,
            owner_user_id: String::new(),
        }
    }

    fn gps(&self, before: &OnlineState, after: &OnlineState, now_ms: i64) -> Option<FeedLiveEntry> {
        let (previous, since_ms, left_ms) = match (&before.place, &before.travel_from) {
            (Place::Traveling { .. }, Some(stay)) => (
                Place::Instance(stay.tag.clone()),
                stay.since_ms,
                before.since_ms,
            ),
            (place, _) => (place.clone(), before.since_ms, now_ms),
        };
        if !previous.is_gps_endpoint()
            || !after.place.is_gps_endpoint()
            || previous.tag() == after.place.tag()
        {
            return None;
        }
        let location = after.place.tag().to_string();
        let (world_name, group_name) = self.location_names(&location);
        Some(FeedLiveEntry::Gps {
            created_at: self.created_at.to_string(),
            user_id: self.user_id.to_string(),
            display_name: self.display_name.clone(),
            location,
            world_name,
            previous_location: previous.tag().to_string(),
            time: duration(left_ms, since_ms).unwrap_or(0),
            group_name,
            world_id: None,
            display_location: None,
            owner_user_id: String::new(),
        })
    }

    fn joining(&self, before: Option<&OnlineState>, after: &OnlineState) -> Option<FeedLiveEntry> {
        let was_traveling =
            before.is_some_and(|state| matches!(state.place, Place::Traveling { .. }));
        let to = after.place.traveling_to().filter(|_| !was_traveling)?;
        Some(FeedLiveEntry::OnPlayerJoining {
            created_at: self.created_at.to_string(),
            user_id: self.user_id.to_string(),
            display_name: self.display_name.clone(),
            location: after.place.tag().to_string(),
            traveling_to_location: to.to_string(),
            world_name: None,
            world_id: None,
            display_location: None,
            owner_user_id: String::new(),
        })
    }
}

fn duration(now_ms: i64, since_ms: i64) -> Option<i64> {
    let duration = now_ms - since_ms;
    (since_ms > 0 && duration > 0).then_some(duration)
}
