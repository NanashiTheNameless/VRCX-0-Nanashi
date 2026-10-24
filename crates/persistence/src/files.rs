use vrcx_0_contracts::FileMetadataOutput;

use crate::common::{normalize_text, now_epoch, row_string, ParamsBuilder};
use crate::database::schema::ensure_global_store_tables;
use crate::database::DatabaseService;
use crate::Error;

pub fn file_cache_get(
    db: &DatabaseService,
    file_id: impl AsRef<str>,
) -> Result<Option<FileMetadataOutput>, Error> {
    ensure_global_store_tables(db)?;
    let file_id = normalize_text(file_id);
    if file_id.is_empty() {
        return Ok(None);
    }
    Ok(db
        .execute(
            "SELECT id, name, owner_id FROM cache_file WHERE id = @file_id LIMIT 1",
            &ParamsBuilder::new().set("file_id", file_id).build(),
        )?
        .first()
        .map(|row| {
            FileMetadataOutput::new(row_string(row, 0), row_string(row, 1), row_string(row, 2))
        }))
}

pub fn file_cache_upsert(db: &DatabaseService, file: &FileMetadataOutput) -> Result<(), Error> {
    ensure_global_store_tables(db)?;
    let file_id = normalize_text(&file.id);
    if file_id.is_empty() {
        return Err(Error::InvalidData(
            "file cache upsert requires an id".into(),
        ));
    }
    db.execute_non_query(
        "INSERT INTO cache_file (id, name, owner_id, fetched_at) VALUES (@id, @name, @owner_id, @fetched_at) \
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, owner_id = excluded.owner_id, fetched_at = excluded.fetched_at",
        &ParamsBuilder::new()
            .set("id", file_id)
            .set("name", file.name.clone())
            .set("owner_id", file.owner_id.clone())
            .set("fetched_at", now_epoch())
            .build(),
    )?;
    Ok(())
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
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-files-{name}-{}-{nonce}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn upsert_then_get_round_trips_and_derives_the_avatar_name() {
        let dir = TestDir::new("round-trip");
        let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap();
        let file = FileMetadataOutput::new(
            "file_1234abcd-0000-1111-2222-abcdefabcdef".into(),
            "Avatar - Rurune - Image - 2022․3․22f1_1_standalonewindows_Release".into(),
            "usr_author".into(),
        );

        assert!(file_cache_get(&db, &file.id).unwrap().is_none());
        file_cache_upsert(&db, &file).unwrap();
        let cached = file_cache_get(&db, &file.id).unwrap().unwrap();
        assert_eq!(cached, file);
        assert_eq!(cached.avatar_name.as_deref(), Some("Rurune"));

        let renamed = FileMetadataOutput::new(
            file.id.clone(),
            "file_1234abcd-0000-1111-2222-abcdefabcdef_blob".into(),
            "usr_self".into(),
        );
        file_cache_upsert(&db, &renamed).unwrap();
        assert_eq!(file_cache_get(&db, &file.id).unwrap().unwrap(), renamed);
    }

    #[test]
    fn rejects_empty_ids() {
        let dir = TestDir::new("empty-id");
        let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap();
        assert!(file_cache_get(&db, " ").unwrap().is_none());
        assert!(file_cache_upsert(&db, &FileMetadataOutput::default()).is_err());
    }
}
