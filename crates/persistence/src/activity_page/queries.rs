use crate::common::{row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::game_log::ensure_game_log_tables;
use crate::ownership::{owner_id_for_filter, OwnerId};
use crate::Error;
use std::collections::BTreeSet;
use vrcx_0_core::time::epoch_from_millis;

pub fn first_source_created_at(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
) -> Result<Option<i64>, Error> {
    ensure_game_log_tables(db)?;
    Ok(db
        .execute(
            "SELECT MIN(created_at) FROM gamelog_location WHERE owner_id IN (0, @owner_id)",
            &ParamsBuilder::new()
                .set("owner_id", owner_id_for_filter(db, owner_user_id)?)
                .build(),
        )?
        .first()
        .and_then(|row| row.first())
        .and_then(serde_json::Value::as_i64))
}

pub fn world_ids_before(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    before_ms: i64,
) -> Result<BTreeSet<String>, Error> {
    ensure_game_log_tables(db)?;
    Ok(db
        .execute(
            "SELECT DISTINCT world_id
             FROM gamelog_location
             WHERE owner_id IN (0, @owner_id)
               AND created_at < @before
               AND world_id LIKE 'wrld_%'",
            &ParamsBuilder::new()
                .set("owner_id", owner_id_for_filter(db, owner_user_id)?)
                .set("before", epoch_from_millis(before_ms))
                .build(),
        )?
        .into_iter()
        .map(|row| row_string(&row, 0))
        .filter(|world_id| !world_id.is_empty())
        .collect())
}

pub fn encountered_user_ids(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    from_ms: Option<i64>,
    to_ms: Option<i64>,
) -> Result<BTreeSet<String>, Error> {
    ensure_game_log_tables(db)?;
    let mut sql = String::from(
        "SELECT DISTINCT user_id
         FROM gamelog_join_leave
         WHERE owner_id IN (0, @owner_id)
           AND trim(user_id) <> ''
           AND user_id <> @owner_user_id",
    );
    let mut params = ParamsBuilder::new()
        .set("owner_id", owner_id_for_filter(db, owner_user_id)?)
        .set("owner_user_id", owner_user_id.as_str());
    if let Some(from_ms) = from_ms {
        sql.push_str(" AND created_at >= @from");
        params = params.set("from", epoch_from_millis(from_ms));
    }
    if let Some(to_ms) = to_ms {
        sql.push_str(" AND created_at < @to");
        params = params.set("to", epoch_from_millis(to_ms));
    }
    Ok(db
        .execute(&sql, &params.build())?
        .into_iter()
        .map(|row| row_string(&row, 0))
        .filter(|user_id| !user_id.is_empty())
        .collect())
}
