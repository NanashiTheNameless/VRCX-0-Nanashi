use std::iter::once_with;
use vrcx_0_core::derived_keys;

use chrono::Utc;
use compact_str::CompactString;
use serde_json::{Map, Value};
use vrcx_0_contracts::feed_live::FeedLiveEntry;
use vrcx_0_contracts::realtime::FriendLogUpsert;
use vrcx_0_core::friends::{FriendRecord, StateBucket};

use crate::realtime::RealtimeFriendOutput;
use vrcx_0_core::location::is_real_instance;

use super::event_patch::record_string;
use super::utils::{first_non_empty, first_owned, parse_location, string_or_previous, JsonExt};

fn feed_duration_ms(duration_ms: i64) -> Option<i64> {
    (duration_ms > 0).then_some(duration_ms)
}

struct ResolvedLocationNames {
    world_name: String,
    group_name: String,
}

#[derive(Clone, Debug)]
pub(super) struct OfflineFeedPrevious {
    display_name: CompactString,
    username: String,
    location: String,
    world_name: String,
    group_name: String,
    location_updated_at: i64,
}

impl OfflineFeedPrevious {
    pub(super) fn from_record(record: &FriendRecord) -> Self {
        Self {
            display_name: record.display_name.clone(),
            username: record.username.clone(),
            location: record.location.clone(),
            world_name: record_string(record, "worldName"),
            group_name: record_string(record, "groupName"),
            location_updated_at: record.extra.i64_field("locationUpdatedAt").unwrap_or(0),
        }
    }

    fn meaningful_name(&self, user_id: &str) -> String {
        vrcx_0_core::friends::meaningful_display_name(&self.display_name, &self.username, user_id)
            .unwrap_or_default()
    }
}

#[derive(Clone, Copy, Debug)]
pub(super) enum FriendRelationshipFeedKind {
    Friend,
    Unfriend,
}

impl FriendRelationshipFeedKind {
    fn feed_entry(
        self,
        created_at: String,
        user_id: String,
        display_name: String,
    ) -> FeedLiveEntry {
        match self {
            Self::Friend => FeedLiveEntry::Friend {
                created_at,
                user_id,
                display_name,
                owner_user_id: String::new(),
            },
            Self::Unfriend => FeedLiveEntry::Unfriend {
                created_at,
                user_id,
                display_name,
                owner_user_id: String::new(),
            },
        }
    }
}

pub(super) fn patch_field_changed(patch: &Value, previous: &FriendRecord, key: &str) -> bool {
    let previous_value = record_string(previous, key);
    match patch.get(key) {
        None => false,
        Some(Value::Null) => !previous_value.is_empty(),
        Some(Value::String(next)) => *next != previous_value,
        Some(_) => true,
    }
}

pub(super) fn friend_log_upsert(
    user_id: &str,
    patch: &Value,
    previous: Option<&FriendRecord>,
    _state_bucket: &str,
    created_at: &str,
) -> FriendLogUpsert {
    FriendLogUpsert {
        target_user_id: user_id.to_string(),
        display_name: display_name(user_id, patch, previous),
        trust_level: first_owned([
            patch.text_field(derived_keys::TRUST_LEVEL),
            previous
                .map(|previous| record_string(previous, derived_keys::TRUST_LEVEL))
                .unwrap_or_default(),
        ]),
        friend_number: patch
            .i64_field(derived_keys::FRIEND_NUMBER)
            .or_else(|| {
                previous.and_then(|previous| previous.extra.i64_field(derived_keys::FRIEND_NUMBER))
            })
            .unwrap_or(0),
        created_at: created_at.to_string(),
        force_history: false,
    }
}

pub(crate) fn trust_level_feed_entry(
    created_at: &str,
    user_id: &str,
    display_name: &str,
    trust_level: &str,
    previous_trust_level: &str,
    friend_number: i64,
) -> FeedLiveEntry {
    FeedLiveEntry::TrustLevel {
        created_at: created_at.to_string(),
        user_id: user_id.to_string(),
        display_name: display_name.to_string(),
        trust_level: trust_level.to_string(),
        previous_trust_level: previous_trust_level.to_string(),
        friend_number,
        owner_user_id: String::new(),
    }
}

pub(super) fn add_profile_diff_feed_entries(
    output: &mut RealtimeFriendOutput,
    user_id: &str,
    patch: &Value,
    previous: Option<&FriendRecord>,
    created_at: &str,
) {
    let Some(previous) = previous.filter(|previous| is_online_state(previous)) else {
        return;
    };
    let status_changed = patch_field_changed(patch, previous, "status");
    let status_description_changed = patch_field_changed(patch, previous, "statusDescription");
    let next_status = string_or_previous(patch, previous, "status");
    if (status_changed || status_description_changed)
        && next_status != "offline"
        && previous.status != "offline"
    {
        output.persistence.feed_entries.push(FeedLiveEntry::Status {
            created_at: created_at.to_string(),
            user_id: user_id.to_string(),
            display_name: display_name(user_id, patch, Some(previous)),
            status: next_status,
            status_description: string_or_previous(patch, previous, "statusDescription"),
            previous_status: previous.status.to_string(),
            previous_status_description: previous.status_description.to_string(),
            owner_user_id: String::new(),
        });
    }
}

pub(super) fn friend_relationship_feed_entry(
    relationship: FriendRelationshipFeedKind,
    user_id: &str,
    patch: &Value,
    previous: Option<&FriendRecord>,
    created_at: &str,
) -> FeedLiveEntry {
    relationship.feed_entry(
        created_at.to_string(),
        user_id.to_string(),
        display_name(user_id, patch, previous),
    )
}

pub(super) fn gps_feed_entry(
    user_id: &str,
    patch: &Value,
    previous: &FriendRecord,
    created_at: &str,
) -> Option<FeedLiveEntry> {
    let previous_location = resolve_gps_previous_location(previous);
    let location = patch.text_field("location");
    if !is_gps_feed_location(&previous_location)
        || !is_gps_feed_location(&location)
        || previous_location == location
    {
        return None;
    }
    let location_names = if is_real_instance(&location) {
        resolve_location_name(&location, patch, Some(previous))
    } else {
        ResolvedLocationNames {
            world_name: String::new(),
            group_name: String::new(),
        }
    };
    Some(FeedLiveEntry::Gps {
        created_at: created_at.to_string(),
        user_id: user_id.to_string(),
        display_name: display_name(user_id, patch, Some(previous)),
        location,
        world_name: location_names.world_name,
        previous_location,
        time: resolve_gps_duration(previous),
        group_name: location_names.group_name,
        world_id: None,
        display_location: None,
        owner_user_id: String::new(),
    })
}

pub(crate) fn player_joining_feed_entry(
    user_id: &str,
    was_traveling: bool,
    current: &FriendRecord,
    created_at: &str,
) -> Option<FeedLiveEntry> {
    if was_traveling
        || !parse_location(&current.location).is_traveling
        || current.traveling_to_location.trim().is_empty()
    {
        return None;
    }
    Some(FeedLiveEntry::OnPlayerJoining {
        created_at: created_at.to_string(),
        user_id: user_id.to_string(),
        display_name: current.display_name.to_string(),
        location: current.location.clone(),
        traveling_to_location: current.traveling_to_location.clone(),
        world_name: None,
        world_id: None,
        display_location: None,
        owner_user_id: String::new(),
    })
}

pub(super) fn online_feed_entry(
    user_id: &str,
    patch: &Value,
    previous: Option<&FriendRecord>,
    location: &str,
    time: i64,
    created_at: &str,
) -> FeedLiveEntry {
    let location_names = if is_real_instance(location) {
        resolve_location_name(location, patch, previous)
    } else {
        ResolvedLocationNames {
            world_name: String::new(),
            group_name: String::new(),
        }
    };
    FeedLiveEntry::Online {
        created_at: created_at.to_string(),
        user_id: user_id.to_string(),
        display_name: display_name(user_id, patch, previous),
        location: location.to_string(),
        world_name: location_names.world_name,
        group_name: location_names.group_name,
        time: feed_duration_ms(time),
        world_id: None,
        display_location: None,
        owner_user_id: String::new(),
    }
}

pub(super) fn offline_feed_entry(
    user_id: &str,
    current: &FriendRecord,
    previous: &OfflineFeedPrevious,
    created_at: &str,
    timestamp_ms: i64,
) -> FeedLiveEntry {
    let location = previous.location.clone();
    let location_names = if is_real_instance(&location) {
        resolve_record_location_name(&location, current, Some(previous))
    } else {
        ResolvedLocationNames {
            world_name: String::new(),
            group_name: String::new(),
        }
    };
    let time = if previous.location_updated_at > 0 {
        timestamp_ms.saturating_sub(previous.location_updated_at)
    } else {
        0
    };
    FeedLiveEntry::Offline {
        created_at: created_at.to_string(),
        user_id: user_id.to_string(),
        display_name: first_owned([
            meaningful_record_name(current, user_id),
            previous.meaningful_name(user_id),
            "Unknown".to_string(),
        ]),
        location,
        world_name: location_names.world_name,
        group_name: location_names.group_name,
        time: feed_duration_ms(time),
        world_id: None,
        display_location: None,
        owner_user_id: String::new(),
    }
}

pub(super) fn add_location_metadata(
    patch: &mut Map<String, Value>,
    previous: Option<&FriendRecord>,
    timestamp_ms: i64,
) {
    let location = patch.text_field("location");
    if location.eq_ignore_ascii_case("traveling") {
        if previous
            .map(|previous| previous.location.eq_ignore_ascii_case("traveling"))
            .unwrap_or(false)
        {
            return;
        }
        let previous_location = previous.map(resolve_previous_location).unwrap_or_default();
        let previous_timestamp = previous
            .and_then(|previous| previous.extra.i64_field("locationUpdatedAt"))
            .unwrap_or(0);
        patch.insert("locationUpdatedAt".into(), Value::from(timestamp_ms));
        patch.insert(
            derived_keys::TRAVELING_TO_TIME.into(),
            Value::from(timestamp_ms),
        );
        patch.insert("travelingToTime".into(), Value::from(timestamp_ms));
        if is_real_instance(&previous_location) {
            patch.insert(
                derived_keys::PREVIOUS_LOCATION.into(),
                Value::String(previous_location),
            );
            patch.insert(
                derived_keys::PREVIOUS_LOCATION_UPDATED_AT.into(),
                Value::from(previous_timestamp),
            );
        }
        return;
    }

    let previous_travel_location = previous
        .map(|previous| record_string(previous, derived_keys::PREVIOUS_LOCATION))
        .unwrap_or_default();
    let previous_location_timestamp = previous
        .and_then(|previous| {
            previous
                .extra
                .i64_field(derived_keys::PREVIOUS_LOCATION_UPDATED_AT)
        })
        .unwrap_or(0);
    let returned_to_previous_location =
        !previous_travel_location.is_empty() && previous_travel_location == location;
    let location_timestamp = if returned_to_previous_location && previous_location_timestamp > 0 {
        previous_location_timestamp
    } else {
        timestamp_ms
    };
    patch.insert("locationUpdatedAt".into(), Value::from(location_timestamp));
    patch.insert(
        derived_keys::PREVIOUS_LOCATION.into(),
        Value::String(String::new()),
    );
    patch.insert(
        derived_keys::PREVIOUS_LOCATION_UPDATED_AT.into(),
        Value::String(String::new()),
    );
    patch.insert(
        derived_keys::TRAVELING_TO_TIME.into(),
        Value::String(String::new()),
    );
    patch.insert("travelingToTime".into(), Value::String(String::new()));
}

pub(super) fn display_name(
    user_id: &str,
    patch: &Value,
    previous: Option<&FriendRecord>,
) -> String {
    first_owned([
        meaningful_name(patch, user_id),
        previous
            .map(|previous| meaningful_record_name(previous, user_id))
            .unwrap_or_default(),
        "Unknown".to_string(),
    ])
}

pub(super) fn meaningful_record_name(record: &FriendRecord, user_id: &str) -> String {
    vrcx_0_core::friends::meaningful_display_name(&record.display_name, &record.username, user_id)
        .unwrap_or_default()
}

pub(super) fn meaningful_name(value: &Value, user_id: &str) -> String {
    vrcx_0_core::friends::meaningful_display_name(
        &value.text_field("displayName"),
        &value.text_field("username"),
        user_id,
    )
    .unwrap_or_default()
}

fn resolve_location_name(
    location: &str,
    patch: &Value,
    previous: Option<&FriendRecord>,
) -> ResolvedLocationNames {
    let parsed = parse_location(location);
    ResolvedLocationNames {
        world_name: first_owned(
            once_with(|| patch.text_field("worldName"))
                .chain(once_with(|| {
                    patch
                        .get("world")
                        .and_then(|world| world.get("name"))
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string()
                }))
                .chain(once_with(|| {
                    previous
                        .map(|previous| record_string(previous, "worldName"))
                        .unwrap_or_default()
                }))
                .chain(once_with(|| parsed.world_id.clone()))
                .chain(once_with(|| location.to_string())),
        ),
        group_name: first_owned(
            once_with(|| patch.text_field("groupName"))
                .chain(once_with(|| {
                    previous
                        .map(|previous| record_string(previous, "groupName"))
                        .unwrap_or_default()
                }))
                .chain(once_with(|| parsed.group_id.clone().unwrap_or_default())),
        ),
    }
}

fn resolve_record_location_name(
    location: &str,
    current: &FriendRecord,
    previous: Option<&OfflineFeedPrevious>,
) -> ResolvedLocationNames {
    let parsed = parse_location(location);
    ResolvedLocationNames {
        world_name: first_owned(
            once_with(|| record_string(current, "worldName"))
                .chain(once_with(|| {
                    current
                        .extra
                        .get("world")
                        .and_then(|world| world.get("name"))
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string()
                }))
                .chain(once_with(|| {
                    previous
                        .map(|previous| previous.world_name.clone())
                        .unwrap_or_default()
                }))
                .chain(once_with(|| parsed.world_id.clone()))
                .chain(once_with(|| location.to_string())),
        ),
        group_name: first_owned(
            once_with(|| record_string(current, "groupName"))
                .chain(once_with(|| {
                    previous
                        .map(|previous| previous.group_name.clone())
                        .unwrap_or_default()
                }))
                .chain(once_with(|| parsed.group_id.unwrap_or_default())),
        ),
    }
}

pub(super) fn resolve_previous_location(previous: &FriendRecord) -> String {
    first_non_empty([
        previous.location.as_str(),
        previous
            .extra
            .get(derived_keys::LOCATION_PROJECTION)
            .and_then(|location| location.get("tag"))
            .and_then(Value::as_str)
            .unwrap_or(""),
    ])
    .to_string()
}

pub(super) fn resolve_gps_previous_location(previous: &FriendRecord) -> String {
    let previous_location = previous.location.clone();
    if previous_location.eq_ignore_ascii_case("traveling") {
        return record_string(previous, derived_keys::PREVIOUS_LOCATION);
    }
    previous_location
}

pub(super) fn resolve_gps_duration(previous: &FriendRecord) -> i64 {
    if previous.location.eq_ignore_ascii_case("traveling") {
        let previous_timestamp = previous
            .extra
            .i64_field(derived_keys::PREVIOUS_LOCATION_UPDATED_AT)
            .unwrap_or(0);
        return if previous_timestamp > 0 {
            Utc::now().timestamp_millis() - previous_timestamp
        } else {
            0
        };
    }
    duration_ms(previous, Utc::now().timestamp_millis())
}

pub(super) fn duration_ms(previous: &FriendRecord, now_ms: i64) -> i64 {
    let timestamp = previous.extra.i64_field("locationUpdatedAt").unwrap_or(0);
    if timestamp > 0 {
        now_ms.saturating_sub(timestamp)
    } else {
        0
    }
}

pub(super) fn is_online_state(record: &FriendRecord) -> bool {
    StateBucket::Online.matches(&record.state)
}

pub(super) fn is_private_location(location: &str) -> bool {
    matches!(
        location.trim().to_ascii_lowercase().as_str(),
        "private" | "private:private"
    )
}

fn is_gps_feed_location(location: &str) -> bool {
    is_real_instance(location) || is_private_location(location)
}
