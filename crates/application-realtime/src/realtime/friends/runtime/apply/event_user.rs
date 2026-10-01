use serde_json::{json, Value};
use vrcx_0_core::derived_keys;
use vrcx_0_core::friends::{FriendRecord, FRIEND_PRESENCE_KEYS};
use vrcx_0_core::trust::compute_trust_level;

use vrcx_0_core::json::{text_of, JsonExt};

pub(super) fn strip_presence_keys(patch: &mut Value) {
    if let Some(patch) = patch.as_object_mut() {
        for key in FRIEND_PRESENCE_KEYS {
            patch.remove(*key);
        }
    }
}

pub(super) fn normalize_patch_trust(patch: &mut Value, previous: Option<&FriendRecord>) {
    let Some(object) = patch.as_object_mut() else {
        return;
    };
    let explicit_trust_level = object.text_field(derived_keys::TRUST_LEVEL);
    let has_trust_metadata = object.contains_key("tags") || object.contains_key("developerType");
    if explicit_trust_level.is_empty() && !has_trust_metadata {
        return;
    }

    let tags = object
        .get("tags")
        .and_then(Value::as_array)
        .or_else(|| previous.and_then(|record| record.extra.get("tags")?.as_array()))
        .map(|values| {
            values
                .iter()
                .map(|value| text_of(Some(value)))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let developer_type = object
        .get("developerType")
        .and_then(Value::as_str)
        .or_else(|| previous.and_then(|record| record.extra.get("developerType")?.as_str()))
        .unwrap_or("");
    let trust = compute_trust_level(&tags, developer_type);
    let trust_level = if has_trust_metadata {
        trust.trust_level().to_string()
    } else {
        explicit_trust_level
    };
    object.insert(derived_keys::TRUST_LEVEL.into(), Value::String(trust_level));
    if has_trust_metadata {
        object.insert(
            derived_keys::TRUST_CLASS.into(),
            Value::String(trust.trust_class().to_string()),
        );
        object.insert(
            derived_keys::TRUST_SORT_NUM.into(),
            json!(trust.trust_sort_num()),
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
    }
}

pub(super) fn event_user_id(content: &Value) -> Option<String> {
    let user_id = content
        .get("userId")
        .and_then(Value::as_str)
        .or_else(|| {
            content
                .get("user")
                .and_then(|user| user.get("id"))
                .and_then(Value::as_str)
        })
        .unwrap_or("")
        .trim()
        .to_string();
    (!user_id.is_empty()).then_some(user_id)
}

pub(super) fn event_user_patch(content: &Value, user_id: &str) -> Value {
    let mut patch = content
        .get("user")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    patch.insert("id".into(), Value::String(user_id.to_string()));
    Value::Object(patch)
}
