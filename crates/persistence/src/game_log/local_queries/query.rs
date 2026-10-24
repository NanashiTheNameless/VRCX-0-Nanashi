use super::*;
use crate::ownership::OwnerId;

fn non_negative_limit(requested: Option<i64>, default_value: i64) -> i64 {
    requested.unwrap_or(default_value).max(0)
}

fn normalized_list(values: &[String]) -> Vec<String> {
    values
        .iter()
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .collect()
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum RowQueryMode {
    ByLocation,
    Lookup,
    Search,
}

impl RowQueryMode {
    fn of(query: &GameLogQuery) -> Self {
        match query {
            GameLogQuery::RowsByLocation { .. } => Self::ByLocation,
            GameLogQuery::LookupRows { .. } => Self::Lookup,
            _ => Self::Search,
        }
    }

    fn filters(self, query: &GameLogQuery) -> &[String] {
        match query {
            GameLogQuery::RowsByLocation { filters, .. }
            | GameLogQuery::LookupRows { filters, .. }
            | GameLogQuery::SearchRows { filters, .. } => filters,
            _ => &[],
        }
    }

    fn vip_list(self, query: &GameLogQuery) -> &[String] {
        match query {
            GameLogQuery::RowsByLocation { vip_list, .. }
            | GameLogQuery::LookupRows { vip_list, .. }
            | GameLogQuery::SearchRows { vip_list, .. } => vip_list,
            _ => &[],
        }
    }

    fn limits(self, query: &GameLogQuery) -> (Option<i64>, Option<i64>) {
        match query {
            GameLogQuery::RowsByLocation {
                max_entries,
                max_rows,
                ..
            }
            | GameLogQuery::LookupRows {
                max_entries,
                max_rows,
                ..
            }
            | GameLogQuery::SearchRows {
                max_entries,
                max_rows,
                ..
            } => (*max_entries, *max_rows),
            _ => (None, None),
        }
    }

    fn output(self, rows: Vec<GameLogRowOutput>) -> GameLogQueryOutput {
        match self {
            Self::ByLocation => GameLogQueryOutput::RowsByLocation(rows),
            Self::Lookup => GameLogQueryOutput::LookupRows(rows),
            Self::Search => GameLogQueryOutput::SearchRows(rows),
        }
    }
}

fn limit_usize(limit: i64) -> usize {
    usize::try_from(limit).unwrap_or(usize::MAX)
}

fn location_prefix_upper_bound(instance_id: &str) -> Option<String> {
    if !instance_id.starts_with("wrld_")
        || !instance_id.is_ascii()
        || instance_id.bytes().any(|byte| byte.is_ascii_uppercase())
    {
        return None;
    }
    let mut upper_bound = instance_id.to_owned();
    while let Some(last) = upper_bound.pop() {
        if last < '\x7f' {
            upper_bound.push(char::from(last as u8 + 1));
            return Some(upper_bound);
        }
    }
    None
}

fn location_filter_sql(instance_id: &str, db_params: &mut HashMap<String, Value>) -> &'static str {
    match location_prefix_upper_bound(instance_id) {
        Some(upper_bound) => {
            db_params.insert(
                "@location_lower".into(),
                Value::String(instance_id.to_owned()),
            );
            db_params.insert("@location_upper".into(), Value::String(upper_bound));
            "location >= @location_lower AND location < @location_upper"
        }
        None => {
            db_params.insert(
                "@location_like".into(),
                Value::String(format!("%{instance_id}%")),
            );
            "location LIKE @location_like"
        }
    }
}

pub fn game_log_query(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    query: GameLogQuery,
) -> Result<GameLogQueryOutput, Error> {
    if let GameLogQuery::PreviousInstancesByGroupId { group_id } = &query {
        return Ok(GameLogQueryOutput::PreviousInstancesByGroupId(
            get_previous_instances_by_group_id(db, owner_user_id, group_id.trim())?,
        ));
    }
    if let GameLogQuery::PreviousInstancesByWorldId { world_id } = &query {
        return Ok(GameLogQueryOutput::PreviousInstancesByWorldId(
            get_previous_instances_by_world_id(db, owner_user_id, world_id.trim())?,
        ));
    }

    ensure_game_log_tables(db)?;
    let owner_id = owner_id_for_filter(db, owner_user_id)?;
    match query {
        GameLogQuery::PreviousInstancesByGroupId { .. }
        | GameLogQuery::PreviousInstancesByWorldId { .. } => {
            unreachable!("previous-instance queries return before the table gate")
        }
        GameLogQuery::RecentDatabase {
            date_offset,
            max_table_size,
        } => {
            let limit = non_negative_limit(max_table_size, 500);
            let mut rows = Vec::new();
            let recent_params = scoped_params(owner_id)
                .set("date_offset", date_offset.unwrap_or(0))
                .set("limit", limit)
                .build();
            for descriptor in GAME_LOG_RECENT_DESCRIPTORS {
                for row in db.execute(&game_log_recent_select_sql(descriptor), &recent_params)? {
                    rows.push(game_log_row_from_unified_row(&row)?);
                }
            }
            rows.sort_by_key(|left| left.created_at);
            let limit = limit_usize(limit);
            if rows.len() > limit {
                rows.drain(0..rows.len() - limit);
            }
            Ok(GameLogQueryOutput::RecentDatabase(rows))
        }
        GameLogQuery::RowsByLocation { .. }
        | GameLogQuery::LookupRows { .. }
        | GameLogQuery::SearchRows { .. } => {
            let mode = RowQueryMode::of(&query);
            let include_extra = mode != RowQueryMode::ByLocation;
            let filters = normalized_list(mode.filters(&query));
            let flags = game_log_filter_flags(&filters, include_extra);
            let vip_list = normalized_list(mode.vip_list(&query));
            let mut db_params = scoped_param_map(owner_id);
            let (requested_entries, requested_rows) = mode.limits(&query);
            let max_entries = non_negative_limit(requested_entries, 500);
            let max_rows = non_negative_limit(requested_rows, max_entries).min(max_entries);
            db_params.insert("@limit".into(), Value::from(max_rows));
            db_params.insert("@per_table".into(), Value::from(max_entries));
            let vip_placeholders = add_list_params(&mut db_params, &vip_list, "vip");
            let vip_query = if vip_placeholders.is_empty() {
                String::new()
            } else {
                format!("AND user_id IN ({})", vip_placeholders.join(", "))
            };
            let mut selects = Vec::new();

            if let GameLogQuery::RowsByLocation {
                instance_id,
                current_user_id,
                ..
            } = &query
            {
                let instance_id = instance_id.trim().to_string();
                let location_filter = location_filter_sql(&instance_id, &mut db_params);
                db_params.insert(
                    "@current_user_id".into(),
                    Value::String(current_user_id.trim().to_string()),
                );
                if flags.location {
                    selects.push(game_log_location_union_select(
                        location_filter,
                        include_extra,
                    ));
                }
                if flags.onplayerjoined || flags.onplayerleft {
                    let query = match (flags.onplayerjoined, flags.onplayerleft) {
                        (true, false) => "AND type = 'OnPlayerJoined'",
                        (false, true) => "AND type = 'OnPlayerLeft'",
                        _ => "",
                    };
                    selects.push(game_log_join_leave_union_select(
                        &format!("({location_filter} AND user_id != @current_user_id) {vip_query} {query}"),
                        include_extra,
                    ));
                }
                if flags.portalspawn {
                    selects.push(game_log_portal_spawn_union_select(
                        &format!("{location_filter} {vip_query}"),
                        include_extra,
                    ));
                }
                if flags.videoplay {
                    selects.push(game_log_video_play_union_select(
                        &format!("{location_filter} {vip_query}"),
                        include_extra,
                    ));
                }
                if flags.stringload || flags.imageload {
                    let check_string = if flags.stringload {
                        ""
                    } else {
                        "AND resource_type != 'StringLoad'"
                    };
                    let check_image = if flags.imageload {
                        ""
                    } else {
                        "AND resource_type != 'ImageLoad'"
                    };
                    selects.push(game_log_resource_load_union_select(
                        &format!("{location_filter} {check_string} {check_image}"),
                        include_extra,
                    ));
                }
            } else if mode == RowQueryMode::Lookup {
                if flags.location {
                    selects.push(game_log_location_union_select("1=1", include_extra));
                }
                if flags.onplayerjoined || flags.onplayerleft {
                    let query = match (flags.onplayerjoined, flags.onplayerleft) {
                        (true, false) => "AND type = 'OnPlayerJoined'",
                        (false, true) => "AND type = 'OnPlayerLeft'",
                        _ => "",
                    };
                    selects.push(game_log_join_leave_union_select(
                        &format!("1=1 {vip_query} {query}"),
                        include_extra,
                    ));
                }
                if flags.portalspawn {
                    selects.push(game_log_portal_spawn_union_select(
                        &format!("1=1 {vip_query}"),
                        include_extra,
                    ));
                }
                if flags.event {
                    selects.push(game_log_event_union_select("1=1", include_extra));
                }
                if flags.external {
                    selects.push(game_log_external_union_select(
                        &format!("1=1 {vip_query}"),
                        include_extra,
                    ));
                }
                if flags.videoplay {
                    selects.push(game_log_video_play_union_select(
                        &format!("1=1 {vip_query}"),
                        include_extra,
                    ));
                }
                if flags.stringload || flags.imageload {
                    let check_string = if flags.stringload {
                        ""
                    } else {
                        "AND resource_type != 'StringLoad'"
                    };
                    let check_image = if flags.imageload {
                        ""
                    } else {
                        "AND resource_type != 'ImageLoad'"
                    };
                    selects.push(game_log_resource_load_union_select(
                        &format!("1=1 {check_string} {check_image}"),
                        include_extra,
                    ));
                }
            } else {
                let GameLogQuery::SearchRows {
                    search,
                    current_user_id,
                    ..
                } = &query
                else {
                    unreachable!("row query mode is exhaustive");
                };
                let search = search.trim();
                db_params.insert("@search_like".into(), Value::String(format!("%{search}%")));
                db_params.insert(
                    "@current_user_id".into(),
                    Value::String(current_user_id.trim().to_string()),
                );
                if flags.location {
                    selects.push(game_log_location_union_select(
                        "(world_name LIKE @search_like OR group_name LIKE @search_like)",
                        include_extra,
                    ));
                }
                if flags.onplayerjoined || flags.onplayerleft {
                    let query = match (flags.onplayerjoined, flags.onplayerleft) {
                        (true, false) => "AND type = 'OnPlayerJoined'",
                        (false, true) => "AND type = 'OnPlayerLeft'",
                        _ => "",
                    };
                    selects.push(game_log_join_leave_union_select(
                        &format!("((display_name LIKE @search_like OR user_id LIKE @search_like) AND user_id != @current_user_id) {vip_query} {query}"),
                        include_extra,
                    ));
                }
                if flags.portalspawn {
                    selects.push(game_log_portal_spawn_union_select(
                        &format!("(display_name LIKE @search_like OR user_id LIKE @search_like OR world_name LIKE @search_like) {vip_query}"),
                        include_extra,
                    ));
                }
                if flags.event {
                    selects.push(game_log_event_union_select(
                        "data LIKE @search_like",
                        include_extra,
                    ));
                }
                if flags.external {
                    selects.push(game_log_external_union_select(
                        &format!("(display_name LIKE @search_like OR user_id LIKE @search_like OR message LIKE @search_like) {vip_query}"),
                        include_extra,
                    ));
                }
                if flags.videoplay {
                    selects.push(game_log_video_play_union_select(
                        &format!("(video_url LIKE @search_like OR video_name LIKE @search_like OR display_name LIKE @search_like OR user_id LIKE @search_like) {vip_query}"),
                        include_extra,
                    ));
                }
                if flags.stringload || flags.imageload {
                    let check_string = if flags.stringload {
                        ""
                    } else {
                        "AND resource_type != 'StringLoad'"
                    };
                    let check_image = if flags.imageload {
                        ""
                    } else {
                        "AND resource_type != 'ImageLoad'"
                    };
                    selects.push(game_log_resource_load_union_select(
                        &format!("resource_url LIKE @search_like {check_string} {check_image}"),
                        include_extra,
                    ));
                }
            }

            let rows = if selects.is_empty() {
                Vec::new()
            } else {
                db.execute(
                    &format!(
                        "SELECT {} FROM ({}) ORDER BY created_at DESC, id DESC LIMIT @limit",
                        game_log_base_columns(include_extra),
                        selects.join(" UNION ALL ")
                    ),
                    &db_params,
                )?
                .into_iter()
                .map(|row| game_log_row_from_unified_row(&row))
                .collect::<Result<Vec<_>, _>>()?
            };
            Ok(mode.output(rows))
        }
        GameLogQuery::LastVisit {
            world_id,
            current_world_match,
        } => {
            let world_id = world_id.trim().to_string();
            let count = if current_world_match { 2 } else { 1 };
            let row = db
                .execute(
                    "SELECT created_at, world_id FROM gamelog_location WHERE owner_id IN (0, @owner_id) AND world_id = @world_id ORDER BY id DESC LIMIT @count",
                    &scoped_params(owner_id)
                        .set("world_id", world_id)
                        .set("count", count)
                        .build(),
                )?
                .last()
                .cloned();
            Ok(GameLogQueryOutput::LastVisit(
                row.map(|row| GameLogLastVisitOutput {
                    created_at: row_i64(&row, 0),
                    world_id: row_string(&row, 1),
                })
                .unwrap_or_default(),
            ))
        }
        GameLogQuery::VisitCount { world_id } => {
            let world_id = world_id.trim().to_string();
            let count = db
                .execute(
                    "SELECT COUNT(DISTINCT location) FROM gamelog_location WHERE owner_id IN (0, @owner_id) AND world_id = @world_id",
                    &scoped_params(owner_id).set("world_id", world_id.clone()).build(),
                )?
                .first()
                .map(|row| row_i64(row, 0))
                .unwrap_or(0);
            Ok(GameLogQueryOutput::VisitCount(GameLogVisitCountOutput {
                visit_count: count,
                world_id,
            }))
        }
        GameLogQuery::TimeSpentInWorld { world_id } => {
            let world_id = world_id.trim().to_string();
            let time_spent = db
                .execute(
                    "SELECT COALESCE(SUM(time), 0) FROM gamelog_location WHERE owner_id IN (0, @owner_id) AND world_id = @world_id",
                    &scoped_params(owner_id).set("world_id", world_id.clone()).build(),
                )?
                .first()
                .map(|row| row_i64(row, 0))
                .unwrap_or(0);
            Ok(GameLogQueryOutput::TimeSpentInWorld(
                GameLogWorldTimeSpentOutput {
                    time_spent,
                    world_id,
                },
            ))
        }
        GameLogQuery::LastGroupVisit { group_id } => {
            let group_id = group_id.trim();
            let created_at = db
                .execute(
                    "SELECT created_at FROM gamelog_location WHERE owner_id IN (0, @owner_id) AND location LIKE @group_id ORDER BY id DESC LIMIT 1",
                    &scoped_params(owner_id)
                        .set("group_id", format!("%{group_id}%"))
                        .build(),
                )?
                .first()
                .map(|row| row_i64(row, 0))
                .unwrap_or_default();
            Ok(GameLogQueryOutput::LastGroupVisit(
                GameLogLastGroupVisitOutput { created_at },
            ))
        }
        GameLogQuery::LastSeen {
            user_id,
            display_name,
            in_current_world,
        } => {
            let user_id = user_id.trim().to_string();
            let display_name = display_name.trim().to_string();
            let count = if in_current_world { 2 } else { 1 };
            let row = db
                .execute(
                    "SELECT created_at, user_id FROM gamelog_join_leave WHERE owner_id IN (0, @owner_id) AND (user_id = @user_id OR display_name = @display_name) ORDER BY id DESC LIMIT @count",
                    &scoped_params(owner_id)
                        .set("user_id", user_id.clone())
                        .set("display_name", display_name)
                        .set("count", count)
                        .build(),
                )?
                .last()
                .cloned();
            Ok(GameLogQueryOutput::LastSeen(
                row.map(|row| {
                    let row_user_id = row_string(&row, 1);
                    GameLogLastSeenOutput {
                        created_at: row_i64(&row, 0),
                        user_id: if row_user_id.is_empty() {
                            user_id
                        } else {
                            row_user_id
                        },
                    }
                })
                .unwrap_or_default(),
            ))
        }
        GameLogQuery::JoinCount {
            user_id,
            display_name,
        } => {
            let user_id = user_id.trim().to_string();
            let display_name = display_name.trim().to_string();
            let count = db
                .execute(
                    "SELECT COUNT(DISTINCT location) FROM gamelog_join_leave WHERE owner_id IN (0, @owner_id) AND (type = 'OnPlayerJoined') AND (user_id = @user_id OR display_name = @display_name)",
                    &scoped_params(owner_id)
                        .set("user_id", user_id.clone())
                        .set("display_name", display_name)
                        .build(),
                )?
                .first()
                .map(|row| row_i64(row, 0))
                .unwrap_or(0);
            Ok(GameLogQueryOutput::JoinCount(GameLogJoinCountOutput {
                join_count: count,
                user_id,
            }))
        }
        GameLogQuery::TimeSpent {
            user_id,
            display_name,
        } => {
            let user_id = user_id.trim().to_string();
            let display_name = display_name.trim().to_string();
            let time_spent = db
                .execute(
                    "SELECT COALESCE(SUM(time), 0)
                     FROM gamelog_join_leave
                     WHERE owner_id IN (0, @owner_id)
                       AND type = 'OnPlayerLeft'
                       AND (user_id = @user_id OR display_name = @display_name)",
                    &scoped_params(owner_id)
                        .set("user_id", user_id.clone())
                        .set("display_name", display_name)
                        .build(),
                )?
                .first()
                .map(|row| row_i64(row, 0))
                .unwrap_or(0);
            Ok(GameLogQueryOutput::TimeSpent(GameLogUserTimeSpentOutput {
                time_spent,
                user_id,
            }))
        }
        GameLogQuery::UserStats {
            user_id,
            display_name,
            in_current_world,
        } => {
            let user_id = user_id.trim().to_string();
            let display_name = display_name.trim().to_string();
            let count = if in_current_world { 2 } else { 1 };
            let last_seen = db
                .execute(
                    "SELECT created_at FROM gamelog_join_leave WHERE owner_id IN (0, @owner_id) AND (user_id = @user_id OR display_name = @display_name) ORDER BY id DESC LIMIT @count",
                    &scoped_params(owner_id)
                        .set("user_id", user_id.clone())
                        .set("display_name", display_name.clone())
                        .set("count", count)
                        .build(),
                )?
                .last()
                .map(|row| row_string(row, 0))
                .unwrap_or_default();
            let stats = db
                .execute(
                    "SELECT
                        COALESCE(SUM(CASE WHEN type = 'OnPlayerLeft' THEN time ELSE 0 END), 0),
                        COUNT(DISTINCT NULLIF(location, ''))
                     FROM gamelog_join_leave
                     WHERE owner_id IN (0, @owner_id)
                       AND (user_id = @user_id OR display_name = @display_name)",
                    &scoped_params(owner_id)
                        .set("user_id", user_id.clone())
                        .set("display_name", display_name.clone())
                        .build(),
                )?
                .first()
                .cloned();
            let mut previous_names = Vec::new();
            for row in db.execute(
                "SELECT display_name, MAX(created_at)
                 FROM gamelog_join_leave
                 WHERE owner_id IN (0, @owner_id)
                   AND user_id = @user_id
                   AND display_name != ''
                   AND display_name != @display_name
                 GROUP BY display_name
                 ORDER BY MAX(created_at) DESC",
                &scoped_params(owner_id)
                    .set("user_id", user_id.clone())
                    .set("display_name", display_name)
                    .build(),
            )? {
                previous_names.push(GameLogPreviousDisplayNameOutput {
                    display_name: row_string(&row, 0),
                    created_at: row_i64(&row, 1),
                });
            }
            Ok(GameLogQueryOutput::UserStats(GameLogUserStatsOutput {
                time_spent: stats.as_ref().map(|row| row_i64(row, 0)).unwrap_or(0),
                last_seen,
                join_count: stats.as_ref().map(|row| row_i64(row, 1)).unwrap_or(0),
                user_id,
                previous_display_names: previous_names,
            }))
        }
        GameLogQuery::AllUserStats {
            user_ids,
            display_names,
        } => {
            let user_ids = normalized_list(&user_ids);
            let display_names = normalized_list(&display_names);
            if user_ids.is_empty() && display_names.is_empty() {
                return Ok(GameLogQueryOutput::AllUserStats(Vec::new()));
            }
            let mut db_params = scoped_param_map(owner_id);
            let mut clauses = Vec::new();
            let user_placeholders = add_list_params(&mut db_params, &user_ids, "stat_user_id");
            if !user_placeholders.is_empty() {
                clauses.push(format!("g.user_id IN ({})", user_placeholders.join(", ")));
            }
            let name_placeholders =
                add_list_params(&mut db_params, &display_names, "stat_display_name");
            if !name_placeholders.is_empty() {
                clauses.push(format!(
                    "g.display_name IN ({})",
                    name_placeholders.join(", ")
                ));
            }
            Ok(GameLogQueryOutput::AllUserStats(
                db.execute(
                    &format!(
                        "SELECT
                                g.created_at,
                                g.user_id,
                                SUM(g.time) AS timeSpent,
                                COUNT(DISTINCT g.location) AS joinCount,
                                g.display_name,
                                MAX(g.id) AS max_id
                            FROM
                                gamelog_join_leave g
                            WHERE
                                g.owner_id IN (0, @owner_id)
                                AND ({})
                            GROUP BY
                                g.user_id,
                                g.display_name
                            ORDER BY
                                g.user_id DESC",
                        clauses.join("\n                OR ")
                    ),
                    &db_params,
                )?
                .into_iter()
                .map(|row| GameLogAllUserStatsOutput {
                    last_seen: row_string(&row, 0),
                    user_id: row_string(&row, 1),
                    time_spent: row_i64(&row, 2),
                    join_count: row_i64(&row, 3),
                    display_name: row_string(&row, 4),
                })
                .collect(),
            ))
        }
        GameLogQuery::LastDate {} => {
            let mut dates = Vec::new();
            for table in [
                "gamelog_location",
                "gamelog_join_leave",
                "gamelog_portal_spawn",
                "gamelog_event",
                "gamelog_video_play",
                "gamelog_resource_load",
            ] {
                if let Some(date) = db
                    .execute(
                        &format!("SELECT created_at FROM {table} WHERE owner_id IN (0, @owner_id) ORDER BY id DESC LIMIT 1"),
                        &scoped_params(owner_id).build(),
                    )?
                    .first()
                    .and_then(|row| row.first())
                    .and_then(Value::as_i64)
                {
                    dates.push(date);
                }
            }
            Ok(GameLogQueryOutput::LastDate(
                dates.into_iter().max().unwrap_or_default(),
            ))
        }
        GameLogQuery::PlayersFromInstanceRows { location } => {
            Ok(GameLogQueryOutput::PlayersFromInstanceRows(
                db
                    .execute(
                        "SELECT id, created_at, display_name, user_id, time, type FROM gamelog_join_leave WHERE owner_id IN (0, @owner_id) AND location = @location ORDER BY id ASC",
                        &scoped_params(owner_id).set("location", location.trim()).build(),
                    )?
                    .into_iter()
                    .map(|row| GameLogInstancePlayerEventOutput {
                        row_id: row_i64(&row, 0),
                        created_at: row_i64(&row, 1),
                        display_name: row_string(&row, 2),
                        user_id: row_string(&row, 3),
                        time: row_i64(&row, 4),
                        r#type: row_string(&row, 5),
                    })
                    .collect(),
            ))
        }
        GameLogQuery::LocationBeforeOrAt { created_at } => {
            let row = db
                .execute(
                    "SELECT created_at, location, world_id, world_name, group_name
                     FROM gamelog_location
                     WHERE owner_id IN (0, @owner_id)
                       AND created_at <= @created_at
                     ORDER BY created_at DESC
                     LIMIT 1",
                    &scoped_params(owner_id)
                        .set("created_at", created_at)
                        .build(),
                )?
                .first()
                .cloned();
            Ok(GameLogQueryOutput::LocationBeforeOrAt(row.map(|row| {
                GameLogLocationBeforeOutput {
                    created_at: row_i64(&row, 0),
                    location: row_string(&row, 1),
                    world_id: row_string(&row, 2),
                    world_name: row_string(&row, 3),
                    group_name: row_string(&row, 4),
                }
            })))
        }
        GameLogQuery::JoinLeaveRange {
            location,
            after_date,
            before_date,
        } => {
            let location = location.trim().to_string();
            Ok(GameLogQueryOutput::JoinLeaveRange(
                db.execute(
                    "SELECT created_at, type, display_name, user_id
                         FROM gamelog_join_leave
                         WHERE owner_id IN (0, @owner_id)
                           AND location = @location
                           AND created_at >= @after_date
                           AND created_at <= @before_date
                         ORDER BY created_at ASC",
                    &scoped_params(owner_id)
                        .set("location", location)
                        .set("after_date", after_date)
                        .set("before_date", before_date)
                        .build(),
                )?
                .into_iter()
                .map(|row| GameLogJoinLeaveRangeOutput {
                    created_at: row_i64(&row, 0),
                    r#type: row_string(&row, 1),
                    display_name: row_string(&row, 2),
                    user_id: row_string(&row, 3),
                })
                .collect(),
            ))
        }
        GameLogQuery::PlayerDetailFromInstance { location } => {
            let location = location.trim().to_string();
            Ok(GameLogQueryOutput::PlayerDetailFromInstance(
                db.execute(
                    "SELECT created_at, display_name, user_id, time
                         FROM gamelog_join_leave
                         WHERE owner_id IN (0, @owner_id)
                           AND location = @location AND type = 'OnPlayerLeft'
                         ORDER BY created_at ASC",
                    &scoped_params(owner_id).set("location", location).build(),
                )?
                .into_iter()
                .map(|row| GameLogPlayerDetailOutput {
                    created_at: row_i64(&row, 0),
                    display_name: row_string(&row, 1),
                    user_id: row_string(&row, 2),
                    time: row_i64(&row, 3),
                })
                .collect(),
            ))
        }
        GameLogQuery::PreviousDisplayNamesByUserId { user_id } => {
            let user_id = user_id.trim().to_string();
            Ok(GameLogQueryOutput::PreviousDisplayNamesByUserId(
                db.execute(
                    "SELECT created_at, display_name
                         FROM gamelog_join_leave
                         WHERE owner_id IN (0, @owner_id)
                           AND user_id = @user_id
                         ORDER BY id DESC",
                    &scoped_params(owner_id).set("user_id", user_id).build(),
                )?
                .into_iter()
                .map(|row| GameLogPreviousDisplayNameOutput {
                    created_at: row_i64(&row, 0),
                    display_name: row_string(&row, 1),
                })
                .collect(),
            ))
        }
        GameLogQuery::InstanceTimes {} => Ok(GameLogQueryOutput::InstanceTimes(
            db.execute(
                "SELECT location, time FROM gamelog_location WHERE owner_id IN (0, @owner_id)",
                &scoped_params(owner_id).build(),
            )?
            .into_iter()
            .map(|row| GameLogInstanceTimeOutput {
                location: row_string(&row, 0),
                time: row_i64(&row, 1),
            })
            .collect(),
        )),
        GameLogQuery::OnlineSessions { from_date, to_date } => {
            let mut rows = Vec::new();
            if let Some(from_date) = from_date {
                if let Some(row) = db
                    .execute(
                        "SELECT created_at, time FROM gamelog_location WHERE owner_id IN (0, @owner_id) AND created_at < @from_date ORDER BY created_at DESC LIMIT 1",
                        &scoped_params(owner_id).set("from_date", from_date).build(),
                    )?
                    .first()
                    .cloned()
                {
                    rows.push(GameLogOnlineSessionOutput {
                        created_at: row_i64(&row, 0),
                        time: row_i64(&row, 1),
                    });
                }
            }
            let mut clauses = vec!["owner_id IN (0, @owner_id)"];
            let mut db_params = scoped_param_map(owner_id);
            if let Some(from_date) = from_date {
                clauses.push("created_at >= @from_date");
                db_params.insert("@from_date".into(), Value::from(from_date));
            }
            if let Some(to_date) = to_date {
                clauses.push("created_at < @to_date");
                db_params.insert("@to_date".into(), Value::from(to_date));
            }
            let date_clause = format!("WHERE {}", clauses.join(" AND "));
            for row in db.execute(
                &format!("SELECT created_at, time FROM gamelog_location {date_clause} ORDER BY created_at"),
                &db_params,
            )? {
                rows.push(GameLogOnlineSessionOutput {
                    created_at: row_i64(&row, 0),
                    time: row_i64(&row, 1),
                });
            }
            Ok(GameLogQueryOutput::OnlineSessions(rows))
        }
        GameLogQuery::OnlineSessionsAfter {
            after_created_at,
            inclusive,
        } => {
            let after = after_created_at;
            let op = if inclusive { ">=" } else { ">" };
            Ok(GameLogQueryOutput::OnlineSessionsAfter(
                db
                    .execute(
                        &format!("SELECT created_at, time FROM gamelog_location WHERE owner_id IN (0, @owner_id) AND created_at {op} @after ORDER BY created_at"),
                        &scoped_params(owner_id).set("after", after).build(),
                    )?
                    .into_iter()
                    .map(|row| GameLogOnlineSessionOutput {
                        created_at: row_i64(&row, 0),
                        time: row_i64(&row, 1),
                    })
                    .collect(),
            ))
        }
        GameLogQuery::InstanceJoinHistory {
            user_id,
            created_at,
        } => {
            Ok(GameLogQueryOutput::InstanceJoinHistory(
                db
                    .execute(
                        "SELECT created_at, location FROM gamelog_join_leave WHERE owner_id IN (0, @owner_id) AND user_id = @user_id AND created_at > @created_at ORDER BY created_at DESC",
                        &scoped_params(owner_id)
                            .set("user_id", user_id.trim())
                            .set("created_at", created_at)
                            .build(),
                    )?
                    .into_iter()
                    .map(|row| GameLogInstanceJoinOutput {
                        created_at: row_i64(&row, 0),
                        location: row_string(&row, 1),
                    })
                    .collect(),
            ))
        }
        GameLogQuery::WorldNameByWorldId { world_id } => {
            let world_name = db
                .execute(
                    "SELECT world_name FROM gamelog_location WHERE owner_id IN (0, @owner_id) AND world_id = @world_id ORDER BY id DESC LIMIT 1",
                    &scoped_params(owner_id).set("world_id", world_id.trim()).build(),
                )?
                .first()
                .map(|row| row_string(row, 0))
                .unwrap_or_default();
            Ok(GameLogQueryOutput::WorldNameByWorldId(world_name))
        }
        GameLogQuery::UserIdFromDisplayName { display_name } => {
            let user_id = db
                .execute(
                    "SELECT user_id FROM gamelog_join_leave WHERE owner_id IN (0, @owner_id) AND display_name = @display_name AND user_id != '' ORDER BY id DESC LIMIT 1",
                    &scoped_params(owner_id).set("display_name", display_name.trim()).build(),
                )?
                .first()
                .map(|row| row_string(row, 0))
                .unwrap_or_default();
            Ok(GameLogQueryOutput::UserIdFromDisplayName(user_id))
        }
    }
}
