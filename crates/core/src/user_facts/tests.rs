use super::*;
use serde_json::json;

fn opts(source: &str) -> UserFactMergeOptions {
    UserFactMergeOptions {
        endpoint: "https://api.example.test".into(),
        source: source.into(),
        received_at: 1781568000,
        ..Default::default()
    }
}

#[test]
fn to_object_emits_derived_trust_and_platform() {
    let result = merge_user_fact(
        None,
        &json!({
            "id": "usr_1",
            "tags": ["system_trust_veteran"],
            "platform": "standalonewindows"
        }),
        &opts("profile"),
    );
    let object = result.fact.to_object();
    assert_eq!(
        object.get("$trustLevel").and_then(Value::as_str),
        Some("Trusted User")
    );
    assert_eq!(
        object.get("$trustClass").and_then(Value::as_str),
        Some("x-tag-veteran")
    );
    assert_eq!(
        object.get("$platform").and_then(Value::as_str),
        Some("standalonewindows")
    );
    assert_eq!(
        object.get("$isModerator").and_then(Value::as_bool),
        Some(false)
    );
    assert!(!object.contains_key("fieldRanks"));
}

#[test]
fn raw_presence_fields_become_a_presence_view() {
    let tag = "wrld_a:1~group(grp_a)~groupAccessType(plus)";
    let result = merge_user_fact(
        None,
        &json!({ "id": "usr_1", "state": "online", "location": tag, "pendingOffline": true }),
        &opts("profile"),
    );
    let object = result.fact.to_object();

    assert_eq!(object["$presence"]["kind"], json!("online"));
    assert_eq!(object["$presence"]["place"]["location"]["tag"], json!(tag));
    for raw in ["state", "location", "pendingOffline", "$location"] {
        assert!(!object.contains_key(raw), "{raw}");
    }
}

#[test]
fn presence_view_passes_through_without_raw_presence_fields() {
    let presence = json!({ "kind": "active", "platform": "web" });
    let result = merge_user_fact(
        None,
        &json!({ "id": "usr_1", "displayName": "Alice", "$presence": presence }),
        &opts("profile"),
    );

    assert_eq!(result.fact.fields.get("$presence"), Some(&presence));
}

#[test]
fn aliases_and_whitelist_normalize_input() {
    let result = merge_user_fact(
        None,
        &json!({
            "user_id": "usr_1",
            "display_name": "Alice",
            "unknown_field": "drop me"
        }),
        &opts("friend"),
    );
    let f = &result.fact.fields;
    assert_eq!(f.get("id").and_then(Value::as_str), Some("usr_1"));
    assert_eq!(f.get("displayName").and_then(Value::as_str), Some("Alice"));
    assert!(!f.contains_key("unknown_field"));
}

#[test]
fn badge_profile_fields_survive_friend_ingestion_and_sparse_updates() {
    let profile = json!({
        "id": "usr_1",
        "ageVerified": true,
        "ageVerificationStatus": "18+",
        "bio": "An artist",
        "pronouns": "they/them",
        "memo": "Local friend memo",
        "note": "VRChat note"
    });
    let first = merge_user_fact(None, &profile, &opts("friend"));
    let next = merge_user_fact(
        Some(&first.fact),
        &json!({ "id": "usr_1", "status": "active", "lastPlatform": "android" }),
        &opts("realtime"),
    );
    let object = next.fact.to_object();
    for (key, value) in profile.as_object().unwrap() {
        assert_eq!(object.get(key), Some(value), "{key}");
    }
    assert_eq!(object["last_platform"], json!("android"));
    assert_eq!(object["$platform"], json!("android"));
    assert!(!object.contains_key("lastPlatform"));
}

#[test]
fn badge_profile_fields_can_be_cleared_without_placeholders_restoring_them() {
    let profile = json!({
        "id": "usr_1",
        "ageVerified": true,
        "ageVerificationStatus": "18+",
        "bio": "An artist",
        "pronouns": "they/them",
        "memo": "Local friend memo",
        "note": "VRChat note"
    });
    for cleared in [json!("hidden"), json!(""), Value::Null] {
        let first = merge_user_fact(None, &profile, &opts("profile"));
        let next = merge_user_fact(
            Some(&first.fact),
            &json!({
                "id": "usr_1",
                "ageVerified": false,
                "ageVerificationStatus": cleared,
                "bio": "",
                "pronouns": null,
                "memo": "",
                "note": null
            }),
            &opts("realtime"),
        );
        assert!(next.changed);
        let object = next.fact.to_object();
        assert_eq!(object["ageVerified"], json!(false));
        assert_eq!(
            object["ageVerificationStatus"],
            json!(cleared.as_str().unwrap_or_default())
        );
        for key in ["bio", "pronouns", "memo", "note"] {
            assert_eq!(object[key], json!(""), "{key}");
        }
        for source in ["seed", "instance", "playerSnapshot"] {
            let placeholder = merge_user_fact(Some(&next.fact), &profile, &opts(source));
            assert!(!placeholder.changed, "{source}");
            assert_eq!(placeholder.fact.to_object(), object, "{source}");
        }
    }
}

#[test]
fn later_observations_win_regardless_of_source() {
    let profile = merge_user_fact(
        None,
        &json!({
            "id": "usr_1",
            "displayName": "Before",
            "iconUrl": "https://api.vrchat.cloud/api/1/image/file_1/1/256"
        }),
        &opts("profile"),
    );
    let realtime = merge_user_fact(
        Some(&profile.fact),
        &json!({
            "id": "usr_1",
            "displayName": "After",
            "iconUrl": "https://api.vrchat.cloud/api/1/image/file_2/1/256"
        }),
        &opts("realtime"),
    );

    let f = &realtime.fact.fields;
    assert_eq!(f.get("displayName").and_then(Value::as_str), Some("After"));
    assert_eq!(
        f.get("iconUrl").and_then(Value::as_str),
        Some("https://api.vrchat.cloud/api/1/image/file_2/1/256")
    );
}

#[test]
fn placeholder_sources_only_fill_unobserved_fields() {
    let observed = merge_user_fact(
        None,
        &json!({ "id": "usr_1", "displayName": "Alice", "state": "online", "location": "wrld_a:1" }),
        &opts("realtime"),
    );
    for source in ["seed", "instance", "playerSnapshot"] {
        let after = merge_user_fact(
            Some(&observed.fact),
            &json!({
                "id": "usr_1",
                "displayName": "usr_1",
                "location": "wrld_stale:2",
                "iconUrl": "https://api.vrchat.cloud/api/1/image/file_1/1/256"
            }),
            &opts(source),
        );
        let f = &after.fact.fields;
        assert_eq!(
            f.get("displayName").and_then(Value::as_str),
            Some("Alice"),
            "{source}"
        );
        assert_eq!(
            f["$presence"]["place"]["location"]["tag"],
            json!("wrld_a:1"),
            "{source}"
        );
        assert_eq!(
            f.get("iconUrl").and_then(Value::as_str),
            Some("https://api.vrchat.cloud/api/1/image/file_1/1/256"),
            "{source}"
        );
    }
}

#[test]
fn missing_or_empty_fields_do_not_overwrite_existing() {
    let first = merge_user_fact(
        None,
        &json!({ "id": "usr_1", "displayName": "Alice" }),
        &opts("profile"),
    );
    let second = merge_user_fact(
        Some(&first.fact),
        &json!({ "id": "usr_1", "displayName": "" }),
        &opts("currentUser"),
    );
    assert_eq!(
        second
            .fact
            .fields
            .get("displayName")
            .and_then(Value::as_str),
        Some("Alice")
    );
}

#[test]
fn unchanged_merge_reports_not_changed() {
    let first = merge_user_fact(
        None,
        &json!({ "id": "usr_1", "displayName": "Alice" }),
        &opts("realtime"),
    );
    let again = merge_user_fact(
        Some(&first.fact),
        &json!({ "id": "usr_1", "displayName": "Alice" }),
        &opts("profile"),
    );
    assert!(!again.changed);
}

#[test]
fn friend_number_parses_from_a_string() {
    let result = merge_user_fact(
        None,
        &json!({ "id": "usr_1", "friendNumber": "42" }),
        &opts("friend"),
    );
    assert_eq!(result.fact.fields.get("friendNumber"), Some(&json!(42)));
}

#[test]
fn user_fact_key_is_endpoint_scoped() {
    assert_eq!(
        user_fact_key(&json!("https://api.example.test"), &json!("usr_1")),
        "https://api.example.test::usr_1"
    );
    assert_eq!(user_fact_key(&json!(""), &json!("usr_1")), "default::usr_1");
    assert_eq!(user_fact_key(&json!("ep"), &json!("")), "");
}
