use super::*;
use serde_json::json;
use vrcx_0_application_core::{AvatarCache, MemoryWorldCachePort, NoopAvatarCachePort};

use crate::favorites::test_support::TestFavoriteRemote;

const HYDRATE_TEST_ENDPOINT: &str = "https://api.vrchat.cloud/api/1";

fn world_row(id: &str, name: &str) -> Value {
    json!({
        "id": id,
        "name": name,
        "authorId": "usr_author",
        "authorName": "Author",
        "description": "Description",
        "imageUrl": "https://example.test/world.png",
        "releaseStatus": "public",
        "thumbnailImageUrl": "https://example.test/thumb.png",
        "tags": ["author_tag_example"],
        "occupants": 7,
        "unityPackages": [{ "assetUrl": "https://example.test/large.bundle" }],
        "instances": [["123", 4]]
    })
}

struct WorldHydrateHarness {
    runtime: FavoriteDetailsRuntime,
    remote: Arc<TestFavoriteRemote>,
    world_cache: Arc<WorldCache>,
    auth_scope: RuntimeAuthScope,
    scope: RuntimeAuthScopeSnapshot,
}

impl WorldHydrateHarness {
    fn new() -> Self {
        let remote = Arc::new(TestFavoriteRemote::with_favorite_worlds([
            (
                "group1",
                vec![
                    world_row("wrld_requested", "Requested World"),
                    world_row("wrld_unrequested", "Unrequested World"),
                ],
            ),
            ("group2", vec![world_row("wrld_other", "Other World")]),
        ]));
        let auth_scope = RuntimeAuthScope::new();
        auth_scope.set("usr_self", HYDRATE_TEST_ENDPOINT);
        let world_cache = Arc::new(WorldCache::new(MemoryWorldCachePort::default()));
        let scope = auth_scope.snapshot();
        let runtime = FavoriteDetailsRuntime::new(
            Arc::clone(&remote) as Arc<dyn super::super::FavoriteRemote>,
            auth_scope.clone(),
            Arc::clone(&world_cache),
            Arc::new(AvatarCache::new(NoopAvatarCachePort)),
            TaskSupervisor::new(),
        );
        Self {
            runtime,
            remote,
            world_cache,
            auth_scope,
            scope,
        }
    }

    fn switch_account(&mut self, user_id: &str) {
        self.auth_scope.set(user_id, HYDRATE_TEST_ENDPOINT);
        self.scope = self.auth_scope.snapshot();
    }

    async fn hydrate(&self, group_tags: &[&str], requested_ids: &[&str]) -> HydrateSnapshot {
        self.run(group_tags, requested_ids, requested_ids).await
    }

    async fn hydrate_local(&self, requested_ids: &[&str]) -> HydrateSnapshot {
        self.run(&[], &[], requested_ids).await
    }

    async fn run(
        &self,
        group_tags: &[&str],
        favorite_ids: &[&str],
        requested_ids: &[&str],
    ) -> HydrateSnapshot {
        let output = self
            .runtime
            .hydrate(
                FavoriteDetailsHydrateInput {
                    kind: FavoriteDetailsHydrateKind::World,
                    favorite_ids: favorite_ids.iter().map(|id| (*id).to_string()).collect(),
                    requested_ids: requested_ids.iter().map(|id| (*id).to_string()).collect(),
                    avatar_tags: Vec::new(),
                    group_tags: group_tags.iter().map(|tag| (*tag).to_string()).collect(),
                },
                self.scope.clone(),
            )
            .await
            .unwrap();
        HydrateSnapshot {
            details_by_id: output
                .details_by_id
                .into_iter()
                .map(|(id, detail)| (id, detail.into_value()))
                .collect(),
            availability_by_id: output.availability_by_id,
        }
    }
}

struct HydrateSnapshot {
    details_by_id: HashMap<String, Value>,
    availability_by_id: HashMap<String, String>,
}

fn complete(release_status: &str) -> Value {
    json!({
        "id": "avtr_1",
        "name": "Entity",
        "releaseStatus": release_status,
        "thumbnailImageUrl": "https://example.test/thumb.png",
    })
}

#[test]
fn avatar_decision_upserts_public_complete_snapshots() {
    assert_eq!(
        cache_write_decision(FavoriteCacheKind::Avatar, &complete("public")),
        CacheWriteDecision::Upsert
    );
}

#[test]
fn avatar_decision_normalizes_release_status_case_and_whitespace() {
    let mut entity = complete("  Public  ");
    assert_eq!(
        cache_write_decision(FavoriteCacheKind::Avatar, &entity),
        CacheWriteDecision::Upsert
    );
    entity["imageUrl"] = json!("https://example.test/image.png");
    entity["thumbnailImageUrl"] = json!("   ");
    assert_eq!(
        cache_write_decision(FavoriteCacheKind::Avatar, &entity),
        CacheWriteDecision::Upsert
    );
}

#[test]
fn world_decision_skips_incomplete_snapshots() {
    assert_eq!(
        cache_write_decision(
            FavoriteCacheKind::World,
            &json!({
                "id": "wrld_1",
                "name": "World",
                "releaseStatus": "public",
            })
        ),
        CacheWriteDecision::Skip
    );
}

#[test]
fn filter_keeps_only_requested_favorite_ids() {
    let entities = vec![
        json!({ "id": "wrld_1", "name": "One" }),
        json!({ "id": " wrld_2 ", "name": "Two" }),
        json!({ "id": "wrld_3", "name": "Three" }),
        json!({ "name": "No id" }),
    ];

    let details = filter_details_by_id(entities, &["wrld_2".into(), " wrld_3 ".into()]);

    assert_eq!(details.len(), 2);
    assert!(details.contains_key("wrld_2"));
    assert!(details.contains_key("wrld_3"));
}

#[test]
fn filter_keeps_everything_when_favorite_ids_are_empty() {
    let entities = vec![
        json!({ "id": "wrld_1" }),
        json!({ "id": "wrld_2" }),
        json!({ "name": "No id" }),
    ];

    let details = filter_details_by_id(entities, &[]);

    assert_eq!(details.len(), 2);
}

#[test]
fn merge_avatar_rows_deduplicates_across_tag_pages() {
    let mut seen_ids = HashSet::new();
    let mut entities = Vec::new();

    merge_avatar_rows(
        vec![
            json!({ "id": "avtr_1", "name": "First" }),
            json!({ "id": "avtr_2" }),
        ],
        &mut seen_ids,
        &mut entities,
    );
    merge_avatar_rows(
        vec![
            json!({ "id": " avtr_1 ", "name": "Duplicate" }),
            json!({ "id": "" }),
            json!({ "id": "avtr_3" }),
        ],
        &mut seen_ids,
        &mut entities,
    );

    let ids = entities.iter().map(entity_id).collect::<Vec<_>>();
    assert_eq!(ids, vec!["avtr_1", "avtr_2", "avtr_3"]);
    assert_eq!(entities[0]["name"], json!("First"));
}

#[test]
fn normalize_avatar_tags_deduplicates_and_falls_back_to_single_untagged_round() {
    assert_eq!(
        normalize_avatar_tags(&[" one ".into(), "one".into(), "two".into(), "  ".into()]),
        vec!["one".to_string(), "two".to_string()]
    );
    assert_eq!(normalize_avatar_tags(&[]), vec![String::new()]);
    assert_eq!(normalize_avatar_tags(&["  ".into()]), vec![String::new()]);
}

#[test]
fn world_probe_marks_http_404_as_deleted() {
    assert_eq!(
        classify_world_probe(404, json!({ "error": { "message": "not found" } })),
        WorldProbeOutcome::Deleted
    );
}

#[test]
fn world_probe_failures_do_not_produce_availability() {
    assert_eq!(
        classify_world_probe(500, json!({ "message": "boom" })),
        WorldProbeOutcome::Failed
    );
    assert_eq!(
        classify_world_probe(200, json!({ "error": { "message": "soft error" } })),
        WorldProbeOutcome::Failed
    );
}

#[test]
fn world_probe_classifies_release_status_into_public_or_private() {
    let world = json!({ "id": "wrld_1", "name": "World", "releaseStatus": "Public" });
    assert_eq!(
        classify_world_probe(200, world.clone()),
        WorldProbeOutcome::Available(world, "public".to_string())
    );

    for status in ["private", "hidden", ""] {
        let world = json!({ "id": "wrld_1", "releaseStatus": status });
        assert_eq!(
            classify_world_probe(200, world.clone()),
            WorldProbeOutcome::Available(world, "private".to_string())
        );
    }
}

#[tokio::test]
async fn world_details_hydrate_fetches_the_requested_group_and_projects_card_fields() {
    let harness = WorldHydrateHarness::new();

    let output = harness.hydrate(&["group1"], &[" wrld_requested "]).await;

    assert_eq!(harness.remote.fetched_tags(), vec!["group1"]);
    assert_eq!(output.details_by_id.len(), 1);
    let requested = output.details_by_id.get("wrld_requested").unwrap();
    assert_eq!(requested["name"], "Requested World");
    assert_eq!(requested["tags"], json!(["author_tag_example"]));
    assert_eq!(requested["occupants"], 7);
    assert!(requested.get("unityPackages").is_none());
    assert!(requested.get("instances").is_none());
    assert_eq!(
        harness
            .world_cache
            .get_summary("wrld_unrequested")
            .unwrap()
            .unwrap()
            .name,
        "Unrequested World"
    );
}

#[tokio::test]
async fn world_details_hydrate_serves_a_second_group_switch_without_refetching() {
    let harness = WorldHydrateHarness::new();

    harness.hydrate(&["group1"], &["wrld_requested"]).await;
    let second = harness.hydrate(&["group2"], &["wrld_other"]).await;
    let third = harness.hydrate(&["group1"], &["wrld_requested"]).await;

    assert_eq!(harness.remote.fetched_tags(), vec!["group1", "group2"]);
    assert_eq!(second.details_by_id.len(), 1);
    assert_eq!(third.details_by_id.len(), 1);
}

#[tokio::test]
async fn world_details_hydrate_resolves_local_favorites_without_a_group_request() {
    let harness = WorldHydrateHarness::new();
    harness.world_cache.hydrate_from_payload(&json!({
        "id": "wrld_local",
        "name": "Local World",
        "imageUrl": "https://example.test/local.png",
        "releaseStatus": "private"
    }));

    let output = harness.hydrate_local(&["wrld_local"]).await;

    assert!(harness.remote.fetched_tags().is_empty());
    assert_eq!(
        output.details_by_id.get("wrld_local").unwrap()["name"],
        "Local World"
    );
}

#[tokio::test]
async fn switching_accounts_drops_cached_cards_and_refetches_the_group() {
    let mut harness = WorldHydrateHarness::new();
    harness.hydrate(&["group1"], &["wrld_requested"]).await;

    harness.switch_account("usr_other");
    harness.hydrate(&["group1"], &["wrld_requested"]).await;

    assert_eq!(harness.remote.fetched_tags(), vec!["group1", "group1"]);
}

#[tokio::test]
async fn refreshed_world_details_replace_the_cached_card_without_another_group_request() {
    let harness = WorldHydrateHarness::new();
    harness.hydrate(&["group1"], &["wrld_requested"]).await;

    harness
        .runtime
        .refresh_world_card(&world_row("wrld_requested", "Renamed World"))
        .await;
    let output = harness.hydrate(&["group1"], &["wrld_requested"]).await;

    assert_eq!(harness.remote.fetched_tags(), vec!["group1"]);
    assert_eq!(
        output.details_by_id.get("wrld_requested").unwrap()["name"],
        "Renamed World"
    );
}

#[tokio::test]
async fn invalidated_world_cards_resolve_refreshed_local_details() {
    let harness = WorldHydrateHarness::new();
    harness.world_cache.hydrate_from_payload(&json!({
        "id": "wrld_local",
        "name": "Local World",
        "imageUrl": "https://example.test/old.png",
        "releaseStatus": "private"
    }));
    harness.hydrate_local(&["wrld_local"]).await;
    harness.world_cache.hydrate_from_payload(&json!({
        "id": "wrld_local",
        "name": "Local World",
        "imageUrl": "https://example.test/new.png",
        "releaseStatus": "private"
    }));

    harness.runtime.invalidate_world_cards().await;
    let output = harness.hydrate_local(&["wrld_local"]).await;

    assert_eq!(
        output.details_by_id.get("wrld_local").unwrap()["imageUrl"],
        "https://example.test/new.png"
    );
}

#[tokio::test]
async fn world_details_hydrate_marks_cache_resolved_favorites_as_unverified() {
    let harness = WorldHydrateHarness::new();
    harness.world_cache.hydrate_from_payload(&json!({
        "id": "wrld_unreachable",
        "name": "Cached World",
        "imageUrl": "https://example.test/cached.png",
        "releaseStatus": "public"
    }));

    let output = harness.hydrate(&["group1"], &["wrld_unreachable"]).await;

    assert_eq!(
        output
            .availability_by_id
            .get("wrld_unreachable")
            .map(String::as_str),
        Some("unverified")
    );
    assert_eq!(
        output.details_by_id.get("wrld_unreachable").unwrap()["name"],
        "Cached World"
    );
}

#[tokio::test]
async fn world_details_hydrate_keeps_deleted_availability_without_probing_again() {
    let harness = WorldHydrateHarness::new();

    let first = harness.hydrate(&["group1"], &["wrld_deleted"]).await;
    let second = harness.hydrate(&["group1"], &["wrld_deleted"]).await;

    assert_eq!(harness.remote.probed_ids(), vec!["wrld_deleted"]);
    assert_eq!(
        first
            .availability_by_id
            .get("wrld_deleted")
            .map(String::as_str),
        Some("deleted")
    );
    assert_eq!(
        second
            .availability_by_id
            .get("wrld_deleted")
            .map(String::as_str),
        Some("deleted")
    );
    assert!(second.details_by_id.is_empty());
}

#[test]
fn cache_entry_maps_snake_and_camel_timestamps_with_version_fallback() {
    let entity = json!({
        "id": "avtr_1",
        "authorId": " usr_author ",
        "authorName": "Author",
        "createdAt": "2026-06-01T00:00:00.000Z",
        "updated_at": "2026-06-02T00:00:00.000Z",
        "description": "Desc",
        "imageUrl": "https://example.test/image.png",
        "name": "Entity",
        "releaseStatus": "public",
        "thumbnailImageUrl": "https://example.test/thumb.png",
        "version": 7,
    });

    let entry = cache_entry_from_entity(&entity, "avtr_fallback");

    assert_eq!(entry.id, json!("avtr_1"));
    assert_eq!(entry.author_id, json!("usr_author"));
    assert_eq!(entry.created_at, json!("2026-06-01T00:00:00.000Z"));
    assert_eq!(entry.updated_at, json!("2026-06-02T00:00:00.000Z"));
    assert_eq!(entry.version, json!(7));

    let sparse = json!({ "name": "Fallback", "version": "not-a-number" });
    let entry = cache_entry_from_entity(&sparse, " avtr_fallback ");
    assert_eq!(entry.id, json!("avtr_fallback"));
    assert_eq!(entry.version, json!(0));
}
