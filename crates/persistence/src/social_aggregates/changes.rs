use std::collections::BTreeMap;

use crate::common::{row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::realtime::normalize_user_table_prefix;
use crate::Error;

use super::caveats::friend_changes_caveats;
use super::helpers::{append_time_window_filter, clamped_optional_limit, row_iso, table_exists};
use super::types::{
    FriendChangeEvent, FriendChangeKind, FriendChangeRow, FriendChangesInput, FriendChangesOutput,
};

pub fn get_friend_changes(
    db: &DatabaseService,
    input: FriendChangesInput,
) -> Result<FriendChangesOutput, Error> {
    let user_prefix = normalize_user_table_prefix(input.owner_user_id.as_str())?;
    let (table_name, select_sql) = match input.kind {
        FriendChangeKind::Status => (
            format!("{user_prefix}_feed_status"),
            "SELECT user_id, display_name, created_at, previous_status || ' ' || previous_status_description, status || ' ' || status_description",
        ),
        FriendChangeKind::Avatar => (
            format!("{user_prefix}_feed_avatar"),
            "SELECT user_id, display_name, created_at, previous_current_avatar_image_url, avatar_name",
        ),
        FriendChangeKind::Bio => (
            format!("{user_prefix}_feed_bio"),
            "SELECT user_id, display_name, created_at, previous_bio, bio",
        ),
    };
    if !table_exists(db, &table_name)? {
        return Ok(FriendChangesOutput {
            rows: Vec::new(),
            caveats: friend_changes_caveats(),
        });
    }

    let limit = clamped_optional_limit(input.limit, 200, 500);
    let mut sql = format!("{select_sql} FROM {table_name} WHERE 1 = 1");
    let mut params = ParamsBuilder::new().set("limit", limit);
    if let Some(target_user_id) = input
        .target_user_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        sql.push_str(" AND user_id = @target_user_id");
        params = params.set("target_user_id", target_user_id);
    }
    append_time_window_filter(&mut sql, &mut params, &input.time_window, "created_at");
    sql.push_str(" ORDER BY created_at DESC, id DESC LIMIT @limit");

    let mut grouped: BTreeMap<String, FriendChangeAccumulator> = BTreeMap::new();
    for row in db.execute(&sql, &params.build())? {
        let user_id = row_string(&row, 0);
        if user_id.is_empty() {
            continue;
        }
        let display_name = row_string(&row, 1);
        let changed_at = row_iso(&row, 2);
        let previous_value = row_string(&row, 3).trim().to_string();
        let new_value = row_string(&row, 4).trim().to_string();
        let entry = grouped
            .entry(user_id.clone())
            .or_insert_with(|| FriendChangeAccumulator {
                user_id,
                display_name,
                ..FriendChangeAccumulator::default()
            });
        entry.change_count += 1;
        if changed_at > entry.last_changed_at {
            entry.last_changed_at = changed_at.clone();
        }
        if entry.recent_events.len() < 5 {
            entry.recent_events.push(FriendChangeEvent {
                changed_at,
                kind: input.kind.clone(),
                previous_value,
                new_value,
            });
        }
    }

    let mut rows = grouped
        .into_values()
        .map(|entry| FriendChangeRow {
            user_id: entry.user_id,
            display_name: entry.display_name,
            change_count: entry.change_count,
            last_changed_at: entry.last_changed_at,
            recent_events: entry.recent_events,
        })
        .collect::<Vec<_>>();
    rows.sort_by(|left, right| {
        right
            .change_count
            .cmp(&left.change_count)
            .then_with(|| right.last_changed_at.cmp(&left.last_changed_at))
            .then_with(|| left.display_name.cmp(&right.display_name))
            .then_with(|| left.user_id.cmp(&right.user_id))
    });

    Ok(FriendChangesOutput {
        rows,
        caveats: friend_changes_caveats(),
    })
}

#[derive(Clone, Debug, Default)]
struct FriendChangeAccumulator {
    user_id: String,
    display_name: String,
    change_count: i64,
    last_changed_at: String,
    recent_events: Vec<FriendChangeEvent>,
}
