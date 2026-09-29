use chrono::DateTime;
use vrcx_0_core::activity_heatmap::{
    activity_normalize_config, compute_activity_view, compute_overlap_view, normalize_buckets,
    overlap_normalize_config, ExcludeHours, NormalizeConfig, OverlapViewOptions,
};
use vrcx_0_core::activity_sessions::ActivitySession;

const HOUR: i64 = 60 * 60 * 1000;
const DAY: i64 = 24 * HOUR;

fn ms(value: &str) -> i64 {
    DateTime::parse_from_rfc3339(value)
        .unwrap()
        .timestamp_millis()
}

fn session(start: &str, end: &str) -> ActivitySession {
    ActivitySession {
        start: ms(start),
        end: ms(end),
        is_open_tail: false,
        source_revision: String::new(),
    }
}

#[test]
fn activity_heatmap_uses_sunday_zero_hour_slots() {
    let now_ms = ms("2025-01-06T00:00:00Z");
    let view = compute_activity_view(
        &[session("2025-01-05T01:30:00Z", "2025-01-05T02:30:00Z")],
        7,
        now_ms,
        0,
        &activity_normalize_config(true, 7),
        8 * HOUR,
    );

    assert_eq!(view.raw_buckets.len(), 168);
    assert_eq!(view.raw_buckets[1], 30.0);
    assert_eq!(view.raw_buckets[2], 30.0);
    assert_eq!(view.peak_day_index, 0);
    assert_eq!(view.peak_hour_start, 1);
    assert_eq!(view.peak_hour_end, 3);
    assert_eq!(view.filtered_event_count, 1);
}

#[test]
fn activity_heatmap_applies_fixed_utc_offset_before_slotting() {
    let now_ms = ms("2025-01-06T00:00:00Z");
    let view = compute_activity_view(
        &[session("2025-01-04T18:00:00Z", "2025-01-04T19:00:00Z")],
        7,
        now_ms,
        540,
        &activity_normalize_config(true, 7),
        8 * HOUR,
    );

    assert_eq!(view.raw_buckets[3], 60.0);
    assert_eq!(view.peak_day_index, 0);
    assert_eq!(view.peak_hour_start, 3);
    assert_eq!(view.peak_hour_end, 4);
}

#[test]
fn activity_heatmap_normalize_keeps_tied_values_equal() {
    let now_ms = ms("2025-01-06T00:00:00Z");
    let view = compute_activity_view(
        &[
            session("2025-01-05T01:00:00Z", "2025-01-05T02:00:00Z"),
            session("2025-01-05T03:00:00Z", "2025-01-05T04:00:00Z"),
        ],
        7,
        now_ms,
        0,
        &activity_normalize_config(true, 7),
        8 * HOUR,
    );

    assert_eq!(view.normalized_buckets.len(), 168);
    assert!(view.normalized_buckets[1] > 0.0);
    assert_eq!(view.normalized_buckets[1], view.normalized_buckets[3]);
}

#[test]
fn activity_heatmap_overlap_excludes_cross_midnight_hours_before_percent() {
    let now_ms = ms("2025-01-06T00:00:00Z");
    let sessions = [session("2025-01-05T00:00:00Z", "2025-01-05T04:00:00Z")];

    let view = compute_overlap_view(
        &sessions,
        &sessions,
        OverlapViewOptions {
            range_days: 7,
            now_ms,
            offset_minutes: 0,
            exclude_hours: Some(ExcludeHours {
                start_hour: 22,
                end_hour: 2,
            }),
            config: overlap_normalize_config(7),
            max_session_ms: 8 * HOUR,
        },
    );

    assert_eq!(view.raw_buckets[0], 0.0);
    assert_eq!(view.raw_buckets[1], 0.0);
    assert_eq!(view.raw_buckets[2], 60.0);
    assert_eq!(view.raw_buckets[3], 60.0);
    assert_eq!(view.overlap_percent, 100);
    assert_eq!(view.best_day_index, 0);
    assert_eq!(view.best_hour_start, 2);
    assert_eq!(view.best_hour_end, 4);
}

#[test]
fn normalize_buckets_confidence_uses_effective_range_days() {
    let mut buckets = vec![0.0; 168];
    for slot in buckets.iter_mut().take(40) {
        *slot = 120.0;
    }
    let base = NormalizeConfig {
        floor_percentile: 15.0,
        cap_percentile: 85.0,
        rank_weight: 0.2,
        target_coverage: 0.3,
        target_volume: 40.0,
        range_days: 3.0,
    };

    let effective = normalize_buckets(&buckets, base);
    let nominal = normalize_buckets(
        &buckets,
        NormalizeConfig {
            range_days: 3650.0,
            ..base
        },
    );

    let effective_sum: f64 = effective.iter().sum();
    let nominal_sum: f64 = nominal.iter().sum();
    assert!(effective_sum > 0.0);
    assert!(effective_sum > nominal_sum);
    assert!(nominal_sum < effective_sum * 0.5);
}

#[test]
fn activity_heatmap_clamps_sessions_to_requested_range() {
    let now_ms = ms("2025-01-06T00:00:00Z");
    let view = compute_activity_view(
        &[ActivitySession {
            start: now_ms - 8 * DAY,
            end: now_ms - 7 * DAY + HOUR,
            is_open_tail: false,
            source_revision: String::new(),
        }],
        7,
        now_ms,
        0,
        &activity_normalize_config(true, 7),
        8 * HOUR,
    );

    assert_eq!(view.filtered_event_count, 1);
    assert_eq!(view.raw_buckets.iter().sum::<f64>(), 60.0);
}
