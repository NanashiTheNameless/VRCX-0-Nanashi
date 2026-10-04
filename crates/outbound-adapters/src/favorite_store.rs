use std::sync::Arc;

use vrcx_0_application::favorites::{FavoriteMoveResult, FavoriteStore};
use vrcx_0_application_core::Result;
use vrcx_0_contracts::{
    social_aggregates::{FavoriteLocalInput, FavoriteOutput},
    FavoriteRow,
};
use vrcx_0_core::{FavoriteEntityKind, OwnerId};
use vrcx_0_persistence::{
    config::{get_json, resolve_config_key, set_json},
    favorites, social_aggregates, DatabaseService,
};

pub struct LocalFavoriteStore {
    db: Arc<DatabaseService>,
}

impl LocalFavoriteStore {
    pub fn new(db: Arc<DatabaseService>) -> Self {
        Self { db }
    }
}

impl FavoriteStore for LocalFavoriteStore {
    fn config_json(&self, key: &str, fallback: serde_json::Value) -> Result<serde_json::Value> {
        get_json(self.db.as_ref(), key, fallback).map_err(Into::into)
    }

    fn set_config_json(&self, key: &str, value: serde_json::Value) -> Result<()> {
        set_json(self.db.as_ref(), key, &value).map_err(Into::into)
    }

    fn resolve_config_key(&self, key: &str) -> String {
        resolve_config_key(key)
    }

    fn list(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
    ) -> Result<Vec<FavoriteRow>> {
        favorites::favorite_list(self.db.as_ref(), owner_user_id, kind).map_err(Into::into)
    }

    fn list_custom_order(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
    ) -> Result<Vec<FavoriteRow>> {
        favorites::favorite_list_custom_order(self.db.as_ref(), owner_user_id, kind)
            .map_err(Into::into)
    }

    fn add(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        entity_id: String,
        group_name: String,
    ) -> Result<i64> {
        favorites::favorite_add(self.db.as_ref(), owner_user_id, kind, entity_id, group_name)
            .map_err(Into::into)
    }

    fn remove(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        entity_id: String,
        group_name: String,
    ) -> Result<i64> {
        favorites::favorite_remove(self.db.as_ref(), owner_user_id, kind, entity_id, group_name)
            .map_err(Into::into)
    }

    fn move_between_groups(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        entity_id: String,
        source_group_name: String,
        target_group_name: String,
    ) -> Result<FavoriteMoveResult> {
        let result = favorites::favorite_move(
            self.db.as_ref(),
            owner_user_id,
            kind,
            entity_id,
            source_group_name,
            target_group_name,
        )?;
        Ok(FavoriteMoveResult {
            removed: result.removed,
            added: result.added,
        })
    }

    fn reorder(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        group_name: String,
        entity_ids: Vec<String>,
    ) -> Result<i64> {
        favorites::favorite_reorder(
            self.db.as_ref(),
            owner_user_id,
            kind,
            group_name,
            entity_ids,
        )
        .map_err(Into::into)
    }

    fn rename_group_with_config(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        config_key: &str,
        group_name: &str,
        new_group_name: &str,
        groups: &[String],
    ) -> Result<i64> {
        favorites::favorite_group_rename_with_config(
            self.db.as_ref(),
            owner_user_id,
            kind,
            config_key,
            group_name,
            new_group_name,
            groups,
        )
        .map_err(Into::into)
    }

    fn delete_group_with_config(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        config_key: &str,
        group_name: &str,
        groups: &[String],
    ) -> Result<i64> {
        favorites::favorite_group_delete_with_config(
            self.db.as_ref(),
            owner_user_id,
            kind,
            config_key,
            group_name,
            groups,
        )
        .map_err(Into::into)
    }

    fn mutate_local(
        &self,
        owner_user_id: &OwnerId,
        input: FavoriteLocalInput,
    ) -> Result<FavoriteOutput> {
        social_aggregates::favorite_local(self.db.as_ref(), owner_user_id, input)
            .map_err(Into::into)
    }
}
