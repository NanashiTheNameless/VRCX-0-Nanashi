use super::*;

use std::sync::Mutex;
use vrcx_0_application_core::Error;

#[derive(Default)]
struct TestBackgroundGroupRemote {
    instances: Vec<Value>,
    scoped_instances: Vec<Value>,
    scoped_error: Option<String>,
    profiles: HashMap<String, Value>,
    calls: Mutex<Vec<String>>,
}

impl BackgroundGroupRemote for TestBackgroundGroupRemote {
    fn group_instances<'a>(
        &'a self,
        endpoint: &'a str,
        current_user_id: &'a str,
    ) -> BackgroundGroupRemoteFuture<'a, Vec<Value>> {
        Box::pin(async move {
            self.calls
                .lock()
                .unwrap()
                .push(format!("instances:{endpoint}:{current_user_id}"));
            Ok(self.instances.clone())
        })
    }

    fn group_instances_for_group<'a>(
        &'a self,
        endpoint: &'a str,
        current_user_id: &'a str,
        group_id: &'a str,
    ) -> BackgroundGroupRemoteFuture<'a, Vec<Value>> {
        Box::pin(async move {
            self.calls.lock().unwrap().push(format!(
                "group-instances:{endpoint}:{current_user_id}:{group_id}"
            ));
            if let Some(error) = &self.scoped_error {
                return Err(Error::Custom(error.clone()));
            }
            Ok(self.scoped_instances.clone())
        })
    }

    fn group_profile<'a>(
        &'a self,
        endpoint: &'a str,
        group_id: &'a str,
    ) -> BackgroundGroupProfileFuture<'a> {
        Box::pin(async move {
            self.calls
                .lock()
                .unwrap()
                .push(format!("group-profile:{endpoint}:{group_id}"));
            self.profiles.get(group_id).cloned()
        })
    }
}

fn test_session() -> BackgroundCapabilitySessionIdentity {
    BackgroundCapabilitySessionIdentity {
        current_user_id: "usr_test".into(),
        endpoint: "https://api.example.test/api/1/".into(),
        websocket: "wss://pipeline.example.test".into(),
        auth_scope_generation: 7,
    }
}

#[tokio::test]
async fn semantic_remote_hydrates_each_group_once_and_preserves_instance_order() {
    let remote = TestBackgroundGroupRemote {
        instances: vec![
            json!({ "id": "instance-a", "groupId": "grp_shared" }),
            json!({ "id": "instance-b", "ownerId": "grp_shared" }),
            json!({
                "id": "instance-c",
                "group": {
                    "id": "grp_complete",
                    "name": "Complete",
                    "iconUrl": "https://example.test/complete.png"
                }
            }),
        ],
        profiles: HashMap::from([(
            "grp_shared".into(),
            json!({
                "id": "grp_shared",
                "name": "Shared Group",
                "iconUrl": "https://example.test/shared.png"
            }),
        )]),
        ..Default::default()
    };

    let refresh = refresh_background_group_instances(&remote, &test_session())
        .await
        .unwrap();

    assert_eq!(refresh.instances[0].as_value()["id"], json!("instance-a"));
    assert_eq!(refresh.instances[1].as_value()["id"], json!("instance-b"));
    assert_eq!(refresh.instances[2].as_value()["id"], json!("instance-c"));
    assert_eq!(
        refresh.instances[0].as_value()["group"]["name"],
        json!("Shared Group")
    );
    assert_eq!(
        refresh.instances[1].as_value()["group"]["name"],
        json!("Shared Group")
    );
    assert!(!refresh.fetched_at.is_empty());
    assert_eq!(
        *remote.calls.lock().unwrap(),
        vec![
            "instances:https://api.example.test/api/1/:usr_test",
            "group-profile:https://api.example.test/api/1/:grp_shared",
        ]
    );
}

#[tokio::test]
async fn unavailable_group_profile_keeps_a_minimal_group_fallback() {
    let remote = TestBackgroundGroupRemote {
        instances: vec![json!({
            "id": "instance-a",
            "location": "wrld_test:1~group(grp_unavailable)~groupAccessType(plus)"
        })],
        ..Default::default()
    };

    let refresh = refresh_background_group_instances(&remote, &test_session())
        .await
        .unwrap();

    assert_eq!(
        refresh.instances[0].as_value()["group"],
        json!({
            "id": "grp_unavailable",
            "groupId": "grp_unavailable",
            "name": "grp_unavailable"
        })
    );
}

#[tokio::test]
async fn group_scoped_refresh_propagates_the_semantic_remote_error() {
    let remote = TestBackgroundGroupRemote {
        scoped_error: Some("saved group instance refresh returned HTTP 503".into()),
        ..Default::default()
    };

    let error = refresh_background_group_instances_for_group(&remote, &test_session(), "grp_saved")
        .await
        .unwrap_err();

    assert_eq!(
        error.to_string(),
        "saved group instance refresh returned HTTP 503"
    );
}

#[test]
fn group_id_uses_nested_group_before_top_level_owner_and_location() {
    let instance = json!({
        "group": { "groupId": " grp_nested " },
        "instance": {
            "group": { "id": "grp_instance_nested" },
            "groupId": "grp_instance_top",
            "ownerId": "grp_instance_owner"
        },
        "groupId": "grp_top",
        "ownerId": "grp_owner",
        "location": "wrld_test:1~group(grp_location)~groupAccessType(plus)"
    });

    assert_eq!(normalize_group_instance_group_id(&instance), "grp_nested");
}

#[test]
fn group_id_falls_through_sources_in_priority_order() {
    let cases = [
        (
            json!({
                "group": { "groupId": "usr_not_group" },
                "instance": { "group": { "id": "grp_nested" } },
                "groupId": "grp_top",
                "ownerId": "grp_owner",
                "location": "wrld_test:1~group(grp_location)"
            }),
            "grp_nested",
        ),
        (
            json!({
                "groupId": " grp_top ",
                "ownerId": "grp_owner",
                "location": "wrld_test:1~group(grp_location)"
            }),
            "grp_top",
        ),
        (
            json!({
                "groupId": "usr_not_group",
                "ownerId": " grp_owner ",
                "location": "wrld_test:1~group(grp_location)"
            }),
            "grp_owner",
        ),
        (
            json!({
                "ownerId": "usr_owner",
                "location": "wrld_test:1~group(grp_location)~groupAccessType(plus)"
            }),
            "grp_location",
        ),
    ];

    for (instance, expected) in cases {
        assert_eq!(normalize_group_instance_group_id(&instance), expected);
    }
}

#[test]
fn complete_group_requires_id_name_and_supported_icon() {
    for icon_key in ["iconUrl", "icon", "thumbnailUrl", "imageUrl"] {
        let mut group = Map::from_iter([
            ("groupId".into(), json!("grp_complete")),
            ("name".into(), json!("Complete Group")),
        ]);
        group.insert(icon_key.into(), json!("https://example.test/icon.png"));

        assert!(has_complete_group_instance_group(&json!({
            "instance": { "group": Value::Object(group) }
        })));
    }

    for group in [
        json!({ "name": "Group", "iconUrl": "icon" }),
        json!({ "id": "grp_group", "iconUrl": "icon" }),
        json!({ "id": "grp_group", "name": "Group" }),
        json!({ "id": " ", "name": "Group", "iconUrl": "icon" }),
        json!({ "id": "grp_group", "name": " ", "iconUrl": "icon" }),
        json!({ "id": "grp_group", "name": "Group", "iconUrl": " " }),
    ] {
        assert!(!has_complete_group_instance_group(
            &json!({ "group": group })
        ));
    }
}

#[test]
fn merge_prefers_existing_fields_and_fills_missing_fields_from_fetched_group() {
    let merged = merge_group_instance_group(
        Some(json!({
            "groupId": "grp_group",
            "name": "Existing Name",
            "description": "Existing Description",
            "memberCount": 12
        })),
        Some(json!({
            "id": "grp_group",
            "name": "Fetched Name",
            "description": "Fetched Description",
            "memberCount": 99,
            "iconUrl": "https://example.test/icon.png",
            "bannerUrl": "https://example.test/banner.png"
        })),
        "grp_group",
    )
    .unwrap();

    assert_eq!(merged["id"], json!("grp_group"));
    assert_eq!(merged["groupId"], json!("grp_group"));
    assert_eq!(merged["name"], json!("Existing Name"));
    assert_eq!(merged["description"], json!("Existing Description"));
    assert_eq!(merged["memberCount"], json!(12));
    assert_eq!(merged["iconUrl"], json!("https://example.test/icon.png"));
    assert_eq!(
        merged["bannerUrl"],
        json!("https://example.test/banner.png")
    );
}

#[test]
fn merge_replaces_fallback_name_with_fetched_profile_name() {
    let merged = merge_group_instance_group(
        group_fallback("grp_group"),
        Some(json!({
            "id": "grp_group",
            "name": "Fetched Name",
            "iconUrl": "https://example.test/icon.png"
        })),
        "grp_group",
    )
    .unwrap();

    assert_eq!(merged["name"], json!("Fetched Name"));
    assert_eq!(merged["iconUrl"], json!("https://example.test/icon.png"));
}

#[test]
fn hydration_leaves_instance_unchanged_without_group_id() {
    let instance = json!({
        "ownerId": "usr_owner",
        "location": "wrld_test:1"
    });

    assert_eq!(
        hydrate_group_instance(instance.clone(), &HashMap::new()),
        instance
    );
}

#[test]
fn running_projection_omits_unavailable_fields() {
    let payload = RuntimeGroupInstancesProjection::running(
        "usr_test".into(),
        "https://api.vrchat.cloud".into(),
    );

    assert_eq!(
        serde_json::to_value(payload).unwrap(),
        json!({
            "status": "running",
            "userId": "usr_test",
            "endpoint": "https://api.vrchat.cloud",
        })
    );
}

#[test]
fn idle_projection_omits_entries_when_existing_arrays_must_be_preserved() {
    let payload = RuntimeGroupInstancesProjection::idle_preserving_entries(
        "usr_test".into(),
        "https://api.vrchat.cloud".into(),
    );

    assert_eq!(
        serde_json::to_value(payload).unwrap(),
        json!({
            "status": "idle",
            "userId": "usr_test",
            "endpoint": "https://api.vrchat.cloud",
        })
    );
}

#[test]
fn cleared_projection_preserves_empty_error_and_arrays() {
    let payload = RuntimeGroupInstancesProjection::cleared_session(
        "usr_test".into(),
        "https://api.vrchat.cloud".into(),
    );

    assert_eq!(
        serde_json::to_value(payload).unwrap(),
        json!({
            "status": "idle",
            "userId": "usr_test",
            "endpoint": "https://api.vrchat.cloud",
            "error": "",
            "instances": [],
            "groupOrder": [],
        })
    );
}
