use std::collections::{BTreeMap, BTreeSet};

use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc};
use vrcx_0_core::activity_sessions::{
    merge_sessions_with_gap, ActivitySession, PLAY_SESSION_MERGE_GAP_MS,
};

use super::activity_iso_from_ms;
use vrcx_0_contracts::activity_page::ActivityLocationSpan as LocationSpan;
use vrcx_0_contracts::activity_page::{
    ActivityPageAccessSlice, ActivityPagePreviousSummary, ActivityPageSeries, ActivityPageSummary,
    ActivityPageWorldRow, ActivityPageWorlds, ActivitySeriesBucket, ActivitySeriesPoint,
};

pub(super) const WEEK_BUCKET_MIN_RANGE_DAYS: i64 = 180;
const DAY_MS: i64 = 86_400_000;
const MINUTE_MS: i64 = 60_000;

pub(super) fn series_bucket_for_range(range_days: i64) -> ActivitySeriesBucket {
    if range_days == 0 || range_days >= WEEK_BUCKET_MIN_RANGE_DAYS {
        ActivitySeriesBucket::Week
    } else {
        ActivitySeriesBucket::Day
    }
}

pub(super) fn summarize(
    spans: &[LocationSpan],
    window_days: i64,
    utc_offset_minutes: i64,
) -> ActivityPageSummary {
    let sessions = merged_sessions(spans);
    ActivityPageSummary {
        total_minutes: present_minutes(spans),
        window_days,
        active_days: active_days(spans, utc_offset_minutes),
        session_count: i64::try_from(sessions.len()).unwrap_or(i64::MAX),
        longest_session_minutes: sessions
            .iter()
            .map(|session| session.end - session.start)
            .max()
            .unwrap_or(0)
            / MINUTE_MS,
    }
}

pub(super) fn summarize_previous(
    spans: &[LocationSpan],
    utc_offset_minutes: i64,
) -> ActivityPagePreviousSummary {
    if spans.is_empty() {
        return ActivityPagePreviousSummary::default();
    }
    ActivityPagePreviousSummary {
        total_minutes: present_minutes(spans),
        active_days: active_days(spans, utc_offset_minutes),
        has_data: true,
    }
}

pub(super) fn access_split(spans: &[LocationSpan]) -> Vec<ActivityPageAccessSlice> {
    let mut totals: BTreeMap<String, i64> = BTreeMap::new();
    for span in spans {
        *totals.entry(span.access_bucket.clone()).or_insert(0) += span.end_ms - span.start_ms;
    }
    let mut slices: Vec<ActivityPageAccessSlice> = totals
        .into_iter()
        .filter_map(|(access, millis)| {
            let minutes = millis / MINUTE_MS;
            (minutes > 0).then_some(ActivityPageAccessSlice { access, minutes })
        })
        .collect();
    slices.sort_by(|left, right| {
        right
            .minutes
            .cmp(&left.minutes)
            .then_with(|| left.access.cmp(&right.access))
    });
    slices
}

pub(super) fn series(
    spans: &[LocationSpan],
    bucket: ActivitySeriesBucket,
    utc_offset_minutes: i64,
) -> ActivityPageSeries {
    let bucket_key = |day: NaiveDate| match bucket {
        ActivitySeriesBucket::Day => day,
        ActivitySeriesBucket::Week => week_start(day),
    };
    let mut totals: BTreeMap<NaiveDate, i64> = BTreeMap::new();
    for (day, millis) in millis_by_local_day(spans, utc_offset_minutes) {
        *totals.entry(bucket_key(day)).or_insert(0) += millis;
    }
    ActivityPageSeries {
        bucket,
        points: totals
            .into_iter()
            .map(|(start, millis)| ActivitySeriesPoint {
                start_date: start.format("%Y-%m-%d").to_string(),
                minutes: millis / MINUTE_MS,
            })
            .collect(),
    }
}

pub(super) fn worlds(
    spans: &[LocationSpan],
    earlier_world_ids: &BTreeSet<String>,
    limit: usize,
) -> ActivityPageWorlds {
    let mut totals: BTreeMap<String, WorldAccumulator> = BTreeMap::new();
    for span in spans {
        if span.world_id.is_empty() {
            continue;
        }
        let entry = totals
            .entry(span.world_id.clone())
            .or_insert_with(|| WorldAccumulator {
                millis: 0,
                visit_count: 0,
                world_name: String::new(),
                name_seen_ms: i64::MIN,
                first_seen_ms: span.start_ms,
                last_seen_ms: span.start_ms,
            });
        entry.millis += span.end_ms - span.start_ms;
        entry.visit_count += 1;
        entry.first_seen_ms = entry.first_seen_ms.min(span.start_ms);
        entry.last_seen_ms = entry.last_seen_ms.max(span.start_ms);
        if !span.world_name.is_empty() && span.start_ms >= entry.name_seen_ms {
            entry.world_name = span.world_name.clone();
            entry.name_seen_ms = span.start_ms;
        }
    }

    let distinct_count = i64::try_from(totals.len()).unwrap_or(i64::MAX);
    let mut new_world_millis = 0;
    let mut returning_world_millis = 0;
    for (world_id, entry) in &totals {
        if earlier_world_ids.contains(world_id) {
            returning_world_millis += entry.millis;
        } else {
            new_world_millis += entry.millis;
        }
    }

    let mut rows: Vec<ActivityPageWorldRow> = totals
        .into_iter()
        .map(|(world_id, entry)| ActivityPageWorldRow {
            world_id,
            world_name: entry.world_name,
            minutes: entry.millis / MINUTE_MS,
            visit_count: entry.visit_count,
            first_seen_at: activity_iso_from_ms(entry.first_seen_ms),
            last_seen_at: activity_iso_from_ms(entry.last_seen_ms),
        })
        .collect();
    rows.sort_by(|left, right| {
        right
            .minutes
            .cmp(&left.minutes)
            .then_with(|| right.visit_count.cmp(&left.visit_count))
            .then_with(|| left.world_id.cmp(&right.world_id))
    });
    rows.truncate(limit);

    ActivityPageWorlds {
        top: rows,
        distinct_count,
        new_world_minutes: new_world_millis / MINUTE_MS,
        returning_world_minutes: returning_world_millis / MINUTE_MS,
    }
}

struct WorldAccumulator {
    millis: i64,
    visit_count: i64,
    world_name: String,
    name_seen_ms: i64,
    first_seen_ms: i64,
    last_seen_ms: i64,
}

fn merged_sessions(spans: &[LocationSpan]) -> Vec<ActivitySession> {
    let sessions: Vec<ActivitySession> = spans
        .iter()
        .map(|span| ActivitySession {
            start: span.start_ms,
            end: span.end_ms,
            is_open_tail: false,
            source_revision: String::new(),
        })
        .collect();
    merge_sessions_with_gap(&[], &sessions, PLAY_SESSION_MERGE_GAP_MS)
}

pub(super) fn present_minutes(spans: &[LocationSpan]) -> i64 {
    merge_sessions_with_gap(&[], &spans_as_sessions(spans), 0)
        .iter()
        .map(|session| session.end - session.start)
        .sum::<i64>()
        / MINUTE_MS
}

fn spans_as_sessions(spans: &[LocationSpan]) -> Vec<ActivitySession> {
    spans
        .iter()
        .map(|span| ActivitySession {
            start: span.start_ms,
            end: span.end_ms,
            is_open_tail: false,
            source_revision: String::new(),
        })
        .collect()
}

fn active_days(spans: &[LocationSpan], utc_offset_minutes: i64) -> i64 {
    let days: BTreeSet<NaiveDate> = millis_by_local_day(spans, utc_offset_minutes)
        .into_iter()
        .filter_map(|(day, millis)| (millis > 0).then_some(day))
        .collect();
    i64::try_from(days.len()).unwrap_or(i64::MAX)
}

fn millis_by_local_day<'a>(
    spans: impl IntoIterator<Item = &'a LocationSpan>,
    utc_offset_minutes: i64,
) -> BTreeMap<NaiveDate, i64> {
    let offset_ms = utc_offset_minutes * MINUTE_MS;
    let mut totals: BTreeMap<NaiveDate, i64> = BTreeMap::new();
    for span in spans {
        let mut cursor_ms = span.start_ms + offset_ms;
        let shifted_end_ms = span.end_ms + offset_ms;
        while cursor_ms < shifted_end_ms {
            let day_end_ms = cursor_ms.div_euclid(DAY_MS) * DAY_MS + DAY_MS;
            let slice_end_ms = day_end_ms.min(shifted_end_ms);
            if let Some(day) = local_date(cursor_ms) {
                *totals.entry(day).or_insert(0) += slice_end_ms - cursor_ms;
            }
            cursor_ms = slice_end_ms;
        }
    }
    totals
}

fn local_date(shifted_ms: i64) -> Option<NaiveDate> {
    DateTime::<Utc>::from_timestamp_millis(shifted_ms).map(|value| value.date_naive())
}

fn week_start(day: NaiveDate) -> NaiveDate {
    day - Duration::days(i64::from(day.weekday().num_days_from_monday()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASE: i64 = 1_700_000_000_000;
    const HOUR: i64 = 3_600_000;

    fn span(start_ms: i64, end_ms: i64, world_id: &str, access: &str) -> LocationSpan {
        LocationSpan {
            start_ms,
            end_ms,
            world_id: world_id.into(),
            world_name: format!("{world_id} name"),
            access_bucket: access.into(),
        }
    }

    #[test]
    fn summary_merges_adjacent_spans_into_one_session() {
        let spans = vec![
            span(BASE, BASE + HOUR, "wrld_a", "public"),
            span(BASE + HOUR, BASE + 2 * HOUR, "wrld_b", "friends"),
        ];

        let summary = summarize(&spans, 30, 0);

        assert_eq!(summary.session_count, 1);
        assert_eq!(summary.total_minutes, 120);
        assert_eq!(summary.longest_session_minutes, 120);
    }

    #[test]
    fn summary_total_matches_world_total_without_overlap() {
        let spans = vec![
            span(BASE, BASE + HOUR, "wrld_a", "public"),
            span(BASE + HOUR, BASE + 3 * HOUR, "wrld_b", "friends"),
        ];

        let summary = summarize(&spans, 30, 0);
        let world_minutes: i64 = worlds(&spans, &BTreeSet::new(), 10)
            .top
            .iter()
            .map(|row| row.minutes)
            .sum();

        assert_eq!(summary.total_minutes, world_minutes);
    }

    #[test]
    fn summary_total_is_lower_than_world_total_when_spans_overlap() {
        let spans = vec![
            span(BASE, BASE + 2 * HOUR, "wrld_a", "public"),
            span(BASE + HOUR, BASE + 3 * HOUR, "wrld_b", "friends"),
        ];

        let summary = summarize(&spans, 30, 0);
        let world_minutes: i64 = worlds(&spans, &BTreeSet::new(), 10)
            .top
            .iter()
            .map(|row| row.minutes)
            .sum();

        assert_eq!(summary.total_minutes, 180);
        assert_eq!(world_minutes, 240);
    }

    #[test]
    fn active_days_split_spans_crossing_local_midnight() {
        let midnight = BASE - BASE.rem_euclid(DAY_MS);
        let spans = vec![span(
            midnight + 23 * HOUR,
            midnight + 25 * HOUR,
            "wrld_a",
            "public",
        )];

        assert_eq!(active_days(&spans, 0), 2);
    }

    #[test]
    fn series_groups_days_into_iso_weeks() {
        let monday = NaiveDate::from_ymd_opt(2024, 1, 1).expect("valid date");
        assert_eq!(week_start(monday), monday);
        assert_eq!(
            week_start(NaiveDate::from_ymd_opt(2024, 1, 7).expect("valid date")),
            monday
        );
    }

    #[test]
    fn series_bucket_switches_to_week_for_long_ranges() {
        assert_eq!(series_bucket_for_range(30), ActivitySeriesBucket::Day);
        assert_eq!(series_bucket_for_range(90), ActivitySeriesBucket::Day);
        assert_eq!(series_bucket_for_range(180), ActivitySeriesBucket::Week);
        assert_eq!(series_bucket_for_range(0), ActivitySeriesBucket::Week);
    }

    #[test]
    fn access_split_drops_empty_buckets_and_sorts_by_minutes() {
        let spans = vec![
            span(BASE, BASE + HOUR, "wrld_a", "friends"),
            span(BASE + HOUR, BASE + 3 * HOUR, "wrld_b", "public"),
            span(BASE + 3 * HOUR, BASE + 3 * HOUR + 1000, "wrld_c", "invite"),
        ];

        let slices = access_split(&spans);

        assert_eq!(slices.len(), 2);
        assert_eq!(slices[0].access, "public");
        assert_eq!(slices[0].minutes, 120);
        assert_eq!(slices[1].access, "friends");
    }

    #[test]
    fn worlds_keep_the_most_recent_game_log_name() {
        let mut older = span(BASE, BASE + HOUR, "wrld_a", "public");
        older.world_name = "Old Name".into();
        let mut newer = span(BASE + 2 * HOUR, BASE + 3 * HOUR, "wrld_a", "public");
        newer.world_name = "New Name".into();
        let mut unnamed = span(BASE + 4 * HOUR, BASE + 5 * HOUR, "wrld_a", "public");
        unnamed.world_name = String::new();

        let result = worlds(&[older, newer, unnamed], &BTreeSet::new(), 10);

        assert_eq!(result.top[0].world_name, "New Name");
    }

    #[test]
    fn worlds_split_new_and_returning_minutes() {
        let spans = vec![
            span(BASE, BASE + HOUR, "wrld_new", "public"),
            span(BASE + HOUR, BASE + 3 * HOUR, "wrld_old", "public"),
        ];
        let earlier: BTreeSet<String> = ["wrld_old".to_string()].into_iter().collect();

        let result = worlds(&spans, &earlier, 10);

        assert_eq!(result.distinct_count, 2);
        assert_eq!(result.new_world_minutes, 60);
        assert_eq!(result.returning_world_minutes, 120);
    }
}
