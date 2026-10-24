use std::collections::{BTreeMap, HashSet};

use chrono::{DateTime, Duration, Utc};

use crate::common::{row_i64, row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::ownership::{owner_id_for_filter, OwnerRowId};
use crate::Error;

use super::caveats::visit_timeline_caveats;
use super::helpers::{
    clamped_optional_limit, current_friend_id_set, format_minutes, millis_to_minutes, row_iso,
};
use super::types::{VisitRosterRow, VisitRow, VisitStint, VisitTimelineInput, VisitTimelineOutput};
use vrcx_0_core::time::parse_epoch_seconds;

const EVENT_SCAN_LIMIT: i64 = 20_000;
const TIMESTAMP_FORMAT: &str = "%Y-%m-%dT%H:%M:%S%.3fZ";

pub fn get_visit_timeline(
    db: &DatabaseService,
    input: VisitTimelineInput,
) -> Result<VisitTimelineOutput, Error> {
    let at = input.at.trim();
    if at.is_empty() {
        return Err(Error::InvalidData(
            "get_visit_timeline needs `at`: a UTC timestamp inside the visit".into(),
        ));
    }
    let owner_id = owner_id_for_filter(db, &input.owner_user_id)?;
    let caveats = visit_timeline_caveats();

    let Some(visit) = select_visit(db, owner_id, at, input.location.as_deref())? else {
        return Ok(no_visit_output(
            format!("No visit in the local game log contains {at}."),
            caveats,
        ));
    };
    let next_visit_start = next_visit_start(db, owner_id, &visit.joined_at, visit.id)?;
    let left_at = (visit.stay_millis > 0)
        .then(|| shift_timestamp(&visit.joined_at, visit.stay_millis))
        .flatten();
    if let Some(left_at) = left_at.as_deref() {
        if at > left_at && next_visit_start.is_some() {
            return Ok(no_visit_output(
                format!("No visit contains {at}; the nearest earlier visit ended at {left_at}."),
                caveats,
            ));
        }
    }
    let in_progress = visit.stay_millis <= 0 && next_visit_start.is_none();

    let events = load_events(
        db,
        owner_id,
        input.owner_user_id.as_str().trim(),
        &visit.joined_at,
        next_visit_start.as_deref(),
    )?;
    let friend_ids = current_friend_id_set(db, &input.owner_user_id)?;
    let mut roster = fold_roster(events, left_at.as_deref(), &friend_ids);
    let people_observed = roster.len();
    let limit = clamped_optional_limit(input.limit, 50, 200) as usize;
    let truncated = roster.len() > limit;
    roster.truncate(limit);

    let visit_row = VisitRow {
        world_id: visit.world_id,
        world_name: visit.world_name,
        location: visit.location,
        joined_at: visit.joined_at,
        left_at,
        stay_minutes: millis_to_minutes(visit.stay_millis.max(0)),
        in_progress,
    };
    let summary = visit_summary(&visit_row, &roster, people_observed);
    Ok(VisitTimelineOutput {
        visit: Some(visit_row),
        roster,
        people_observed,
        truncated,
        summary,
        caveats,
    })
}

fn no_visit_output(summary: String, caveats: Vec<String>) -> VisitTimelineOutput {
    VisitTimelineOutput {
        visit: None,
        roster: Vec::new(),
        people_observed: 0,
        truncated: false,
        summary,
        caveats,
    }
}

struct StoredVisit {
    id: i64,
    world_id: String,
    world_name: String,
    location: String,
    joined_at: String,
    stay_millis: i64,
}

fn select_visit(
    db: &DatabaseService,
    owner_id: OwnerRowId,
    at: &str,
    location: Option<&str>,
) -> Result<Option<StoredVisit>, Error> {
    let mut sql = String::from(
        "SELECT id, world_id, world_name, location, created_at, time
         FROM gamelog_location
         WHERE owner_id IN (0, @owner_id) AND created_at <= @at",
    );
    let mut params = ParamsBuilder::new()
        .set("owner_id", owner_id)
        .set("at", parse_epoch_seconds(at));
    if let Some(location) = location.map(str::trim).filter(|value| !value.is_empty()) {
        sql.push_str(" AND location = @location");
        params = params.set("location", location.to_string());
    }
    sql.push_str(" ORDER BY created_at DESC, id DESC LIMIT 1");
    Ok(db
        .execute(&sql, &params.build())?
        .into_iter()
        .next()
        .map(|row| StoredVisit {
            id: row_i64(&row, 0),
            world_id: row_string(&row, 1),
            world_name: row_string(&row, 2),
            location: row_string(&row, 3),
            joined_at: row_iso(&row, 4),
            stay_millis: row_i64(&row, 5),
        }))
}

fn next_visit_start(
    db: &DatabaseService,
    owner_id: OwnerRowId,
    joined_at: &str,
    visit_id: i64,
) -> Result<Option<String>, Error> {
    Ok(db
        .execute(
            "SELECT created_at FROM gamelog_location
             WHERE owner_id IN (0, @owner_id)
               AND (created_at > @joined_at OR (created_at = @joined_at AND id > @visit_id))
             ORDER BY created_at ASC, id ASC LIMIT 1",
            &ParamsBuilder::new()
                .set("owner_id", owner_id)
                .set("joined_at", parse_epoch_seconds(joined_at))
                .set("visit_id", visit_id)
                .build(),
        )?
        .into_iter()
        .next()
        .map(|row| row_iso(&row, 0)))
}

struct JoinLeaveEvent {
    created_at: String,
    joined: bool,
    display_name: String,
    user_id: String,
}

// Events belong to the most recent location boundary at or before them, so the
// window is closed at this visit's start and open at the next visit's start.
fn load_events(
    db: &DatabaseService,
    owner_id: OwnerRowId,
    owner_user_id: &str,
    start: &str,
    end: Option<&str>,
) -> Result<Vec<JoinLeaveEvent>, Error> {
    let mut sql = String::from(
        "SELECT created_at, type, display_name, user_id
         FROM gamelog_join_leave
         WHERE owner_id IN (0, @owner_id) AND created_at >= @start
           AND type IN ('OnPlayerJoined', 'OnPlayerLeft') AND display_name <> ''",
    );
    let mut params = ParamsBuilder::new()
        .set("owner_id", owner_id)
        .set("start", parse_epoch_seconds(start))
        .set("scan_limit", EVENT_SCAN_LIMIT);
    if let Some(end) = end {
        sql.push_str(" AND created_at < @end");
        params = params.set("end", parse_epoch_seconds(end));
    }
    if !owner_user_id.is_empty() {
        sql.push_str(" AND COALESCE(user_id, '') <> @owner_user_id");
        params = params.set("owner_user_id", owner_user_id.to_string());
    }
    sql.push_str(" ORDER BY created_at ASC, id ASC LIMIT @scan_limit");
    Ok(db
        .execute(&sql, &params.build())?
        .into_iter()
        .map(|row| JoinLeaveEvent {
            created_at: row_iso(&row, 0),
            joined: row_string(&row, 1) == "OnPlayerJoined",
            display_name: row_string(&row, 2),
            user_id: row_string(&row, 3),
        })
        .collect())
}

#[derive(Default)]
struct RosterAccumulator {
    user_id: String,
    display_name: String,
    stints: Vec<VisitStint>,
}

fn fold_roster(
    events: Vec<JoinLeaveEvent>,
    visit_left_at: Option<&str>,
    friend_ids: &HashSet<String>,
) -> Vec<VisitRosterRow> {
    let mut grouped: BTreeMap<String, RosterAccumulator> = BTreeMap::new();
    for event in events {
        let key = if event.user_id.trim().is_empty() {
            format!("name:{}", event.display_name)
        } else {
            event.user_id.clone()
        };
        let entry = grouped.entry(key).or_insert_with(|| RosterAccumulator {
            user_id: event.user_id.clone(),
            display_name: event.display_name.clone(),
            ..RosterAccumulator::default()
        });
        entry.display_name = event.display_name;
        let open_stint = entry
            .stints
            .last_mut()
            .filter(|stint| stint.left_at.is_none());
        match (event.joined, open_stint) {
            (true, _) => entry.stints.push(VisitStint {
                joined_at: Some(event.created_at),
                left_at: None,
            }),
            (false, Some(stint)) => stint.left_at = Some(event.created_at),
            (false, None) => entry.stints.push(VisitStint {
                joined_at: None,
                left_at: Some(event.created_at),
            }),
        }
    }

    let mut rows = grouped
        .into_values()
        .map(|entry| {
            let shared_minutes = entry
                .stints
                .iter()
                .map(|stint| stint_minutes(stint, visit_left_at))
                .sum();
            VisitRosterRow {
                is_friend: !entry.user_id.is_empty() && friend_ids.contains(&entry.user_id),
                user_id: entry.user_id,
                display_name: entry.display_name,
                first_joined_at: entry
                    .stints
                    .iter()
                    .filter_map(|stint| stint.joined_at.clone())
                    .next(),
                last_left_at: entry
                    .stints
                    .iter()
                    .rev()
                    .filter_map(|stint| stint.left_at.clone())
                    .next(),
                shared_minutes,
                stints: entry.stints,
            }
        })
        .collect::<Vec<_>>();
    rows.sort_by(|left, right| {
        right
            .shared_minutes
            .cmp(&left.shared_minutes)
            .then_with(|| left.first_joined_at.cmp(&right.first_joined_at))
            .then_with(|| left.display_name.cmp(&right.display_name))
    });
    rows
}

// A stint with no leave event only counts while the visit's own end is known;
// otherwise its length is unknowable and contributes nothing.
fn stint_minutes(stint: &VisitStint, visit_left_at: Option<&str>) -> i64 {
    let Some(joined_at) = stint.joined_at.as_deref().and_then(parse_timestamp) else {
        return 0;
    };
    let Some(left_at) = stint
        .left_at
        .as_deref()
        .or(visit_left_at)
        .and_then(parse_timestamp)
    else {
        return 0;
    };
    millis_to_minutes((left_at - joined_at).num_milliseconds().max(0))
}

fn parse_timestamp(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|value| value.with_timezone(&Utc))
}

pub(super) fn shift_timestamp(value: &str, millis: i64) -> Option<String> {
    let shifted = parse_timestamp(value)? + Duration::milliseconds(millis);
    Some(shifted.format(TIMESTAMP_FORMAT).to_string())
}

fn visit_summary(visit: &VisitRow, roster: &[VisitRosterRow], people_observed: usize) -> String {
    let world = if visit.world_name.is_empty() {
        visit.location.clone()
    } else {
        visit.world_name.clone()
    };
    let span = match visit.left_at.as_deref() {
        Some(left_at) => format!(
            "from {} to {left_at} ({})",
            visit.joined_at,
            format_minutes(visit.stay_minutes)
        ),
        None if visit.in_progress => format!("since {} (still there)", visit.joined_at),
        None => format!("from {} (leave time not recorded)", visit.joined_at),
    };
    let mut summary = format!("You were in {world} {span}; {people_observed} people observed.");
    let top = roster
        .iter()
        .filter(|row| row.shared_minutes > 0)
        .take(3)
        .map(|row| {
            format!(
                "{} ({})",
                row.display_name,
                format_minutes(row.shared_minutes)
            )
        })
        .collect::<Vec<_>>();
    if !top.is_empty() {
        summary.push_str(&format!(" Longest with you: {}.", top.join(", ")));
    }
    summary
}
