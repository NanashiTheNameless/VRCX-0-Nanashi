use crate::derived_keys;
use std::collections::HashMap;

use serde_json::{Map, Number, Value};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct UserFact {
    pub fields: Map<String, Value>,
    field_ranks: HashMap<&'static str, u8>,
    pub updated_at: String,
}

impl UserFact {
    pub fn id(&self) -> &str {
        self.fields.get("id").and_then(Value::as_str).unwrap_or("")
    }

    pub fn endpoint(&self) -> &str {
        self.fields
            .get("endpoint")
            .and_then(Value::as_str)
            .unwrap_or("")
    }

    pub fn to_object(&self) -> Map<String, Value> {
        let mut object = self.fields.clone();
        apply_derived_fields(&mut object);
        object.insert("updatedAt".into(), Value::String(self.updated_at.clone()));
        object
    }
}

fn insert_derived_trust_fields(object: &mut Map<String, Value>) {
    let tags = object
        .get("tags")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let developer_type = object
        .get("developerType")
        .and_then(Value::as_str)
        .unwrap_or("");
    let trust = crate::trust::compute_trust_level(&tags, developer_type);
    let platform = object.get("platform").and_then(Value::as_str).unwrap_or("");
    let last_platform = object
        .get("last_platform")
        .and_then(Value::as_str)
        .unwrap_or("");
    let effective_platform = crate::trust::compute_user_platform(platform, last_platform);

    object.insert(
        derived_keys::TRUST_LEVEL.into(),
        Value::String(trust.trust_level().to_string()),
    );
    object.insert(
        derived_keys::TRUST_CLASS.into(),
        Value::String(trust.trust_class().to_string()),
    );
    object.insert(
        derived_keys::TRUST_SORT_NUM.into(),
        Number::from_f64(trust.trust_sort_num())
            .map(Value::Number)
            .unwrap_or(Value::Null),
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
    object.insert(
        derived_keys::PLATFORM.into(),
        Value::String(effective_platform),
    );
}

fn insert_derived_location_fields(object: &mut Map<String, Value>) {
    for (source, derived) in [
        ("location", derived_keys::LOCATION_PROJECTION),
        (
            "travelingToLocation",
            derived_keys::TRAVELING_TO_LOCATION_PROJECTION,
        ),
    ] {
        let Some(tag) = object.get(source).and_then(Value::as_str) else {
            continue;
        };
        let value = crate::location::parse_location(tag).to_frontend_value(tag);
        object.insert(derived.into(), value);
    }
}

pub fn apply_derived_fields(object: &mut Map<String, Value>) {
    insert_derived_trust_fields(object);
    insert_derived_location_fields(object);
}

#[derive(Clone, Debug)]
pub struct UserFactMergeOptions {
    pub endpoint: String,
    pub source: String,
    pub received_at: String,
    pub is_current_user: bool,
    pub is_friend: bool,
}

impl Default for UserFactMergeOptions {
    fn default() -> Self {
        Self {
            endpoint: String::new(),
            source: "seed".into(),
            received_at: String::new(),
            is_current_user: false,
            is_friend: false,
        }
    }
}

pub struct UserFactMergeResult {
    pub fact: UserFact,
    pub changed: bool,
}

fn base_source_rank(source: &str) -> u8 {
    match source {
        "seed" => 10,
        "instance" => 20,
        "playerSnapshot" => 35,
        "friend" => 50,
        "profile" => 70,
        "realtime" => 75,
        "currentUser" => 85,
        "gameRuntime" => 90,
        _ => 0,
    }
}

fn profile_source_rank(source: &str) -> u8 {
    match source {
        "seed" => 10,
        "instance" => 20,
        "playerSnapshot" => 30,
        "realtime" => 40,
        "friend" => 55,
        "profile" => 80,
        "currentUser" => 90,
        "gameRuntime" => 50,
        _ => 0,
    }
}

fn presence_source_rank(source: &str) -> u8 {
    match source {
        "seed" => 10,
        "instance" => 45,
        "playerSnapshot" => 60,
        "profile" => 40,
        "currentUser" => 65,
        "friend" => 70,
        "realtime" => 80,
        "gameRuntime" => 90,
        _ => 0,
    }
}

#[derive(Clone, Copy)]
enum FieldClass {
    Identity,
    Presence,
    Profile,
    SelfOwned,
}

const USER_FACT_FIELDS: &[(&str, FieldClass)] = &[
    ("id", FieldClass::Identity),
    ("username", FieldClass::Profile),
    ("displayName", FieldClass::Profile),
    ("iconUrl", FieldClass::Profile),
    ("currentAvatar", FieldClass::Profile),
    ("currentAvatarImageUrl", FieldClass::Profile),
    ("currentAvatarThumbnailImageUrl", FieldClass::Profile),
    ("currentAvatarName", FieldClass::Profile),
    ("friendNumber", FieldClass::Profile),
    ("tags", FieldClass::Profile),
    ("platform", FieldClass::Profile),
    ("last_platform", FieldClass::Profile),
    ("developerType", FieldClass::Profile),
    ("status", FieldClass::Presence),
    ("statusDescription", FieldClass::Presence),
    ("state", FieldClass::Presence),
    ("location", FieldClass::Presence),
    ("travelingToLocation", FieldClass::Presence),
    ("locationAt", FieldClass::Presence),
    ("travelingToTime", FieldClass::Presence),
    ("pendingOffline", FieldClass::Presence),
    ("isBoopingEnabled", FieldClass::SelfOwned),
    ("hasSharedConnectionsOptOut", FieldClass::SelfOwned),
];

fn user_fact_field(field: &str) -> Option<(&'static str, FieldClass)> {
    USER_FACT_FIELDS
        .iter()
        .find(|(name, _)| *name == field)
        .copied()
}

fn rank_for_field(class: FieldClass, source: &str) -> u8 {
    match class {
        FieldClass::Presence => presence_source_rank(source),
        FieldClass::Profile => profile_source_rank(source),
        FieldClass::SelfOwned if source == "currentUser" || source == "gameRuntime" => 95,
        FieldClass::Identity | FieldClass::SelfOwned => base_source_rank(source),
    }
}

fn resolve_field(raw: &str) -> Option<&'static str> {
    match raw {
        "display_name" | "name" => Some("displayName"),
        "user_id" | "userId" => Some("id"),
        derived_keys::TRAVELING_TO_LOCATION_PROJECTION => Some("travelingToLocation"),
        "location_at"
        | derived_keys::LOCATION_UPDATED_AT
        | "joinedAt"
        | "joined_at"
        | derived_keys::ONLINE_FOR => Some("locationAt"),
        derived_keys::TRAVELING_TO_TIME => Some("travelingToTime"),
        derived_keys::FRIEND_NUMBER => Some("friendNumber"),
        other => user_fact_field(other).map(|(name, _)| name),
    }
}

pub fn normalize_fact_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.trim().to_string(),
        Value::Null => String::new(),
        other => other.to_string().trim().to_string(),
    }
}

pub fn normalize_user_id(value: &Value) -> String {
    normalize_fact_text(value)
}

pub fn normalize_endpoint(value: &Value) -> String {
    let text = normalize_fact_text(value);
    if text.is_empty() {
        "default".to_string()
    } else {
        text
    }
}

pub fn user_fact_key(endpoint: &Value, user_id: &Value) -> String {
    let normalized_user_id = normalize_user_id(user_id);
    if normalized_user_id.is_empty() {
        String::new()
    } else {
        format!("{}::{}", normalize_endpoint(endpoint), normalized_user_id)
    }
}

pub fn normalize_state_bucket(value: &Value) -> String {
    crate::friends::StateBucket::normalize(&normalize_fact_text(value))
        .map(|bucket| bucket.as_str().to_string())
        .unwrap_or_default()
}

fn is_present(value: &Value) -> bool {
    if value.is_null() {
        return false;
    }
    if let Some(text) = value.as_str() {
        return !text.is_empty();
    }
    true
}

fn normalize_fact_patch(input: &Value) -> Map<String, Value> {
    let mut patch = Map::new();
    let Some(object) = input.as_object() else {
        return patch;
    };
    for (raw_key, value) in object {
        let Some(key) = resolve_field(raw_key) else {
            continue;
        };
        match key {
            "id" => {
                let id = normalize_user_id(value);
                if !id.is_empty() {
                    patch.insert("id".into(), Value::String(id));
                }
            }
            "friendNumber" => {
                let parsed = value.as_i64().or_else(|| {
                    value
                        .as_str()
                        .and_then(|text| text.trim().parse::<i64>().ok())
                });
                if let Some(friend_number) = parsed {
                    if friend_number > 0 {
                        patch.insert("friendNumber".into(), Value::from(friend_number));
                    }
                }
            }
            "tags" => {
                if value.is_array() {
                    patch.insert("tags".into(), value.clone());
                }
            }
            other => {
                if is_present(value) {
                    patch.insert(other.to_string(), value.clone());
                }
            }
        }
    }
    patch
}

#[cfg(test)]
pub fn merge_user_fact(
    existing: Option<&UserFact>,
    input: &Value,
    options: &UserFactMergeOptions,
) -> UserFactMergeResult {
    merge_user_fact_owned(existing.cloned(), input, options)
}

pub fn merge_user_fact_owned(
    existing: Option<UserFact>,
    input: &Value,
    options: &UserFactMergeOptions,
) -> UserFactMergeResult {
    let patch = normalize_fact_patch(input);
    let had_existing = existing.is_some();

    let id = {
        let from_patch = patch.get("id").map(normalize_user_id).unwrap_or_default();
        if from_patch.is_empty() {
            existing
                .as_ref()
                .map(|fact| fact.id().to_string())
                .unwrap_or_default()
        } else {
            from_patch
        }
    };
    let endpoint = {
        let candidate = if options.endpoint.is_empty() {
            existing
                .as_ref()
                .map(|fact| fact.endpoint().to_string())
                .unwrap_or_default()
        } else {
            options.endpoint.clone()
        };
        normalize_endpoint(&Value::String(candidate))
    };
    let updated_at = {
        let received = normalize_fact_text(&Value::String(options.received_at.clone()));
        if received.is_empty() {
            chrono::Utc::now().to_rfc3339()
        } else {
            received
        }
    };

    let mut fact = match existing {
        Some(existing) => existing,
        None => UserFact {
            fields: {
                let mut fields = Map::new();
                fields.insert("id".into(), Value::String(id.clone()));
                fields.insert("endpoint".into(), Value::String(endpoint.clone()));
                fields
            },
            field_ranks: HashMap::new(),
            updated_at: updated_at.clone(),
        },
    };
    let mut changed = !had_existing;

    if !id.is_empty() && fact.id() != id {
        fact.fields.insert("id".into(), Value::String(id));
        changed = true;
    }
    if !endpoint.is_empty() && fact.endpoint() != endpoint {
        fact.fields
            .insert("endpoint".into(), Value::String(endpoint));
        changed = true;
    }
    if options.is_current_user
        && fact.fields.get("isCurrentUser").and_then(Value::as_bool) != Some(true)
    {
        fact.fields
            .insert("isCurrentUser".into(), Value::Bool(true));
        changed = true;
    }
    if options.is_friend && fact.fields.get("isFriend").and_then(Value::as_bool) != Some(true) {
        fact.fields.insert("isFriend".into(), Value::Bool(true));
        changed = true;
    }

    for (field, value) in &patch {
        if field == "id" || !is_present(value) {
            continue;
        }
        let Some((field_name, class)) = user_fact_field(field) else {
            continue;
        };
        let rank = rank_for_field(class, &options.source);
        let existing_rank = fact.field_ranks.get(field_name).copied().unwrap_or(0);
        if rank < existing_rank {
            continue;
        }
        if fact.fields.get(field) != Some(value) {
            fact.fields.insert(field.clone(), value.clone());
            changed = true;
        }
        if existing_rank != rank {
            fact.field_ranks.insert(field_name, rank);
            changed = true;
        }
    }

    if changed && fact.updated_at != updated_at {
        fact.updated_at = updated_at;
    }

    UserFactMergeResult { fact, changed }
}

pub fn number_value(value: i64) -> Value {
    Value::Number(Number::from(value))
}

#[cfg(test)]
mod tests;
