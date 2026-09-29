use serde::{Deserialize, Serialize};
use serde_json::Value;
use vrcx_0_contracts::CacheEntityInput;
use vrcx_0_core::json::RawJson;
use vrcx_0_core::text::normalize_text;

use vrcx_0_application_core::{AvatarCache, Result, WorldCache};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FavoriteCacheKind {
    Avatar,
    World,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteCacheSnapshotInput {
    pub kind: FavoriteCacheKind,
    pub entity: RawJson,
    #[serde(default)]
    pub fallback_entity_id: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum CacheWriteDecision {
    Upsert,
    InsertIfMissing,
    Skip,
}

pub fn persist_favorite_cache_snapshot(
    world_cache: &WorldCache,
    avatar_cache: &AvatarCache,
    user_id: &str,
    endpoint: &str,
    input: FavoriteCacheSnapshotInput,
) -> Result<bool> {
    let entity = input.entity.as_value();
    if matches!(input.kind, FavoriteCacheKind::World) {
        return cache_world_snapshot(world_cache, entity, &input.fallback_entity_id);
    }
    let decision = cache_write_decision(input.kind, entity);
    if decision == CacheWriteDecision::Skip {
        return Ok(false);
    }
    let entry = cache_entry_from_entity(entity, &input.fallback_entity_id);
    let id = entry.id.as_str().unwrap_or_default().trim().to_string();
    if id.is_empty() {
        return Ok(false);
    }
    if decision == CacheWriteDecision::InsertIfMissing
        && !avatar_cache
            .existing_summary_ids(std::slice::from_ref(&id))?
            .is_empty()
    {
        return Ok(false);
    }
    avatar_cache.store_summaries(user_id, endpoint, vec![entry])?;
    Ok(true)
}

pub(super) fn cache_world_snapshot(
    world_cache: &WorldCache,
    world: &Value,
    fallback_world_id: &str,
) -> Result<bool> {
    if cache_write_decision(FavoriteCacheKind::World, world) != CacheWriteDecision::Upsert {
        return Ok(false);
    }
    let fallback_world_id = normalize_text(fallback_world_id);
    if entity_id(world).is_empty() && !fallback_world_id.is_empty() {
        let mut world = world.clone();
        if let Some(fields) = world.as_object_mut() {
            fields.insert("id".into(), Value::String(fallback_world_id));
        }
        return Ok(world_cache.store_from_payload(&world)?.is_some());
    }
    Ok(world_cache.store_from_payload(world)?.is_some())
}

pub(super) fn cache_write_decision(kind: FavoriteCacheKind, entity: &Value) -> CacheWriteDecision {
    if !has_complete_snapshot(entity) {
        return CacheWriteDecision::Skip;
    }
    match (kind, release_status(entity).as_str()) {
        (_, "public") | (FavoriteCacheKind::World, "private") => CacheWriteDecision::Upsert,
        (FavoriteCacheKind::Avatar, _) => CacheWriteDecision::InsertIfMissing,
        (FavoriteCacheKind::World, _) => CacheWriteDecision::Skip,
    }
}

pub(super) fn release_status(entity: &Value) -> String {
    field_text(entity, &["releaseStatus"]).trim().to_lowercase()
}

pub(super) fn entity_id(entity: &Value) -> String {
    entity_field_id(entity, "id")
}

pub(super) fn cache_entry_from_entity(entity: &Value, fallback_id: &str) -> CacheEntityInput {
    let id = entity_id(entity);
    let id = if id.is_empty() {
        normalize_text(fallback_id)
    } else {
        id
    };
    CacheEntityInput {
        id: Value::String(id),
        author_id: Value::String(entity_field_id(entity, "authorId")),
        author_name: Value::String(field_text(entity, &["authorName"])),
        created_at: Value::String(field_text(entity, &["created_at", "createdAt"])),
        description: Value::String(field_text(entity, &["description"])),
        image_url: Value::String(field_text(entity, &["imageUrl"])),
        name: Value::String(field_text(entity, &["name"])),
        release_status: Value::String(field_text(entity, &["releaseStatus"])),
        thumbnail_image_url: Value::String(field_text(entity, &["thumbnailImageUrl"])),
        updated_at: Value::String(field_text(entity, &["updated_at", "updatedAt"])),
        version: Value::Number(entity_version(entity).into()),
    }
}

fn has_complete_snapshot(entity: &Value) -> bool {
    let name = field_text(entity, &["name"]);
    let thumbnail = field_text(entity, &["thumbnailImageUrl"]);
    let image_url = if thumbnail.trim().is_empty() {
        field_text(entity, &["imageUrl"])
    } else {
        thumbnail
    };
    !name.trim().is_empty() && !image_url.trim().is_empty()
}

fn entity_field_id(entity: &Value, key: &str) -> String {
    normalize_text(field_text(entity, &[key]))
}

fn field_text(entity: &Value, keys: &[&str]) -> String {
    for key in keys {
        match entity.get(*key) {
            Some(Value::String(text)) => return text.clone(),
            Some(Value::Null) | None => continue,
            Some(other) => return other.to_string(),
        }
    }
    String::new()
}

fn entity_version(entity: &Value) -> i64 {
    match entity.get("version") {
        Some(Value::Number(number)) => number.as_i64().unwrap_or(0),
        Some(Value::String(text)) => text.trim().parse().unwrap_or(0),
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use vrcx_0_application_core::{MemoryWorldCachePort, NoopAvatarCachePort};

    #[test]
    fn world_policy_upserts_public_and_private_details() {
        let public = json!({
            "name": "Public",
            "releaseStatus": "public",
            "imageUrl": "https://example.test/public.png"
        });
        let private = json!({
            "name": "Private",
            "releaseStatus": "private",
            "imageUrl": "https://example.test/private.png"
        });

        assert_eq!(
            cache_write_decision(FavoriteCacheKind::World, &public),
            CacheWriteDecision::Upsert
        );
        assert_eq!(
            cache_write_decision(FavoriteCacheKind::World, &private),
            CacheWriteDecision::Upsert
        );
    }

    #[test]
    fn avatar_policy_preserves_any_complete_non_public_snapshot() {
        let unavailable = json!({
            "name": "Unavailable",
            "releaseStatus": "unavailable",
            "thumbnailImageUrl": "https://example.test/avatar.png"
        });

        assert_eq!(
            cache_write_decision(FavoriteCacheKind::Avatar, &unavailable),
            CacheWriteDecision::InsertIfMissing
        );
    }

    #[test]
    fn policy_rejects_incomplete_snapshots_and_unknown_world_statuses() {
        let incomplete = json!({"name": "No image", "releaseStatus": "public"});
        let unknown = json!({
            "name": "Unknown",
            "releaseStatus": "unavailable",
            "imageUrl": "https://example.test/world.png"
        });

        assert_eq!(
            cache_write_decision(FavoriteCacheKind::Avatar, &incomplete),
            CacheWriteDecision::Skip
        );
        assert_eq!(
            cache_write_decision(FavoriteCacheKind::World, &unknown),
            CacheWriteDecision::Skip
        );
    }

    #[test]
    fn private_world_snapshot_overwrites_existing_public_cache() {
        let public = json!({
            "id": "wrld_test",
            "name": "Public name",
            "releaseStatus": "public",
            "imageUrl": "https://example.test/public.png"
        });
        let private = json!({
            "id": "wrld_test",
            "name": "Private name",
            "releaseStatus": "private",
            "imageUrl": "https://example.test/private.png"
        });

        let world_cache = WorldCache::new(MemoryWorldCachePort::default());
        let avatar_cache = AvatarCache::new(NoopAvatarCachePort);

        assert!(persist_favorite_cache_snapshot(
            &world_cache,
            &avatar_cache,
            "usr_self",
            "https://api.vrchat.cloud/api/1",
            FavoriteCacheSnapshotInput {
                kind: FavoriteCacheKind::World,
                entity: RawJson::from(public),
                fallback_entity_id: String::new(),
            },
        )
        .unwrap());
        assert!(persist_favorite_cache_snapshot(
            &world_cache,
            &avatar_cache,
            "usr_self",
            "https://api.vrchat.cloud/api/1",
            FavoriteCacheSnapshotInput {
                kind: FavoriteCacheKind::World,
                entity: RawJson::from(private),
                fallback_entity_id: String::new(),
            },
        )
        .unwrap());

        assert_eq!(
            world_cache.get_name("wrld_test").as_deref(),
            Some("Private name")
        );
    }

    #[test]
    fn world_snapshot_without_an_id_is_cached_under_the_fallback_id() {
        let world_cache = WorldCache::new(MemoryWorldCachePort::default());
        let avatar_cache = AvatarCache::new(NoopAvatarCachePort);

        assert!(persist_favorite_cache_snapshot(
            &world_cache,
            &avatar_cache,
            "usr_self",
            "https://api.vrchat.cloud/api/1",
            FavoriteCacheSnapshotInput {
                kind: FavoriteCacheKind::World,
                entity: RawJson::from(json!({
                    "name": "Fallback world",
                    "releaseStatus": "public",
                    "imageUrl": "https://example.test/world.png"
                })),
                fallback_entity_id: "wrld_fallback".into(),
            },
        )
        .unwrap());

        assert_eq!(
            world_cache.get_name("wrld_fallback").as_deref(),
            Some("Fallback world")
        );
    }
}
