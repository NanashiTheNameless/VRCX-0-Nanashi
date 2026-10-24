use serde_json::Value;
pub use vrcx_0_contracts::WorldSummaryOutput;

use crate::cache_entities::{upsert_cache_entities, upsert_cache_entity, CacheEntityInput};
use crate::common::{normalize_text, row_i64, row_string, ParamsBuilder};
use crate::database::schema::ensure_global_store_tables;
use crate::database::DatabaseService;
use crate::Error;

pub fn world_cache_upsert(db: &DatabaseService, entry: CacheEntityInput) -> Result<i64, Error> {
    upsert_cache_entity(db, "cache_world", entry)
}

pub fn world_cache_upsert_many(
    db: &DatabaseService,
    entries: Vec<CacheEntityInput>,
) -> Result<u32, Error> {
    upsert_cache_entities(db, "cache_world", entries)
}

pub fn world_cache_get(
    db: &DatabaseService,
    world_id: String,
) -> Result<Option<WorldSummaryOutput>, Error> {
    ensure_global_store_tables(db)?;
    let world_id = normalize_text(world_id);
    if world_id.is_empty() {
        return Ok(None);
    }
    Ok(db
        .execute(
            "SELECT id, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version FROM cache_world WHERE id = @world_id LIMIT 1",
            &ParamsBuilder::new().set("world_id", world_id).build(),
        )?
        .first()
        .map(|row| world_summary_from_row(row)))
}

pub fn world_cache_search(
    db: &DatabaseService,
    query: impl AsRef<str>,
    limit: i64,
) -> Result<Vec<WorldSummaryOutput>, Error> {
    ensure_global_store_tables(db)?;
    let query = normalize_text(query);
    let limit = limit.clamp(0, 50);
    if query.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }
    Ok(db
        .execute(
            "SELECT id, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version FROM cache_world WHERE instr(lower(name), lower(@query)) > 0 ORDER BY CASE WHEN instr(lower(name), lower(@query)) = 1 THEN 0 ELSE 1 END, name COLLATE NOCASE, id LIMIT @limit",
            &ParamsBuilder::new()
                .set("query", query)
                .set("limit", limit)
                .build(),
        )?
        .into_iter()
        .map(|row| world_summary_from_row(&row))
        .collect())
}

pub fn world_cache_get_many(
    db: &DatabaseService,
    world_ids: &[String],
) -> Result<Vec<WorldSummaryOutput>, Error> {
    ensure_global_store_tables(db)?;
    let world_ids = world_ids
        .iter()
        .map(normalize_text)
        .filter(|id| !id.is_empty())
        .collect::<Vec<_>>();
    if world_ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut params = ParamsBuilder::new();
    let placeholders = world_ids
        .iter()
        .enumerate()
        .map(|(index, world_id)| {
            let param = format!("world_id_{index}");
            params = std::mem::take(&mut params).set(&param, world_id.clone());
            format!("@{param}")
        })
        .collect::<Vec<_>>()
        .join(", ");
    Ok(db
        .execute(
            &format!(
                "SELECT id, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version FROM cache_world WHERE id IN ({placeholders})"
            ),
            &params.build(),
        )?
        .into_iter()
        .map(|row| world_summary_from_row(&row))
        .collect())
}

pub(crate) fn world_summary_from_row(row: &[Value]) -> WorldSummaryOutput {
    WorldSummaryOutput {
        id: row_string(row, 0),
        author_id: row_string(row, 1),
        author_name: row_string(row, 2),
        created_at: row_i64(row, 3),
        description: row_string(row, 4),
        image_url: row_string(row, 5),
        name: row_string(row, 6),
        release_status: row_string(row, 7).into(),
        thumbnail_image_url: row_string(row, 8),
        updated_at: row_i64(row, 9),
        version: row_i64(row, 10),
    }
}

#[cfg(test)]
mod tests;
