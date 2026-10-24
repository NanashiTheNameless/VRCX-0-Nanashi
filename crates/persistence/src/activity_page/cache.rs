use std::collections::HashMap;

use serde_json::Value;

use crate::common::{row_i64, row_string, ParamsBuilder};
use crate::database::schema::ensure_user_store_tables;
use crate::database::DatabaseService;
use crate::game_log::ensure_game_log_tables;
use crate::ownership::{owner_id_for_filter, OwnerId};
use crate::realtime::normalize_user_table_prefix;
use crate::Error;

use vrcx_0_contracts::activity_page::{ActivityPageView, CachedActivityPage as CachedPage};

pub fn read_cached_page(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    range_days: i64,
) -> Result<Option<CachedPage>, Error> {
    let user_prefix = normalize_user_table_prefix(owner_user_id.as_str())?;
    ensure_user_store_tables(db, &user_prefix)?;
    let rows = db.execute(
        &format!(
            "SELECT payload_version, built_from_cursor, payload_json
             FROM {user_prefix}_activity_page_cache
             WHERE user_id = @user_id AND range_days = @range_days
             LIMIT 1"
        ),
        &ParamsBuilder::new()
            .set("user_id", owner_user_id.as_str())
            .set("range_days", range_days)
            .build(),
    )?;
    let Some(row) = rows.first() else {
        return Ok(None);
    };
    let payload_version = row_i64(row, 0);
    let built_from_cursor = row_string(row, 1);
    let Ok(view) = serde_json::from_str::<ActivityPageView>(&row_string(row, 2)) else {
        return Ok(None);
    };
    Ok(Some(CachedPage {
        view,
        built_from_cursor,
        payload_version,
    }))
}

pub fn write_cached_page(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    range_days: i64,
    payload_version: i64,
    view: &ActivityPageView,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(owner_user_id.as_str())?;
    ensure_user_store_tables(db, &user_prefix)?;
    let payload_json = serde_json::to_string(view)
        .map_err(|error| Error::Custom(format!("failed to encode activity page cache: {error}")))?;
    db.execute_non_query(
        &format!(
            "INSERT OR REPLACE INTO {user_prefix}_activity_page_cache
                (user_id, range_days, payload_version, built_from_cursor, payload_json, built_at)
             VALUES (@user_id, @range_days, @payload_version, @built_from_cursor, @payload_json, @built_at)"
        ),
        &ParamsBuilder::new()
            .set("user_id", owner_user_id.as_str())
            .set("range_days", range_days)
            .set("payload_version", payload_version)
            .set("built_from_cursor", view.built_from_cursor.as_str())
            .set("payload_json", payload_json)
            .set("built_at", view.built_at)
            .build(),
    )?;
    Ok(())
}

pub fn source_cursor(db: &DatabaseService, owner_user_id: &OwnerId) -> Result<String, Error> {
    ensure_game_log_tables(db)?;
    let owner_id = owner_id_for_filter(db, owner_user_id)?;
    let user_prefix = normalize_user_table_prefix(owner_user_id.as_str())?;
    ensure_user_store_tables(db, &user_prefix)?;
    let owner_scope = ParamsBuilder::new().set("owner_id", owner_id).build();
    let location = source_signature(
        db,
        "SELECT MAX(created_at), COUNT(*), COALESCE(SUM(time), 0)
         FROM gamelog_location WHERE owner_id IN (0, @owner_id)",
        &owner_scope,
    )?;
    let join_leave = source_signature(
        db,
        "SELECT MAX(created_at), COUNT(*), COALESCE(SUM(time), 0)
         FROM gamelog_join_leave WHERE owner_id IN (0, @owner_id)",
        &owner_scope,
    )?;
    let friend_log = source_signature(
        db,
        &format!("SELECT MAX(created_at), COUNT(*), 0 FROM {user_prefix}_friend_log_history"),
        &Default::default(),
    )?;
    Ok(format!("{location}|{join_leave}|{friend_log}"))
}

fn source_signature(
    db: &DatabaseService,
    sql: &str,
    params: &HashMap<String, Value>,
) -> Result<String, Error> {
    Ok(db
        .execute(sql, params)?
        .first()
        .map(|row| {
            format!(
                "{}:{}:{}",
                row_string(row, 0),
                row_i64(row, 1),
                row_i64(row, 2)
            )
        })
        .unwrap_or_default())
}
