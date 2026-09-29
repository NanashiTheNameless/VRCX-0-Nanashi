use vrcx_0_contracts::{
    social_aggregates::{FavoriteLocalInput, FavoriteOutput},
    FavoriteRow,
};

use vrcx_0_application_core::{
    config_string_array_value, normalize_config_string_array, FavoriteChange, FavoriteChangeScope,
    FavoriteEntityKind, FavoritesChangedPayload, RuntimeEventBus,
};
use vrcx_0_application_core::{AuthenticatedMutationContext, Result};
use vrcx_0_core::OwnerId;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FavoriteMoveResult {
    pub removed: i64,
    pub added: i64,
}

pub trait FavoriteStore: Send + Sync {
    fn config_json(&self, key: &str, fallback: serde_json::Value) -> Result<serde_json::Value>;
    fn set_config_json(&self, key: &str, value: serde_json::Value) -> Result<()>;
    fn resolve_config_key(&self, key: &str) -> String;
    fn list(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
    ) -> Result<Vec<FavoriteRow>>;
    fn add(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        entity_id: String,
        group_name: String,
    ) -> Result<i64>;
    fn remove(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        entity_id: String,
        group_name: String,
    ) -> Result<i64>;
    fn move_between_groups(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        entity_id: String,
        source_group_name: String,
        target_group_name: String,
    ) -> Result<FavoriteMoveResult>;
    fn rename_group_with_config(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        config_key: &str,
        group_name: &str,
        new_group_name: &str,
        groups: &[String],
    ) -> Result<i64>;
    fn delete_group_with_config(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        config_key: &str,
        group_name: &str,
        groups: &[String],
    ) -> Result<i64>;
    fn mutate_local(
        &self,
        owner_user_id: &OwnerId,
        input: FavoriteLocalInput,
    ) -> Result<FavoriteOutput>;
}

#[derive(Clone, Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalFavoriteGroupWrite {
    pub config_key: String,
    pub group_names: Vec<String>,
    pub affected: i64,
}

#[derive(Clone, Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalFavoriteSnapshot {
    pub favorites: Vec<FavoriteRow>,
    pub group_names: Vec<String>,
}

pub(super) struct LocalFavoriteMutationDeps<'a> {
    pub store: &'a dyn FavoriteStore,
    pub event_bus: &'a RuntimeEventBus,
    pub mutation: AuthenticatedMutationContext<'a>,
}

pub(super) fn read_config_string_array(
    store: &dyn FavoriteStore,
    key: &str,
) -> Result<Vec<String>> {
    let parsed = store.config_json(key, serde_json::Value::Null)?;
    Ok(normalize_config_string_array(parsed))
}

fn write_config_string_array(
    store: &dyn FavoriteStore,
    key: &str,
    values: &[String],
) -> Result<()> {
    store.set_config_json(key, config_string_array_value(values))
}

fn notify_local_favorite_change(
    deps: &LocalFavoriteMutationDeps<'_>,
    kind: FavoriteEntityKind,
    change: FavoriteChange,
) {
    let payload = if kind == FavoriteEntityKind::World {
        FavoritesChangedPayload::invalidated(
            deps.mutation.scope(),
            FavoriteChangeScope::World,
            true,
            false,
        )
    } else {
        FavoritesChangedPayload::from_changes(
            deps.mutation.scope(),
            kind.into(),
            true,
            false,
            vec![change],
        )
    };
    deps.event_bus.emit_favorites_changed(payload);
}

pub(super) fn add_local_favorite_scoped(
    deps: &LocalFavoriteMutationDeps<'_>,
    kind: FavoriteEntityKind,
    entity_id: String,
    group_name: String,
) -> Result<i64> {
    deps.mutation.ensure_current()?;
    let affected = add_local_favorite(
        deps.store,
        &OwnerId::new(deps.mutation.scope().current_user_id.clone()),
        kind,
        entity_id.clone(),
        group_name.clone(),
    )?;
    deps.mutation.ensure_current()?;
    notify_local_favorite_change(
        deps,
        kind,
        FavoriteChange::LocalAdded {
            kind,
            entity_id,
            group_name,
        },
    );
    Ok(affected)
}

pub(super) fn remove_local_favorite_scoped(
    deps: &LocalFavoriteMutationDeps<'_>,
    kind: FavoriteEntityKind,
    entity_id: String,
    group_name: String,
) -> Result<i64> {
    deps.mutation.ensure_current()?;
    let affected = remove_local_favorite(
        deps.store,
        &OwnerId::new(deps.mutation.scope().current_user_id.clone()),
        kind,
        entity_id.clone(),
        group_name.clone(),
    )?;
    deps.mutation.ensure_current()?;
    notify_local_favorite_change(
        deps,
        kind,
        FavoriteChange::LocalRemoved {
            kind,
            entity_id,
            group_name,
        },
    );
    Ok(affected)
}

pub fn list_local_favorites(
    store: &dyn FavoriteStore,
    owner_user_id: &OwnerId,
    kind: FavoriteEntityKind,
) -> Result<Vec<FavoriteRow>> {
    store.list(Some(owner_user_id), kind)
}

pub fn get_local_favorite_snapshot(
    store: &dyn FavoriteStore,
    owner_user_id: &OwnerId,
    kind: FavoriteEntityKind,
) -> Result<LocalFavoriteSnapshot> {
    let favorites = list_local_favorites(store, owner_user_id, kind)?;
    let mut group_names = read_config_string_array(store, local_group_config_key(kind))?;
    if kind == FavoriteEntityKind::Friend && !owner_user_id.as_str().trim().is_empty() {
        group_names.extend(read_config_string_array(
            store,
            &writable_group_config_key(kind, owner_user_id),
        )?);
        group_names.sort();
        group_names.dedup();
    }
    Ok(LocalFavoriteSnapshot {
        favorites,
        group_names,
    })
}

pub(crate) fn add_local_favorite(
    store: &dyn FavoriteStore,
    owner_user_id: &OwnerId,
    kind: FavoriteEntityKind,
    entity_id: String,
    group_name: String,
) -> Result<i64> {
    store.add(Some(owner_user_id), kind, entity_id, group_name)
}

pub(crate) fn remove_local_favorite(
    store: &dyn FavoriteStore,
    owner_user_id: &OwnerId,
    kind: FavoriteEntityKind,
    entity_id: String,
    group_name: String,
) -> Result<i64> {
    store.remove(Some(owner_user_id), kind, entity_id, group_name)
}

pub(super) const fn local_group_config_key(kind: FavoriteEntityKind) -> &'static str {
    match kind {
        FavoriteEntityKind::Friend => "localFavoriteFriendGroups",
        FavoriteEntityKind::Avatar => "localFavoriteAvatarGroups",
        FavoriteEntityKind::World => "localFavoriteWorldGroups",
    }
}

fn add_group_value(groups: &mut Vec<String>, group_name: &str) {
    if groups.iter().any(|value| value == group_name) {
        return;
    }
    groups.push(group_name.to_string());
    groups.sort();
    groups.dedup();
}

pub(crate) fn create_local_favorite_group(
    store: &dyn FavoriteStore,
    owner_user_id: &OwnerId,
    kind: FavoriteEntityKind,
    group_name: String,
) -> Result<LocalFavoriteGroupWrite> {
    let key = writable_group_config_key(kind, owner_user_id);
    let mut groups = read_config_string_array(store, &key)?;
    add_group_value(&mut groups, &group_name);
    write_config_string_array(store, &key, &groups)?;
    Ok(LocalFavoriteGroupWrite {
        config_key: store.resolve_config_key(&key),
        group_names: groups,
        affected: 0,
    })
}

pub(super) fn create_local_favorite_group_scoped(
    deps: &LocalFavoriteMutationDeps<'_>,
    kind: FavoriteEntityKind,
    group_name: String,
) -> Result<LocalFavoriteGroupWrite> {
    deps.mutation.ensure_current()?;
    let write = create_local_favorite_group(
        deps.store,
        &OwnerId::new(deps.mutation.scope().current_user_id.clone()),
        kind,
        group_name.clone(),
    )?;
    deps.mutation.ensure_current()?;
    notify_local_favorite_change(
        deps,
        kind,
        FavoriteChange::LocalGroupCreated { kind, group_name },
    );
    Ok(write)
}

pub(crate) fn rename_local_favorite_group(
    store: &dyn FavoriteStore,
    owner_user_id: &OwnerId,
    kind: FavoriteEntityKind,
    group_name: String,
    new_group_name: String,
) -> Result<LocalFavoriteGroupWrite> {
    let key = group_config_realm_key(store, kind, owner_user_id, &group_name)?;
    let mut groups = read_config_string_array(store, &key)?
        .into_iter()
        .filter(|value| value != &group_name)
        .collect::<Vec<_>>();
    add_group_value(&mut groups, &new_group_name);
    let affected = store.rename_group_with_config(
        Some(owner_user_id),
        kind,
        &key,
        &group_name,
        &new_group_name,
        &groups,
    )?;
    Ok(LocalFavoriteGroupWrite {
        config_key: store.resolve_config_key(&key),
        group_names: groups,
        affected,
    })
}

pub(super) fn rename_local_favorite_group_scoped(
    deps: &LocalFavoriteMutationDeps<'_>,
    kind: FavoriteEntityKind,
    group_name: String,
    new_group_name: String,
) -> Result<LocalFavoriteGroupWrite> {
    deps.mutation.ensure_current()?;
    let write = rename_local_favorite_group(
        deps.store,
        &OwnerId::new(deps.mutation.scope().current_user_id.clone()),
        kind,
        group_name.clone(),
        new_group_name.clone(),
    )?;
    deps.mutation.ensure_current()?;
    notify_local_favorite_change(
        deps,
        kind,
        FavoriteChange::LocalGroupRenamed {
            kind,
            group_name,
            new_group_name,
        },
    );
    Ok(write)
}

pub(crate) fn delete_local_favorite_group(
    store: &dyn FavoriteStore,
    owner_user_id: &OwnerId,
    kind: FavoriteEntityKind,
    group_name: String,
) -> Result<LocalFavoriteGroupWrite> {
    let key = group_config_realm_key(store, kind, owner_user_id, &group_name)?;
    let groups = read_config_string_array(store, &key)?
        .into_iter()
        .filter(|value| value != &group_name)
        .collect::<Vec<_>>();
    let affected =
        store.delete_group_with_config(Some(owner_user_id), kind, &key, &group_name, &groups)?;
    Ok(LocalFavoriteGroupWrite {
        config_key: store.resolve_config_key(&key),
        group_names: groups,
        affected,
    })
}

pub(super) fn delete_local_favorite_group_scoped(
    deps: &LocalFavoriteMutationDeps<'_>,
    kind: FavoriteEntityKind,
    group_name: String,
) -> Result<LocalFavoriteGroupWrite> {
    deps.mutation.ensure_current()?;
    let write = delete_local_favorite_group(
        deps.store,
        &OwnerId::new(deps.mutation.scope().current_user_id.clone()),
        kind,
        group_name.clone(),
    )?;
    deps.mutation.ensure_current()?;
    notify_local_favorite_change(
        deps,
        kind,
        FavoriteChange::LocalGroupDeleted { kind, group_name },
    );
    Ok(write)
}

fn writable_group_config_key(kind: FavoriteEntityKind, owner_user_id: &OwnerId) -> String {
    let base_key = local_group_config_key(kind);
    if kind == FavoriteEntityKind::Friend && !owner_user_id.as_str().trim().is_empty() {
        format!("{base_key}:{}", owner_user_id.as_str().trim())
    } else {
        base_key.to_string()
    }
}

fn group_config_realm_key(
    store: &dyn FavoriteStore,
    kind: FavoriteEntityKind,
    owner_user_id: &OwnerId,
    group_name: &str,
) -> Result<String> {
    let account_key = writable_group_config_key(kind, owner_user_id);
    if kind != FavoriteEntityKind::Friend
        || read_config_string_array(store, &account_key)?
            .iter()
            .any(|value| value == group_name)
    {
        Ok(account_key)
    } else {
        Ok(local_group_config_key(kind).to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::favorites::test_support::TestFavoriteStore;

    #[test]
    fn friend_group_writes_use_account_or_shared_realm() {
        let store = TestFavoriteStore::default();

        create_local_favorite_group(
            &store,
            &OwnerId::new("usr_a"),
            FavoriteEntityKind::Friend,
            "account".into(),
        )
        .unwrap();
        create_local_favorite_group(
            &store,
            &OwnerId::new(""),
            FavoriteEntityKind::Friend,
            "legacy".into(),
        )
        .unwrap();
        assert_eq!(
            read_config_string_array(&store, "localFavoriteFriendGroups:usr_a").unwrap(),
            vec!["account"]
        );
        assert_eq!(
            read_config_string_array(&store, "localFavoriteFriendGroups").unwrap(),
            vec!["legacy"]
        );

        store
            .add(
                Some(&OwnerId::new("usr_a")),
                FavoriteEntityKind::Friend,
                "usr_account_friend".into(),
                "account".into(),
            )
            .unwrap();
        store
            .add(
                None,
                FavoriteEntityKind::Friend,
                "usr_legacy_friend".into(),
                "legacy".into(),
            )
            .unwrap();

        rename_local_favorite_group(
            &store,
            &OwnerId::new("usr_a"),
            FavoriteEntityKind::Friend,
            "account".into(),
            "renamed".into(),
        )
        .unwrap();
        delete_local_favorite_group(
            &store,
            &OwnerId::new("usr_a"),
            FavoriteEntityKind::Friend,
            "legacy".into(),
        )
        .unwrap();

        let groups = store
            .list(Some(&OwnerId::new("usr_a")), FavoriteEntityKind::Friend)
            .unwrap()
            .into_iter()
            .map(|row| row.group_name)
            .collect::<Vec<_>>();
        assert_eq!(groups, vec!["renamed"]);
        assert_eq!(
            read_config_string_array(&store, "localFavoriteFriendGroups:usr_a").unwrap(),
            vec!["renamed"]
        );
        assert!(
            read_config_string_array(&store, "localFavoriteFriendGroups")
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn local_world_snapshot_reads_favorites_and_explicit_groups_together() {
        let store = TestFavoriteStore::default();
        write_config_string_array(
            &store,
            "localFavoriteWorldGroups",
            &["Empty".into(), "Worlds".into()],
        )
        .unwrap();
        store
            .add(
                Some(&OwnerId::new("usr_a")),
                FavoriteEntityKind::World,
                "wrld_1".into(),
                "Worlds".into(),
            )
            .unwrap();

        let snapshot =
            get_local_favorite_snapshot(&store, &OwnerId::new("usr_a"), FavoriteEntityKind::World)
                .unwrap();

        assert_eq!(snapshot.group_names, vec!["Empty", "Worlds"]);
        assert_eq!(snapshot.favorites.len(), 1);
        assert_eq!(snapshot.favorites[0].world_id.as_deref(), Some("wrld_1"));
        assert_eq!(snapshot.favorites[0].group_name, "Worlds");
    }

    #[test]
    fn account_group_rename_targets_account_config_key_when_shared_realm_has_same_name() {
        let store = TestFavoriteStore::default();
        write_config_string_array(&store, "localFavoriteFriendGroups", &["same".into()]).unwrap();
        write_config_string_array(&store, "localFavoriteFriendGroups:usr_a", &["same".into()])
            .unwrap();

        let write = rename_local_favorite_group(
            &store,
            &OwnerId::new("usr_a"),
            FavoriteEntityKind::Friend,
            "same".into(),
            "account-only".into(),
        )
        .unwrap();

        assert_eq!(write.config_key, "localFavoriteFriendGroups:usr_a");
        assert_eq!(write.group_names, vec!["account-only"]);
        assert_eq!(
            read_config_string_array(&store, "localFavoriteFriendGroups").unwrap(),
            vec!["same"]
        );
    }
}
