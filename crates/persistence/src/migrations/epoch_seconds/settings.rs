use serde_json::Value;
use vrcx_0_core::time::{epoch_from_json, parse_epoch_seconds};

pub(crate) fn convert_setting_text(key: &str, value: &str) -> String {
    let lower = key.to_ascii_lowercase();
    let name = lower
        .strip_prefix("config:vrcx_")
        .or_else(|| lower.strip_prefix("vrcx_"))
        .unwrap_or(&lower);
    if matches!(
        name,
        "vrchatregistrylastbackupdate"
            | "vrchatregistrylastrestorecheck"
            | "lastgameofflineat"
            | "gamelogpersistenceresumeafter"
            | "profilebackuplastautoat"
    ) || name.starts_with("lastavatarcleanupdate_")
    {
        return parse_epoch_seconds(value)
            .map_or_else(|| value.to_string(), |seconds| seconds.to_string());
    }
    if !matches!(
        name,
        "gamelogreplaycheckpoint"
            | "assistantreminders"
            | "safetysourcecache"
            | "safetyaudit"
            | "safetyglobalhideaudit"
            | "safetyglobalhide"
            | "vrchatregistrybackups"
            | "communitythemeinstallmetadata"
            | "communitythemeinstalledthemes"
            | "backgroundimagesnapshots"
            | "officialbackgroundsnapshots"
    ) {
        return value.to_string();
    }
    let Ok(mut json) = serde_json::from_str::<Value>(value) else {
        return value.to_string();
    };
    if convert_json_dates(&mut json) {
        json.to_string()
    } else {
        value.to_string()
    }
}

fn convert_json_dates(value: &mut Value) -> bool {
    match value {
        Value::Array(values) => {
            let mut changed = false;
            for value in values {
                changed |= convert_json_dates(value);
            }
            changed
        }
        Value::Object(object) => {
            let mut changed = false;
            if let Some(nanos) = object.remove("file_created_at") {
                if let Some(nanos) = nanos.as_u64() {
                    object.insert(
                        "file_created_at_seconds".into(),
                        (nanos / 1_000_000_000).into(),
                    );
                    object.insert(
                        "file_creation_fraction".into(),
                        (nanos % 1_000_000_000).into(),
                    );
                }
                changed = true;
            }
            if let Some(millis) = object.remove("joinTimeMs") {
                object.insert(
                    "joinTime".into(),
                    millis
                        .as_i64()
                        .map(|millis| Value::from(millis.div_euclid(1000)))
                        .unwrap_or(Value::Null),
                );
                changed = true;
            }
            changed |= object.remove("current_location_started_at_ms").is_some();
            for (key, value) in object {
                if matches!(
                    key.as_str(),
                    "at" | "date"
                        | "createdAt"
                        | "updatedAt"
                        | "installedAt"
                        | "resolvedAt"
                        | "lastFiredAt"
                        | "lastAttempt"
                        | "cutoff"
                        | "current_location_started_at"
                        | "eventCreatedAt"
                        | "backoffUntil"
                        | "lastBlockAt"
                ) {
                    if let Some(seconds) = epoch_from_json(value) {
                        let converted = Value::from(seconds);
                        changed |= *value != converted;
                        *value = converted;
                    }
                } else if key != "data" {
                    changed |= convert_json_dates(value);
                }
            }
            changed
        }
        _ => false,
    }
}
