use vrcx_0_contracts::{SavedGroupCollection, SavedGroupFavoritesSnapshot};
use vrcx_0_core::OwnerId;

use crate::common::{normalize_text, row_string, ParamsBuilder};
use crate::database::schema::ensure_global_store_tables;
use crate::ownership::{owner_id_for_filter, owner_id_get_or_insert};
use crate::{DatabaseService, Error};

pub fn snapshot(
    db: &DatabaseService,
    owner: &OwnerId,
) -> Result<SavedGroupFavoritesSnapshot, Error> {
    ensure_global_store_tables(db)?;
    let owner_id = owner_id_for_filter(db, owner)?.value();
    if owner_id == 0 {
        return Ok(SavedGroupFavoritesSnapshot::default());
    }
    let collections = db
        .execute(
            "SELECT id, name, group_ids, created_at FROM favorite_group_collection WHERE owner_id = @owner_id ORDER BY created_at, id",
            &ParamsBuilder::new().set("owner_id", owner_id).build(),
        )?
        .into_iter()
        .map(|row| SavedGroupCollection {
            id: row_string(&row, 0),
            name: row_string(&row, 1),
            group_ids: parse_group_ids(&row_string(&row, 2)),
            created_at: row_string(&row, 3),
        })
        .collect();
    Ok(SavedGroupFavoritesSnapshot { collections })
}

pub fn create_collection(
    db: &DatabaseService,
    owner: &OwnerId,
    collection_id: &str,
    name: &str,
) -> Result<i64, Error> {
    ensure_global_store_tables(db)?;
    let owner_id = owner_id_get_or_insert(db, owner)?.value();
    db.execute_non_query(
        "INSERT INTO favorite_group_collection (id, owner_id, name, group_ids, created_at) VALUES (@id, @owner_id, @name, '[]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        &ParamsBuilder::new()
            .set("id", normalize_text(collection_id))
            .set("owner_id", owner_id)
            .set("name", normalize_text(name))
            .build(),
    )
}

pub fn delete_collection(
    db: &DatabaseService,
    owner: &OwnerId,
    collection_id: &str,
) -> Result<i64, Error> {
    ensure_global_store_tables(db)?;
    let owner_id = owner_id_for_filter(db, owner)?.value();
    db.execute_non_query(
        "DELETE FROM favorite_group_collection WHERE owner_id = @owner_id AND id = @id",
        &ParamsBuilder::new()
            .set("owner_id", owner_id)
            .set("id", normalize_text(collection_id))
            .build(),
    )
}

pub fn add_group(
    db: &DatabaseService,
    owner: &OwnerId,
    collection_id: &str,
    group_id: &str,
) -> Result<i64, Error> {
    ensure_global_store_tables(db)?;
    let owner_id = owner_id_get_or_insert(db, owner)?.value();
    let collection_id = normalize_text(collection_id);
    let group_id = normalize_text(group_id);
    db.write_transaction(|tx| {
        let rows = tx.execute(
            "SELECT id, group_ids FROM favorite_group_collection WHERE owner_id = @owner_id ORDER BY created_at, id",
            &ParamsBuilder::new().set("owner_id", owner_id).build(),
        )?;
        let mut target = None;
        for row in rows {
            let id = row_string(&row, 0);
            let group_ids = parse_group_ids(&row_string(&row, 1));
            if group_ids.iter().any(|candidate| candidate == &group_id) {
                return Err(Error::Custom("Group is already saved.".into()));
            }
            if id == collection_id {
                target = Some(group_ids);
            }
        }
        let Some(mut group_ids) = target else {
            return Err(Error::Custom("Saved group collection was not found.".into()));
        };
        group_ids.push(group_id);
        tx.execute_non_query(
            "UPDATE favorite_group_collection SET group_ids = @group_ids WHERE owner_id = @owner_id AND id = @id",
            &ParamsBuilder::new()
                .set("group_ids", serde_json::to_string(&group_ids)?)
                .set("owner_id", owner_id)
                .set("id", collection_id)
                .build(),
        )
    })
}

pub fn remove_group(db: &DatabaseService, owner: &OwnerId, group_id: &str) -> Result<i64, Error> {
    ensure_global_store_tables(db)?;
    let owner_id = owner_id_for_filter(db, owner)?.value();
    let group_id = normalize_text(group_id);
    db.write_transaction(|tx| {
        let rows = tx.execute(
            "SELECT id, group_ids FROM favorite_group_collection WHERE owner_id = @owner_id ORDER BY created_at, id",
            &ParamsBuilder::new().set("owner_id", owner_id).build(),
        )?;
        for row in rows {
            let collection_id = row_string(&row, 0);
            let mut group_ids = parse_group_ids(&row_string(&row, 1));
            let original_len = group_ids.len();
            group_ids.retain(|candidate| candidate != &group_id);
            if group_ids.len() == original_len {
                continue;
            }
            return tx.execute_non_query(
                "UPDATE favorite_group_collection SET group_ids = @group_ids WHERE owner_id = @owner_id AND id = @id",
                &ParamsBuilder::new()
                    .set("group_ids", serde_json::to_string(&group_ids)?)
                    .set("owner_id", owner_id)
                    .set("id", collection_id)
                    .build(),
            );
        }
        Ok(0)
    })
}

fn parse_group_ids(value: &str) -> Vec<String> {
    let mut group_ids = Vec::new();
    for group_id in serde_json::from_str::<Vec<String>>(value).unwrap_or_default() {
        let group_id = normalize_text(&group_id);
        if group_id.starts_with("grp_") && !group_ids.contains(&group_id) {
            group_ids.push(group_id);
        }
    }
    group_ids
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path =
                std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn test_db(name: &str) -> (TestDir, DatabaseService) {
        let dir = TestDir::new(name);
        let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap();
        (dir, db)
    }

    #[test]
    fn one_table_crud_is_owner_scoped_and_keeps_groups_unique() {
        let (_dir, db) = test_db("saved-group-favorites");
        let owner_a = OwnerId::new("usr_owner_a");
        let owner_b = OwnerId::new("usr_owner_b");

        create_collection(&db, &owner_a, "collection-a", "常用").unwrap();
        create_collection(&db, &owner_a, "collection-b", "活动").unwrap();
        create_collection(&db, &owner_b, "collection-c", "常用").unwrap();
        add_group(&db, &owner_a, "collection-a", "grp_one").unwrap();

        assert!(add_group(&db, &owner_a, "collection-b", "grp_one").is_err());
        assert_eq!(
            snapshot(&db, &owner_a).unwrap().collections[0].group_ids,
            vec!["grp_one"]
        );
        assert!(snapshot(&db, &owner_b).unwrap().collections[0]
            .group_ids
            .is_empty());

        remove_group(&db, &owner_a, "grp_one").unwrap();
        assert!(snapshot(&db, &owner_a).unwrap().collections[0]
            .group_ids
            .is_empty());

        add_group(&db, &owner_a, "collection-b", "grp_two").unwrap();
        delete_collection(&db, &owner_a, "collection-b").unwrap();
        assert_eq!(snapshot(&db, &owner_a).unwrap().collections.len(), 1);
    }
}
