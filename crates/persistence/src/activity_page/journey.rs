use std::collections::{BTreeSet, HashMap};

use super::spans::{read_source_rows, unclosed_stays_sql};
use crate::activity::activity_ms_from_value;
use crate::common::{row_i64, row_string, row_value, ParamsBuilder};
use crate::database::DatabaseService;
use crate::game_log::ensure_game_log_tables;
use crate::ownership::{owner_id_for_filter, OwnerId};
use crate::player_list::world_summaries_get;
use crate::social_aggregates::current_friend_id_set;
use crate::Error;
use vrcx_0_core::time::epoch_from_millis;

use vrcx_0_contracts::activity_page::{ActivityJourneyCompanion, ActivityJourneyVisit};

const COMPANION_LEAVE_GRACE_MS: i64 = 60_000;

/// A visit with its bounds in milliseconds while companions are folded in.
struct VisitSpan {
    start_ms: i64,
    end_ms: i64,
    visit: ActivityJourneyVisit,
}

struct CompanionLeave {
    left_ms: i64,
    time: i64,
    location: String,
    user_id: String,
    display_name: String,
}

pub fn read_journey_visits(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    from_ms: i64,
    to_ms: i64,
) -> Result<Vec<ActivityJourneyVisit>, Error> {
    let mut visits = read_source_rows(db, owner_user_id, Some(from_ms), to_ms)?
        .into_iter()
        .filter_map(|row| {
            let end_ms = row.left_ms;
            let start_ms = end_ms.checked_sub(row.time)?;
            Some(VisitSpan {
                start_ms,
                end_ms,
                visit: ActivityJourneyVisit {
                    location: row.location,
                    world_id: row.world_id,
                    world_name: row.world_name,
                    world_image_url: String::new(),
                    start_at: epoch_from_millis(start_ms),
                    end_at: epoch_from_millis(end_ms),
                    companions: Vec::new(),
                },
            })
        })
        .filter(|span| span.end_ms > from_ms && span.start_ms < to_ms)
        .collect::<Vec<_>>();
    let (Some(first_start), Some(last_end)) = (
        visits.iter().map(|span| span.start_ms).min(),
        visits.iter().map(|span| span.end_ms).max(),
    ) else {
        return Ok(Vec::new());
    };

    let leaves = read_companion_leaves(
        db,
        owner_user_id,
        first_start,
        last_end + COMPANION_LEAVE_GRACE_MS,
    )?;
    let friend_ids = current_friend_id_set(db, owner_user_id)?;
    let worlds = world_summaries_get(
        db,
        owner_user_id,
        visits
            .iter()
            .map(|span| span.visit.world_id.clone())
            .collect(),
    )?;
    for span in &mut visits {
        span.visit.companions = fold_companions(span, &leaves, &friend_ids);
        let visit = &mut span.visit;
        if let Some(world) = worlds.get(&visit.world_id) {
            visit.world_image_url = if world.thumbnail_image_url.is_empty() {
                world.image_url.clone()
            } else {
                world.thumbnail_image_url.clone()
            };
        }
    }
    Ok(visits.into_iter().map(|span| span.visit).collect())
}

fn fold_companions(
    visit: &VisitSpan,
    leaves: &[CompanionLeave],
    friend_ids: &std::collections::HashSet<String>,
) -> Vec<ActivityJourneyCompanion> {
    let mut by_person: HashMap<String, ActivityJourneyCompanion> = HashMap::new();
    for leave in leaves.iter().filter(|leave| {
        leave.location == visit.visit.location
            && leave.left_ms >= visit.start_ms
            && leave.left_ms <= visit.end_ms + COMPANION_LEAVE_GRACE_MS
            && leave.left_ms - leave.time <= visit.end_ms
    }) {
        let key = if leave.user_id.is_empty() {
            format!("name:{}", leave.display_name)
        } else {
            leave.user_id.clone()
        };
        let shared_ms = (leave.left_ms.min(visit.end_ms)
            - (leave.left_ms - leave.time).max(visit.start_ms))
        .max(0);
        let companion = by_person
            .entry(key)
            .or_insert_with(|| ActivityJourneyCompanion {
                is_friend: friend_ids.contains(&leave.user_id),
                user_id: leave.user_id.clone(),
                ..ActivityJourneyCompanion::default()
            });
        companion.display_name = leave.display_name.clone();
        companion.shared_ms += shared_ms;
    }
    let mut companions = by_person.into_values().collect::<Vec<_>>();
    companions.sort_by(|left, right| {
        right
            .shared_ms
            .cmp(&left.shared_ms)
            .then_with(|| left.display_name.cmp(&right.display_name))
    });
    companions
}

fn read_companion_leaves(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    from_ms: i64,
    to_ms: i64,
) -> Result<Vec<CompanionLeave>, Error> {
    ensure_game_log_tables(db)?;
    let rows = db.execute(
        "SELECT created_at, time, COALESCE(location, ''), COALESCE(user_id, ''),
                COALESCE(display_name, '')
         FROM gamelog_join_leave
         WHERE owner_id IN (0, @owner_id)
           AND type = 'OnPlayerLeft'
           AND created_at >= @from
           AND created_at <= @to
           AND COALESCE(user_id, '') <> @owner_user_id
           AND NOT (trim(COALESCE(user_id, '')) = '' AND trim(COALESCE(display_name, '')) = '')
         ORDER BY created_at ASC, id ASC",
        &ParamsBuilder::new()
            .set("owner_id", owner_id_for_filter(db, owner_user_id)?)
            .set("owner_user_id", owner_user_id.as_str())
            .set("from", epoch_from_millis(from_ms))
            .set("to", epoch_from_millis(to_ms))
            .build(),
    )?;
    Ok(rows
        .into_iter()
        .filter_map(|row| {
            Some(CompanionLeave {
                left_ms: activity_ms_from_value(row_value(&row, 0))?,
                time: row_i64(&row, 1).max(0),
                location: row_string(&row, 2),
                user_id: row_string(&row, 3),
                display_name: row_string(&row, 4),
            })
        })
        .collect())
}

pub fn read_journey_days(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    utc_offset_minutes: i64,
) -> Result<Vec<String>, Error> {
    ensure_game_log_tables(db)?;
    let rows = db.execute(
        &format!(
            "SELECT created_at - time / 1000, created_at
             FROM gamelog_join_leave
             WHERE owner_id IN (0, @owner_id)
               AND user_id = @user_id
               AND type = 'OnPlayerLeft'
               AND time > 0
             UNION ALL
             SELECT started_at, last_at
             FROM ({})
             WHERE last_at > started_at",
            unclosed_stays_sql("")
        ),
        &ParamsBuilder::new()
            .set("owner_id", owner_id_for_filter(db, owner_user_id)?)
            .set("user_id", owner_user_id.as_str())
            .build(),
    )?;
    let local_day = |seconds| {
        if utc_offset_minutes
            == i64::from(vrcx_0_core::time::display_now().offset().local_minus_utc()) / 60
        {
            vrcx_0_core::time::to_display(seconds).map(|date| date.date_naive())
        } else {
            chrono::DateTime::from_timestamp(seconds + utc_offset_minutes * 60, 0)
                .map(|date| date.date_naive())
        }
    };
    let mut days = BTreeSet::new();
    for row in rows {
        let (Some(start), Some(end)) = (local_day(row_i64(&row, 0)), local_day(row_i64(&row, 1)))
        else {
            continue;
        };
        days.extend(
            start
                .iter_days()
                .take_while(|day| *day <= end)
                .map(|day| day.format("%Y-%m-%d").to_string()),
        );
    }
    Ok(days.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db(name: &str) -> DatabaseService {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "vrcx-0-journey-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let db = DatabaseService::new(&dir.join("VRCX-0.sqlite3")).unwrap();
        ensure_game_log_tables(&db).unwrap();
        db
    }

    fn leave(db: &DatabaseService, created_at: i64, name: &str, user_id: &str, time: i64) {
        db.execute_non_query(
            "INSERT INTO gamelog_join_leave (created_at, type, display_name, location, user_id, time)
             VALUES (@created_at, 'OnPlayerLeft', @name, 'wrld_a:1~friends', @user_id, @time)",
            &ParamsBuilder::new()
                .set("created_at", created_at)
                .set("name", name)
                .set("user_id", user_id)
                .set("time", time)
                .build(),
        )
        .unwrap();
    }

    fn location(db: &DatabaseService, created_at: i64, location: &str, time: i64) {
        db.execute_non_query(
            "INSERT INTO gamelog_location (created_at, location, world_id, world_name, time)
             VALUES (@created_at, @location, 'wrld_a', 'Alpha', @time)",
            &ParamsBuilder::new()
                .set("created_at", created_at)
                .set("location", location)
                .set("time", time)
                .build(),
        )
        .unwrap();
    }

    fn video(db: &DatabaseService, created_at: i64) {
        db.execute_non_query(
            "INSERT INTO gamelog_video_play (created_at, video_url, location)
             VALUES (@created_at, @created_at, 'wrld_a:1~friends')",
            &ParamsBuilder::new().set("created_at", created_at).build(),
        )
        .unwrap();
    }

    fn ms(seconds: i64) -> i64 {
        seconds * 1000
    }

    const MINUTE: i64 = 60_000;

    #[test]
    fn visits_carry_companions_with_shared_time_clipped_to_the_visit() {
        let db = test_db("companions");
        let owner = OwnerId::new("usr_me");
        leave(&db, 1791201600, "Me", "usr_me", 120 * MINUTE);
        leave(&db, 1791196800, "Alice", "usr_alice", 30 * MINUTE);
        leave(&db, 1791199800, "Alice", "usr_alice", 20 * MINUTE);
        leave(&db, 1791201630, "Bob", "usr_bob", 300 * MINUTE);
        leave(&db, 1791205200, "Carol", "usr_carol", 10 * MINUTE);

        let visits = read_journey_visits(&db, &owner, ms(1791158400), ms(1791244800)).unwrap();

        assert_eq!(visits.len(), 1);
        assert_eq!(visits[0].start_at, 1791194400);
        assert_eq!(visits[0].end_at, 1791201600);
        let shared = visits[0]
            .companions
            .iter()
            .map(|companion| (companion.display_name.as_str(), companion.shared_ms))
            .collect::<Vec<_>>();
        assert_eq!(shared, vec![("Bob", 120 * MINUTE), ("Alice", 50 * MINUTE)]);
    }

    #[test]
    fn journey_days_cover_every_local_day_a_visit_touches() {
        let db = test_db("days");
        let owner = OwnerId::new("usr_me");
        leave(&db, 1791271800, "Me", "usr_me", 8 * 60 * MINUTE);
        leave(&db, 1791428400, "Me", "usr_me", 0);

        assert_eq!(
            read_journey_days(&db, &owner, 0).unwrap(),
            vec!["2026-10-05", "2026-10-06"]
        );
        assert_eq!(
            read_journey_days(&db, &owner, 9 * 60).unwrap(),
            vec!["2026-10-06"]
        );
    }

    #[test]
    fn unclosed_stays_end_at_their_last_logged_event() {
        let db = test_db("unclosed");
        let owner = OwnerId::new("usr_me");
        location(&db, 1791187200, "wrld_a:1~friends", 0);
        leave(&db, 1791190800, "Me", "usr_me", 60 * MINUTE);
        location(&db, 1791241200, "wrld_a:1~friends", 0);
        leave(&db, 1791246600, "Alice", "usr_alice", 30 * MINUTE);
        video(&db, 1791249300);

        let visits = read_journey_visits(&db, &owner, ms(1791158400), ms(1791331200)).unwrap();

        let spans = visits
            .iter()
            .map(|visit| (visit.start_at, visit.end_at))
            .collect::<Vec<_>>();
        assert_eq!(
            spans,
            vec![(1791187200, 1791190800), (1791241200, 1791249300)]
        );
        assert_eq!(visits[1].world_name, "Alpha");
        assert_eq!(visits[1].companions.len(), 1);
        assert_eq!(visits[1].companions[0].shared_ms, 30 * MINUTE);
        assert_eq!(
            read_journey_days(&db, &owner, 0).unwrap(),
            vec!["2026-10-05", "2026-10-06"]
        );
    }
}
