use futures_util::future::BoxFuture;

use std::sync::Arc;

use serde_json::Value;
use vrcx_0_application::collections::{
    SharedCollectionImportActions, SharedCollectionImportActionsFactory, WorldCollectionFuture,
    WorldCollectionRemote,
};
use vrcx_0_application_core::{FavoriteEntityKind, WorldCache};
use vrcx_0_contracts::world_collections::WorldCollectionSnapshotResponse;
use vrcx_0_persistence::DatabaseService;

/// Credential-free read access to public collections on the selected RemoteSync instance.
#[derive(Clone)]
pub struct LocalWorldCollectionAdapter {
    api_origin: String,
}

impl LocalWorldCollectionAdapter {
    pub fn new(api_origin: String) -> Self {
        Self { api_origin }
    }
}

impl WorldCollectionRemote for LocalWorldCollectionAdapter {
    fn fetch_collection<'a>(
        &'a self,
        id: &'a str,
    ) -> WorldCollectionFuture<'a, WorldCollectionSnapshotResponse> {
        Box::pin(async move {
            vrcx_0_integrations::world_collections::fetch_world_collection(&self.api_origin, id)
                .await
                .map_err(|error| crate::Error::Custom(error.to_string()))
        })
    }
}

pub struct LocalSharedCollectionImportActionsFactory {
    db: Arc<DatabaseService>,
    world_cache: Arc<WorldCache>,
}

impl LocalSharedCollectionImportActionsFactory {
    pub fn new(db: Arc<DatabaseService>, world_cache: Arc<WorldCache>) -> Self {
        Self { db, world_cache }
    }
}

impl SharedCollectionImportActionsFactory for LocalSharedCollectionImportActionsFactory {
    fn create(&self, endpoint: String) -> Arc<dyn SharedCollectionImportActions> {
        Arc::new(LocalSharedCollectionImportActions {
            db: Arc::clone(&self.db),
            world_cache: Arc::clone(&self.world_cache),
            endpoint,
        })
    }
}

struct LocalSharedCollectionImportActions {
    db: Arc<DatabaseService>,
    world_cache: Arc<WorldCache>,
    endpoint: String,
}

impl SharedCollectionImportActions for LocalSharedCollectionImportActions {
    fn create_group(&self, group_name: &str) -> crate::Result<i64> {
        vrcx_0_persistence::favorites::favorite_group_create(
            self.db.as_ref(),
            None,
            FavoriteEntityKind::World,
            group_name,
        )
        .map(|group| group.id)
        .map_err(crate::Error::from)
    }

    fn fetch_and_cache_world<'a>(&'a self, world_id: &'a str) -> BoxFuture<'a, crate::Result<()>> {
        Box::pin(async move {
            let response = self
                .world_cache
                .get(&self.endpoint, world_id, true, false)
                .await?;
            if !(200..=299).contains(&response.status) {
                return Err(crate::Error::Custom(format!(
                    "World lookup failed with status {}.",
                    response.status
                )));
            }
            let world: Value = serde_json::from_str(&response.data)
                .map_err(|error| crate::Error::Custom(format!("Invalid world payload: {error}")))?;
            let response_world_id = world
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if response_world_id != world_id {
                return Err(crate::Error::Custom(
                    "World payload id did not match request.".into(),
                ));
            }
            self.world_cache
                .hydrate_from_payload(&world)
                .ok_or_else(|| crate::Error::Custom("World payload could not be cached.".into()))?;
            Ok(())
        })
    }

    fn add_world_favorite(&self, world_id: &str, group_id: i64) -> crate::Result<()> {
        vrcx_0_persistence::favorites::favorite_add(
            self.db.as_ref(),
            None,
            FavoriteEntityKind::World,
            world_id.to_string(),
            group_id,
        )
        .map(|_| ())
        .map_err(crate::Error::from)
    }
}
