use crate::common::{row_i64, row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::favorites;
use crate::ownership::{owner_id_for_filter, OwnerId};
use crate::Error;
use vrcx_0_core::FavoriteEntityKind;

use super::caveats::{favorite_local_caveats, worlds_visited_caveats};
use super::helpers::{append_time_window_filter, millis_to_minutes};
use super::types::{
    FavoriteAction, FavoriteLocalInput, FavoriteOutput, SearchWorldsVisitedInput,
    SearchWorldsVisitedOutput, VisitedWorldRow,
};
use super::visits::shift_timestamp;

pub fn search_worlds_visited(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    input: SearchWorldsVisitedInput,
) -> Result<SearchWorldsVisitedOutput, Error> {
    let limit = input.limit.clamp(1, 1_000);
    let mut sql = String::from(
        "SELECT world_id, world_name, location, created_at, time
         FROM gamelog_location
         WHERE owner_id IN (0, @owner_id)",
    );
    let mut params = ParamsBuilder::new()
        .set("limit", limit)
        .set("owner_id", owner_id_for_filter(db, owner_user_id)?);
    append_time_window_filter(&mut sql, &mut params, &input.time_window, "created_at");
    sql.push_str(" ORDER BY created_at DESC, id DESC LIMIT @limit");

    let rows = db
        .execute(&sql, &params.build())?
        .into_iter()
        .map(|row| {
            let visited_at = row_string(&row, 3);
            let stay_millis = row_i64(&row, 4).max(0);
            VisitedWorldRow {
                world_id: row_string(&row, 0),
                world_name: row_string(&row, 1),
                location: row_string(&row, 2),
                left_at: (stay_millis > 0)
                    .then(|| shift_timestamp(&visited_at, stay_millis))
                    .flatten(),
                visited_at,
                stay_minutes: millis_to_minutes(stay_millis),
            }
        })
        .filter(|row| !row.world_id.is_empty() || !row.location.is_empty())
        .collect::<Vec<_>>();

    let summary = worlds_visited_summary(&rows);
    Ok(SearchWorldsVisitedOutput {
        rows,
        summary,
        caveats: worlds_visited_caveats(),
    })
}

fn worlds_visited_summary(rows: &[VisitedWorldRow]) -> String {
    if rows.is_empty() {
        return "No world visits found in this window.".to_string();
    }
    let names = rows
        .iter()
        .map(|row| {
            if row.world_name.is_empty() {
                row.location.as_str()
            } else {
                row.world_name.as_str()
            }
        })
        .collect::<Vec<_>>()
        .join(", ");
    format!("{} recent world visit(s): {names}.", rows.len())
}

pub fn favorite_local(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    input: FavoriteLocalInput,
) -> Result<FavoriteOutput, Error> {
    let kind = input.kind;
    let entity_id = input.entity_id.trim().to_string();
    let group = input.group.trim().to_string();
    let action = input.action;
    let expected_prefix = kind.entity_id_prefix();
    if entity_id.is_empty() {
        return Err(Error::InvalidData("favorite requires entity_id".into()));
    }
    if !entity_id.starts_with(expected_prefix) {
        return Err(Error::InvalidData(format!(
            "favorite {} entity_id must start with {expected_prefix}",
            kind.as_str()
        )));
    }
    if group.is_empty() {
        return Err(Error::InvalidData("favorite requires group".into()));
    }
    let affected_rows = if input.dry_run {
        0
    } else {
        apply_favorite_action(action, db, owner_user_id, kind, &entity_id, &group)?
    };
    Ok(FavoriteOutput {
        kind,
        entity_id,
        group,
        action,
        dry_run: input.dry_run,
        affected_rows,
        caveats: favorite_local_caveats(),
    })
}

fn apply_favorite_action(
    action: FavoriteAction,
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    kind: FavoriteEntityKind,
    entity_id: &str,
    group: &str,
) -> Result<i64, Error> {
    match action {
        FavoriteAction::Add => favorites::favorite_add(
            db,
            Some(owner_user_id),
            kind,
            entity_id.to_string(),
            group.to_string(),
        ),
        FavoriteAction::Remove => favorites::favorite_remove(
            db,
            Some(owner_user_id),
            kind,
            entity_id.to_string(),
            group.to_string(),
        ),
    }
}
