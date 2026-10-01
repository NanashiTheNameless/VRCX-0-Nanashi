use std::collections::HashMap;
use vrcx_0_core::derived_keys;

use serde_json::Value;
use vrcx_0_core::friends::StateBucket;
use vrcx_0_core::trust::compute_trust_level;

use super::super::{
    json, object_field, object_field_normalized, object_field_string, value_as_i64,
    value_as_string, Map,
};
use super::profile::{
    fallback_friend_user, float_value, get_display_name, get_meaningful_display_name, number_value,
    RemoteFriendProfile,
};

fn normalize_friend_entry(
    friend: Option<Value>,
    state_bucket: StateBucket,
    existing_row: &Value,
) -> Value {
    let user_id = object_field_normalized(existing_row, &["userId", "user_id"]);
    let has_remote_profile = friend.is_some();
    let source = friend.unwrap_or_else(|| fallback_friend_user(&user_id, existing_row));
    let tags = source
        .get("tags")
        .and_then(Value::as_array)
        .map(|tags| tags.iter().map(value_as_string).collect::<Vec<_>>())
        .unwrap_or_default();
    let developer_type = source
        .get("developerType")
        .map(value_as_string)
        .unwrap_or_default();
    let trust = compute_trust_level(&tags, &developer_type);
    let explicit_trust_level = source
        .get(derived_keys::TRUST_LEVEL)
        .or_else(|| source.get("trustLevel"))
        .map(value_as_string)
        .unwrap_or_default();
    let has_trust_metadata = has_remote_profile
        && (!tags.is_empty() || !developer_type.is_empty() || !explicit_trust_level.is_empty());
    let existing_trust_level =
        object_field_string(existing_row, &["trustLevel", derived_keys::TRUST_LEVEL]);
    let trust_level = if !explicit_trust_level.is_empty() {
        explicit_trust_level
    } else if has_trust_metadata {
        trust.trust_level().to_string()
    } else if !existing_trust_level.is_empty() {
        existing_trust_level
    } else {
        trust.trust_level().to_string()
    };
    let friend_number = value_as_i64(
        source
            .get("friendNumber")
            .or_else(|| source.get(derived_keys::FRIEND_NUMBER))
            .or_else(|| object_field(existing_row, "friendNumber"))
            .or_else(|| object_field(existing_row, derived_keys::FRIEND_NUMBER)),
    );
    let source_user_id = source
        .get("id")
        .map(value_as_string)
        .unwrap_or_else(|| user_id.clone());
    let display_name = {
        let meaningful = get_meaningful_display_name(&source, &source_user_id);
        if !meaningful.is_empty() {
            meaningful
        } else {
            let existing_display_name =
                object_field_string(existing_row, &["displayName", "display_name"]);
            if !existing_display_name.is_empty() {
                existing_display_name
            } else {
                let source_display_name = get_display_name(&source);
                if source_display_name.is_empty() {
                    source_user_id.clone()
                } else {
                    source_display_name
                }
            }
        }
    };

    let mut object = match source {
        Value::Object(object) => object,
        _ => Map::new(),
    };
    object.insert("displayName".into(), Value::String(display_name));
    // location never participates in bucketing; the /auth/user list bucket is the only authority.
    object.insert("state".into(), state_bucket.as_str().into());
    object.insert(
        derived_keys::FRIEND_NUMBER.into(),
        number_value(friend_number),
    );
    object.insert(derived_keys::TRUST_LEVEL.into(), Value::String(trust_level));
    object.insert(
        derived_keys::TRUST_CLASS.into(),
        Value::String(trust.trust_class().to_string()),
    );
    object.insert(
        derived_keys::TRUST_SORT_NUM.into(),
        float_value(trust.trust_sort_num()),
    );
    object.insert(
        derived_keys::IS_MODERATOR.into(),
        Value::Bool(trust.is_moderator),
    );
    object.insert(derived_keys::IS_TROLL.into(), Value::Bool(trust.is_troll));
    object.insert(
        derived_keys::IS_PROBABLE_TROLL.into(),
        Value::Bool(trust.is_probable_troll),
    );
    Value::Object(object)
}

pub(super) fn build_fast_roster_records(
    expected_ids: &[String],
    state_by_id: &HashMap<String, StateBucket>,
    mut fetched_friends_by_id: HashMap<String, RemoteFriendProfile>,
) -> Map<String, Value> {
    let friend_order_numbers = expected_ids
        .iter()
        .enumerate()
        .map(|(index, friend_id)| (friend_id.as_str(), (index + 1) as i64))
        .collect::<HashMap<_, _>>();

    let mut friends_by_id = Map::new();
    for friend_id in expected_ids {
        let friend = fetched_friends_by_id
            .remove(friend_id)
            .map(|profile| profile.raw);
        let has_remote_profile = friend.is_some();
        let existing_row = json!({
            "userId": friend_id,
            "displayName": friend.as_ref().map(get_display_name).filter(|name| !name.is_empty()).unwrap_or_else(|| friend_id.clone()),
            "trustLevel": "Visitor",
            "friendNumber": friend_order_numbers.get(friend_id.as_str()).copied().unwrap_or_default()
        });
        let state_bucket = state_by_id
            .get(friend_id)
            .copied()
            .unwrap_or(StateBucket::Offline);
        let mut normalized_friend = normalize_friend_entry(friend, state_bucket, &existing_row);
        if let Some(object) = normalized_friend.as_object_mut() {
            object.insert(
                derived_keys::PROFILE_SOURCE.into(),
                Value::String(if has_remote_profile {
                    "remote".into()
                } else {
                    "placeholder".into()
                }),
            );
        }
        friends_by_id.insert(friend_id.clone(), normalized_friend);
    }

    friends_by_id
}

pub(super) fn infer_state_from_platform(platform: &str) -> StateBucket {
    match platform {
        "" | "offline" => StateBucket::Offline,
        "web" => StateBucket::Active,
        _ => StateBucket::Online,
    }
}
