use serde_json::{Map, Value};
use vrcx_0_core::friends::{FriendRecord, OptionalCompactString};
use vrcx_0_core::json::JsonExt;

pub(in crate::realtime::friends::runtime) fn merge_profile(
    previous: Option<&FriendRecord>,
    user_id: &str,
    patch: &Value,
) -> FriendRecord {
    let mut next = previous.cloned().unwrap_or_default();
    if let Some(fields) = patch.as_object() {
        apply_fields(&mut next, fields);
    }
    next.id = user_id.to_string();
    sanitize_extra(&mut next);
    next
}

struct NamedField {
    keys: &'static [&'static str],
    get: fn(&FriendRecord) -> &str,
    set: fn(&mut FriendRecord, &str),
}

const NAMED_FIELDS: &[NamedField] = &[
    NamedField {
        keys: &["id"],
        get: |record| &record.id,
        set: |record, value| record.id = value.into(),
    },
    NamedField {
        keys: &["displayName"],
        get: |record| &record.display_name,
        set: |record, value| record.display_name = value.into(),
    },
    NamedField {
        keys: &["username"],
        get: |record| &record.username,
        set: |record, value| record.username = value.into(),
    },
    NamedField {
        keys: &["lastPlatform", "last_platform"],
        get: |record| &record.last_platform,
        set: |record, value| record.last_platform = value.into(),
    },
    NamedField {
        keys: &["status"],
        get: |record| &record.status,
        set: |record, value| record.status = value.into(),
    },
    NamedField {
        keys: &["statusDescription"],
        get: |record| &record.status_description,
        set: |record, value| record.status_description = value.into(),
    },
    NamedField {
        keys: &["iconUrl"],
        get: |record| &record.icon_url,
        set: |record, value| record.icon_url = value.into(),
    },
];

struct OptionalField {
    key: &'static str,
    get: fn(&FriendRecord) -> &OptionalCompactString,
    set: fn(&mut FriendRecord, OptionalCompactString),
}

const OPTIONAL_FIELDS: &[OptionalField] = &[
    OptionalField {
        key: "date_joined",
        get: |record| &record.date_joined,
        set: |record, value| record.date_joined = value,
    },
    OptionalField {
        key: "last_activity",
        get: |record| &record.last_activity,
        set: |record, value| record.last_activity = value,
    },
    OptionalField {
        key: "last_login",
        get: |record| &record.last_login,
        set: |record, value| record.last_login = value,
    },
    OptionalField {
        key: "last_mobile",
        get: |record| &record.last_mobile,
        set: |record, value| record.last_mobile = value,
    },
];

fn named_field(key: &str) -> Option<&'static NamedField> {
    NAMED_FIELDS.iter().find(|field| field.keys.contains(&key))
}

fn optional_field(key: &str) -> Option<&'static OptionalField> {
    OPTIONAL_FIELDS.iter().find(|field| field.key == key)
}

fn is_named_key(key: &str) -> bool {
    named_field(key).is_some() || optional_field(key).is_some()
}

fn patch_str<'a>(patch: &'a Map<String, Value>, keys: &[&str]) -> Option<&'a str> {
    for key in keys {
        match patch.get(*key) {
            Some(Value::String(value)) => return Some(value),
            Some(Value::Null) | None => {}
            Some(other) => tracing::warn!(
                "friend patch field `{}` has non-string value: {}",
                *key,
                other
            ),
        }
    }
    None
}

fn apply_fields(record: &mut FriendRecord, patch: &Map<String, Value>) {
    for field in NAMED_FIELDS {
        if let Some(value) = patch_str(patch, field.keys) {
            (field.set)(record, value);
        }
    }
    for field in OPTIONAL_FIELDS {
        match patch.get(field.key) {
            Some(Value::String(value)) => (field.set)(record, value.as_str().into()),
            Some(Value::Null) => (field.set)(record, OptionalCompactString::null()),
            Some(other) => {
                tracing::warn!(
                    "friend patch field `{}` has non-string value: {other}",
                    field.key
                )
            }
            None => {}
        }
    }
    record.extra.extend(
        patch
            .iter()
            .filter(|(key, _)| !is_named_key(key))
            .map(|(key, value)| (key.clone(), value.clone())),
    );
}

fn sanitize_extra(record: &mut FriendRecord) {
    record.extra.retain(|key, _| !is_named_key(key));
}

pub(in crate::realtime::friends::runtime) fn record_string(
    record: &FriendRecord,
    key: &str,
) -> String {
    if let Some(field) = named_field(key) {
        return (field.get)(record).to_string();
    }
    if let Some(field) = optional_field(key) {
        return (field.get)(record).as_str().unwrap_or_default().to_string();
    }
    record.extra.text_field(key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn field_tables_cover_every_serialized_friend_record_key() {
        let record = FriendRecord {
            date_joined: "2026-01-01".into(),
            last_activity: "2026-01-01T00:00:00Z".into(),
            last_login: "2026-01-01T00:00:00Z".into(),
            last_mobile: "2026-01-01T00:00:00Z".into(),
            ..FriendRecord::default()
        };
        let serialized = serde_json::to_value(&record).unwrap();
        let mut serialized_keys = serialized
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        serialized_keys.sort();
        let mut table_keys = NAMED_FIELDS
            .iter()
            .map(|field| field.keys[0].to_string())
            .chain(OPTIONAL_FIELDS.iter().map(|field| field.key.to_string()))
            .collect::<Vec<_>>();
        table_keys.sort();
        assert_eq!(serialized_keys, table_keys);
    }

    #[test]
    fn merge_normalizes_aliases_and_preserves_unknown_fields() {
        let previous = FriendRecord {
            id: "usr_x".into(),
            status_description: "hi".into(),
            date_joined: "2026-01-01".into(),
            last_activity: "2026-01-02T03:04:05.000Z".into(),
            ..FriendRecord::default()
        };
        let next = merge_profile(
            Some(&previous),
            "usr_x",
            &json!({
                "last_platform": "standalonewindows",
                "statusDescription": Value::Null,
                "last_activity": null,
                "last_login": "2026-01-03T03:04:05.000Z",
                "bannerColor": "red"
            }),
        );

        assert_eq!(next.last_platform, "standalonewindows");
        assert_eq!(next.status_description, "hi");
        assert_eq!(next.date_joined.as_str(), Some("2026-01-01"));
        assert!(next.last_activity.is_null());
        assert_eq!(next.last_login.as_str(), Some("2026-01-03T03:04:05.000Z"));
        assert_eq!(next.extra["bannerColor"], "red");
        assert!(next.extra.get("last_platform").is_none());
    }
}
