use crate::common::{normalize_text, row_i64, row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::ownership::{owner_id_for_filter, OwnerId};
use crate::Error;

use super::{ensure_game_log_tables, PreviousInstanceEventRow};

pub fn previous_instance_event_rows_query(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    user_id: &str,
    date_from: Option<i64>,
    date_to: Option<i64>,
    limit: usize,
) -> Result<Vec<PreviousInstanceEventRow>, Error> {
    ensure_game_log_tables(db)?;
    let user_id = normalize_text(user_id);
    if user_id.is_empty() {
        return Ok(Vec::new());
    }

    let owner_id = owner_id_for_filter(db, owner_user_id)?;
    let mut clauses = vec!["jl.owner_id IN (0, @owner_id)", "jl.user_id = @user_id"];
    let mut params = ParamsBuilder::new()
        .set("owner_id", owner_id)
        .set("user_id", user_id)
        .set("limit", i64::try_from(limit).unwrap_or(i64::MAX));
    if let Some(date_from) = date_from {
        clauses.push("jl.created_at >= @date_from");
        params = params.set("date_from", date_from);
    }
    if let Some(date_to) = date_to {
        clauses.push("jl.created_at <= @date_to");
        params = params.set("date_to", date_to);
    }

    let rows = db.execute(
        &format!(
            "WITH scoped_events AS (
                 SELECT jl.created_at,
                        COALESCE(jl.created_at * 1000, 0) AS created_at_ts,
                        jl.location,
                        jl.time,
                        gl.world_name,
                        gl.group_name,
                        jl.id,
                        jl.type AS event_type
                 FROM gamelog_join_leave jl
                 INNER JOIN gamelog_location gl ON gl.id = (
                     SELECT gl2.id
                     FROM gamelog_location gl2
                     WHERE gl2.location = jl.location
                       AND gl2.owner_id IN (0, @owner_id)
                     ORDER BY gl2.id DESC
                     LIMIT 1
                 )
                 AND gl.owner_id IN (0, @owner_id)
                 WHERE {}
             ),
             lagged_events AS (
                 SELECT *,
                        LAG(id) OVER (ORDER BY id) AS previous_id,
                        LAG(location) OVER (ORDER BY id) AS previous_location,
                        LAG(created_at_ts) OVER (ORDER BY id) AS previous_created_at_ts,
                        LAG(event_type) OVER (ORDER BY id) AS previous_event_type
                 FROM scoped_events
             ),
             event_boundaries AS (
                 SELECT *,
                        CASE
                            WHEN previous_id IS NULL THEN 1
                            WHEN location != previous_location THEN 1
                            WHEN created_at_ts - previous_created_at_ts > 3600000
                                 AND NOT (
                                     previous_event_type = 'OnPlayerJoined'
                                     AND event_type = 'OnPlayerLeft'
                                 ) THEN 1
                            ELSE 0
                        END AS group_start
                 FROM lagged_events
             ),
             grouped_events AS (
                 SELECT *,
                        SUM(group_start) OVER (
                            ORDER BY id
                            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                        ) AS group_id
                 FROM event_boundaries
             ),
             selected_groups AS (
                 SELECT group_id
                 FROM grouped_events
                 GROUP BY group_id
                 ORDER BY group_id DESC
                 LIMIT @limit
             )
             SELECT created_at,
                    created_at_ts,
                    location,
                    time,
                    world_name,
                    group_name,
                    id,
                    event_type
             FROM grouped_events
             WHERE @limit = 0
                OR group_id IN (SELECT group_id FROM selected_groups)
             ORDER BY id ASC",
            clauses.join(" AND ")
        ),
        &params.build(),
    )?;

    Ok(rows
        .into_iter()
        .map(|row| PreviousInstanceEventRow {
            created_at: row_i64(&row, 0),
            created_at_ts: row_i64(&row, 1),
            location: row_string(&row, 2),
            time: row_i64(&row, 3),
            world_name: row_string(&row, 4),
            group_name: row_string(&row, 5),
            event_id: row_i64(&row, 6),
            event_type: row_string(&row, 7),
        })
        .collect())
}
