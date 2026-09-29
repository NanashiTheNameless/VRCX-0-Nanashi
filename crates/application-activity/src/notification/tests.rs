use std::sync::Arc;

use super::{
    generic_webhook_payload, parse_webhook_fields, CachedNotificationUserImageResolver,
    RealtimeUserImageResolverSlot, RenderedNotification,
};
use crate::{
    OverlayActivityActorRelation, OverlayActivityCategory, OverlayActivityContent,
    OverlayActivityDelivery, OverlayActivityEntry,
};
use serde_json::json;

#[test]
fn generic_webhook_payload_exposes_location_id_and_local_time() {
    let payload = generic_webhook_payload(
        &delivery(),
        &rendered(),
        &["location".into(), "locationId".into(), "localTime".into()],
    );

    assert_eq!(
        payload.get("location").and_then(|value| value.as_str()),
        Some("Named World public")
    );
    assert_eq!(
        payload.get("locationId").and_then(|value| value.as_str()),
        Some("wrld_named:123")
    );
    let local_time = payload
        .get("localTime")
        .and_then(|value| value.as_str())
        .expect("localTime");
    assert_eq!(local_time.len(), "2026-06-18 17:30:00".len());
    assert!(payload.get("timestamp").is_none());
    assert!(payload.get("worldName").is_none());
}

#[test]
fn generic_webhook_fields_ignore_localized_names() {
    let fields = parse_webhook_fields(r#"["locationId","位置","タイトル"]"#);
    let payload = generic_webhook_payload(&delivery(), &rendered(), &fields);

    assert_eq!(payload.as_object().unwrap().len(), 1);
    assert_eq!(
        payload.get("locationId").and_then(|value| value.as_str()),
        Some("wrld_named:123")
    );
    assert!(payload.get("位置").is_none());
    assert!(payload.get("タイトル").is_none());
}

fn rendered() -> RenderedNotification {
    RenderedNotification {
        title: "Traveler".into(),
        body: "joined Named World".into(),
        text: "Traveler joined Named World".into(),
        display_location: "Named World public".into(),
        image_url: String::new(),
    }
}

fn delivery() -> OverlayActivityDelivery {
    OverlayActivityDelivery {
        entry: OverlayActivityEntry {
            sequence: 1,
            source_id: "game-log:join".into(),
            activity_type: "OnPlayerJoined".into(),
            category: OverlayActivityCategory::CurrentInstance,
            created_at: "2026-06-18T08:30:00.000Z".into(),
            actor_user_id: "usr_traveler".into(),
            actor_display_name: "Traveler".into(),
            content: OverlayActivityContent {
                location: "wrld_named:123".into(),
                world_id: "wrld_named".into(),
                display_location: "Named World public".into(),
                world_name: "Named World".into(),
                ..OverlayActivityContent::default()
            },
            actor_relation: OverlayActivityActorRelation::None,
            payload: json!({}).into(),
        },
        desktop: false,
        vr: false,
        hmd: false,
        webhook: true,
        tts: false,
    }
}

struct FakeCachedResolver {
    url: Option<String>,
}

impl CachedNotificationUserImageResolver for FakeCachedResolver {
    fn cached_url(&self, _endpoint: &str, _user_id: &str) -> Option<String> {
        self.url.clone()
    }
}

#[test]
fn realtime_image_resolver_returns_none_when_slot_is_unset() {
    let resolver = RealtimeUserImageResolverSlot::default();
    let image_url = resolver.cached_url("", "usr_traveler");

    assert_eq!(image_url, None);
}

#[test]
fn realtime_user_image_resolver_does_not_retain_owner() {
    let owner: Arc<dyn CachedNotificationUserImageResolver> = Arc::new(FakeCachedResolver {
        url: Some("https://img.example/usr_traveler.png".into()),
    });
    let weak_owner = Arc::downgrade(&owner);
    let resolver = RealtimeUserImageResolverSlot::default();

    resolver.set(&owner);
    assert_eq!(
        resolver.cached_url("", "usr_traveler").as_deref(),
        Some("https://img.example/usr_traveler.png")
    );
    drop(owner);

    assert!(weak_owner.upgrade().is_none());
    assert_eq!(resolver.cached_url("", "usr_traveler"), None);
}
