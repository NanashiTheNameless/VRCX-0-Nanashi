use serde_json::{json, Value};
use vrcx_0_application_core::{
    FeedLiveEntry, FriendProjection, RealtimeInstanceClosedProjection, RealtimeInstanceQueueKind,
    RealtimeInstanceQueueProjection, RealtimeNotificationProjection,
};

use super::content::nested_str;
use super::definitions::known_definition_for_type;
use super::types::{
    OverlayActivityCandidate, OverlayActivityEntry, OverlayActivityFavoriteSubject,
};
use super::OverlayActivityRuntime;
use vrcx_0_core::json::JsonExt;
use vrcx_0_core::text::first_non_empty_owned;

impl OverlayActivityRuntime {
    pub fn ingest_friend_projection(
        &self,
        projection: &FriendProjection,
        feed_entries: &[FeedLiveEntry],
    ) -> Vec<OverlayActivityEntry> {
        self.apply_friend_membership_projection(projection);
        feed_entries
            .iter()
            .filter_map(friend_feed_candidate)
            .filter_map(|candidate| self.ingest_candidate(candidate))
            .collect()
    }

    pub fn ingest_notification_projection(
        &self,
        projection: &RealtimeNotificationProjection,
    ) -> Vec<OverlayActivityEntry> {
        projection
            .upserts
            .iter()
            .filter(|upsert| upsert.deliver_runtime)
            .filter_map(|upsert| notification_candidate(&upsert.notification))
            .filter_map(|candidate| self.ingest_candidate(candidate))
            .collect()
    }

    pub fn ingest_instance_queue_projection(
        &self,
        projection: &RealtimeInstanceQueueProjection,
    ) -> Vec<OverlayActivityEntry> {
        if projection.kind != RealtimeInstanceQueueKind::Ready {
            return Vec::new();
        }
        let candidate = OverlayActivityCandidate {
            source_id: format!(
                "queue-ready:{}:{}",
                projection.instance_location, projection.received_at
            ),
            activity_type: "group.queueReady".to_string(),
            created_at: projection.received_at.clone(),
            actor_user_id: String::new(),
            actor_display_name: String::new(),
            current_instance: false,
            favorite_subject: OverlayActivityFavoriteSubject::None,
            payload: json!({
                "instanceLocation": projection.instance_location,
                "worldId": projection.world_id,
                "worldName": projection.world_name,
                "position": projection.position,
                "queueSize": projection.queue_size,
            })
            .into(),
        };
        self.ingest_candidate(candidate).into_iter().collect()
    }

    pub fn ingest_instance_closed_projection(
        &self,
        projection: &RealtimeInstanceClosedProjection,
    ) -> Vec<OverlayActivityEntry> {
        let notification = &projection.notification;
        let location = notification.trimmed_text("location");
        let created_at = first_non_empty_owned([
            notification.trimmed_field("createdAt").unwrap_or_default(),
            notification.trimmed_field("created_at").unwrap_or_default(),
        ]);
        let candidate = OverlayActivityCandidate {
            source_id: format!("instance-closed:{location}:{created_at}"),
            activity_type: "instance.closed".to_string(),
            created_at,
            actor_user_id: String::new(),
            actor_display_name: String::new(),
            current_instance: false,
            favorite_subject: OverlayActivityFavoriteSubject::None,
            payload: notification.clone(),
        };
        self.ingest_candidate(candidate).into_iter().collect()
    }

    fn apply_friend_membership_projection(&self, projection: &FriendProjection) {
        for patch in &projection.patches {
            self.insert_friend_user_id(patch.user_id.clone());
        }
        for user_id in &projection.removals {
            self.remove_friend_user_id(user_id);
        }
    }
}

fn friend_feed_candidate(entry: &FeedLiveEntry) -> Option<OverlayActivityCandidate> {
    let activity_type = entry.entry_type().to_string();
    known_definition_for_type(&activity_type)?;
    let created_at = entry.created_at().trim().to_string();
    let user_id = entry.user_id().trim().to_string();
    let current_instance = matches!(entry, FeedLiveEntry::OnPlayerJoining { .. });
    Some(OverlayActivityCandidate {
        source_id: format!("friend-feed:{activity_type}:{user_id}:{created_at}"),
        activity_type,
        created_at,
        actor_user_id: user_id.clone(),
        actor_display_name: entry.display_name().trim().to_string(),
        current_instance,
        favorite_subject: OverlayActivityFavoriteSubject::UserId(user_id.clone()),
        payload: entry.to_json().into(),
    })
}

fn notification_candidate(value: &Value) -> Option<OverlayActivityCandidate> {
    let activity_type = value.trimmed_text("type");
    known_definition_for_type(&activity_type)?;
    let id = first_non_empty_owned([
        value.trimmed_field("id").unwrap_or_default(),
        value.trimmed_field("notificationId").unwrap_or_default(),
    ]);
    let created_at = first_non_empty_owned([
        value.trimmed_field("createdAt").unwrap_or_default(),
        value.trimmed_field("created_at").unwrap_or_default(),
    ]);
    let actor_user_id = value.trimmed_text("senderUserId");
    let actor_user_id = if actor_user_id.starts_with("usr_") {
        actor_user_id
    } else {
        String::new()
    };
    let actor_display_name = notification_actor_display_name(value);
    let source_id = if id.trim().is_empty() {
        format!(
            "notification:{activity_type}:{actor_user_id}:{created_at}:{}",
            stable_json_hash(value)
        )
    } else {
        format!("notification:{id}")
    };
    Some(OverlayActivityCandidate {
        source_id,
        activity_type,
        created_at,
        actor_user_id: actor_user_id.clone(),
        actor_display_name,
        current_instance: false,
        favorite_subject: if actor_user_id.is_empty() {
            OverlayActivityFavoriteSubject::None
        } else {
            OverlayActivityFavoriteSubject::UserId(actor_user_id.clone())
        },
        payload: value.clone().into(),
    })
}

fn notification_actor_display_name(value: &Value) -> String {
    first_non_empty_owned([
        value.trimmed_field("senderDisplayName").unwrap_or_default(),
        value.trimmed_field("displayName").unwrap_or_default(),
        value.trimmed_field("senderUsername").unwrap_or_default(),
        nested_str(value, &["details", "senderDisplayName"]),
        nested_str(value, &["details", "displayName"]),
        nested_str(value, &["data", "senderDisplayName"]),
        nested_str(value, &["data", "displayName"]),
    ])
}

fn stable_json_hash(value: &Value) -> String {
    let payload = serde_json::to_string(value).unwrap_or_else(|_| value.to_string());
    let mut hash = 0xcbf29ce484222325u64;
    for byte in payload.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}
