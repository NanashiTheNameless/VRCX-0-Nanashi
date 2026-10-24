pub use vrcx_0_contracts::CacheEntityInput;

use crate::common::{insert_or_replace_sql, now_epoch, DbWriteTarget, ParamsBuilder};
use crate::database::schema::ensure_global_store_tables;
use crate::database::DatabaseService;
use crate::Error;

const CACHE_ENTITY_CHUNK_SIZE: usize = 5000;

const CACHE_ENTITY_COLUMNS: &[&str] = &[
    "id",
    "added_at",
    "author_id",
    "author_name",
    "created_at",
    "description",
    "image_url",
    "name",
    "release_status",
    "thumbnail_image_url",
    "updated_at",
    "version",
];

pub(crate) fn upsert_cache_entity(
    db: &DatabaseService,
    table_name: &str,
    entry: CacheEntityInput,
) -> Result<i64, Error> {
    let id = cache_entity_id(&entry)?;
    ensure_global_store_tables(db)?;
    upsert_cache_entity_on(
        db,
        &insert_or_replace_sql(table_name, CACHE_ENTITY_COLUMNS),
        id,
        entry,
    )
}

pub(crate) fn upsert_cache_entities(
    db: &DatabaseService,
    table_name: &str,
    entries: Vec<CacheEntityInput>,
) -> Result<u32, Error> {
    if entries.is_empty() {
        return Ok(0);
    }
    ensure_global_store_tables(db)?;
    let sql = insert_or_replace_sql(table_name, CACHE_ENTITY_COLUMNS);
    let mut remaining = entries;
    let mut written = 0;
    while !remaining.is_empty() {
        let take = remaining.len().min(CACHE_ENTITY_CHUNK_SIZE);
        let chunk = remaining.drain(..take).collect::<Vec<_>>();
        written += db.write_transaction(|tx| {
            let mut chunk_written = 0;
            for entry in chunk {
                let id = match cache_entity_id(&entry) {
                    Ok(id) => id,
                    Err(error) => {
                        tracing::warn!("skipped malformed {table_name} entity: {error}");
                        continue;
                    }
                };
                upsert_cache_entity_on(tx, &sql, id, entry)?;
                chunk_written += 1;
            }
            Ok(chunk_written)
        })?;
    }
    Ok(written)
}

fn cache_entity_id(entry: &CacheEntityInput) -> Result<String, Error> {
    entry
        .id
        .as_str()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| Error::InvalidData("Cache entity id must be a non-empty string.".into()))
        .map(ToOwned::to_owned)
}

fn upsert_cache_entity_on(
    target: &impl DbWriteTarget,
    sql: &str,
    id: String,
    entry: CacheEntityInput,
) -> Result<i64, Error> {
    let now = now_epoch();
    target.execute_non_query(
        sql,
        &ParamsBuilder::new()
            .set("id", id)
            .set("added_at", now)
            .set("author_id", entry.author_id)
            .set("author_name", entry.author_name)
            .set(
                "created_at",
                vrcx_0_core::time::epoch_from_json(&entry.created_at),
            )
            .set("description", entry.description)
            .set("image_url", entry.image_url)
            .set("name", entry.name)
            .set("release_status", entry.release_status)
            .set("thumbnail_image_url", entry.thumbnail_image_url)
            .set(
                "updated_at",
                vrcx_0_core::time::epoch_from_json(&entry.updated_at),
            )
            .set("version", entry.version)
            .build(),
    )
}
