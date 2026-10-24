use chrono::{Datelike, Timelike, Utc};

use crate::activity_sessions::ActivitySession;

const BUCKET_COUNT: usize = 168;
const DAYS_PER_WEEK: usize = 7;
const HOURS_PER_DAY: usize = 24;
const MS_PER_MINUTE: i64 = 60_000;
const MS_PER_HOUR: i64 = 60 * MS_PER_MINUTE;
const MS_PER_DAY: i64 = 24 * MS_PER_HOUR;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NormalizeConfig {
    pub floor_percentile: f64,
    pub cap_percentile: f64,
    pub rank_weight: f64,
    pub target_coverage: f64,
    pub target_volume: f64,
    pub range_days: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ExcludeHours {
    pub start_hour: i32,
    pub end_hour: i32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ActivityView {
    pub raw_buckets: Vec<f64>,
    pub normalized_buckets: Vec<f64>,
    pub peak_day_index: i32,
    pub peak_hour_start: i32,
    pub peak_hour_end: i32,
    pub filtered_event_count: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct OverlapView {
    pub raw_buckets: Vec<f64>,
    pub normalized_buckets: Vec<f64>,
    pub overlap_percent: i32,
    pub best_day_index: i32,
    pub best_hour_start: i32,
    pub best_hour_end: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ActivityPeakIndices {
    pub peak_day_index: i32,
    pub peak_hour_start: i32,
    pub peak_hour_end: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OverlapBestIndices {
    pub best_day_index: i32,
    pub best_hour_start: i32,
    pub best_hour_end: i32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OverlapViewOptions {
    pub range_days: i64,
    pub now_ms: i64,
    pub offset_minutes: i64,
    pub exclude_hours: Option<ExcludeHours>,
    pub config: NormalizeConfig,
    pub max_session_ms: i64,
}

pub fn activity_normalize_config(is_self: bool, range_days: i64) -> NormalizeConfig {
    match range_days {
        7 => config(10.0, 80.0, 0.15, 0.12, 40.0, range_days),
        30 => config(15.0, 85.0, 0.2, 0.25, 60.0, range_days),
        90 => config(15.0, 85.0, 0.2, 0.3, 50.0, range_days),
        180 => config(15.0, 85.0, 0.2, 0.3, 45.0, range_days),
        365 => config(15.0, 85.0, 0.2, 0.35, 40.0, range_days),
        _ if is_self => config(15.0, 85.0, 0.2, 0.25, 60.0, range_days),
        _ => config(15.0, 85.0, 0.2, 0.2, 35.0, range_days),
    }
}

pub fn overlap_normalize_config(range_days: i64) -> NormalizeConfig {
    match range_days {
        7 => config(10.0, 80.0, 0.15, 0.08, 15.0, range_days),
        90 => config(15.0, 85.0, 0.2, 0.18, 20.0, range_days),
        180 => config(15.0, 85.0, 0.2, 0.2, 18.0, range_days),
        365 => config(15.0, 85.0, 0.2, 0.22, 16.0, range_days),
        _ => config(15.0, 85.0, 0.2, 0.15, 25.0, range_days),
    }
}

#[derive(Clone, Copy)]
enum BucketTimeZone {
    Fixed(i64),
    Display,
}

impl BucketTimeZone {
    fn for_display(offset_minutes: i64) -> Self {
        if offset_minutes == i64::from(crate::time::display_now().offset().local_minus_utc()) / 60 {
            Self::Display
        } else {
            Self::Fixed(offset_minutes)
        }
    }
}

pub fn compute_activity_view(
    sessions: &[ActivitySession],
    range_days: i64,
    now_ms: i64,
    offset_minutes: i64,
    config: &NormalizeConfig,
    max_session_ms: i64,
) -> ActivityView {
    compute_activity_view_with_zone(
        sessions,
        range_days,
        now_ms,
        BucketTimeZone::Fixed(offset_minutes),
        config,
        max_session_ms,
    )
}

pub fn compute_activity_view_in_display_zone(
    sessions: &[ActivitySession],
    range_days: i64,
    now_ms: i64,
    offset_minutes: i64,
    config: &NormalizeConfig,
    max_session_ms: i64,
) -> ActivityView {
    compute_activity_view_with_zone(
        sessions,
        range_days,
        now_ms,
        BucketTimeZone::for_display(offset_minutes),
        config,
        max_session_ms,
    )
}

fn compute_activity_view_with_zone(
    sessions: &[ActivitySession],
    range_days: i64,
    now_ms: i64,
    zone: BucketTimeZone,
    config: &NormalizeConfig,
    max_session_ms: i64,
) -> ActivityView {
    let window_start_ms = now_ms - range_days * MS_PER_DAY;
    let clipped_sessions = clip_sessions_to_range(sessions, window_start_ms, now_ms);
    let raw_buckets = build_heatmap_buckets(
        &clipped_sessions,
        window_start_ms,
        now_ms,
        zone,
        max_session_ms,
    );
    let normalized_buckets = normalize_buckets(&raw_buckets, with_range_days(config, range_days));
    let peak = activity_peak_indices_from_buckets(&raw_buckets);

    ActivityView {
        raw_buckets,
        normalized_buckets,
        peak_day_index: peak.peak_day_index,
        peak_hour_start: peak.peak_hour_start,
        peak_hour_end: peak.peak_hour_end,
        filtered_event_count: clipped_sessions.len(),
    }
}

pub fn compute_overlap_view(
    self_sessions: &[ActivitySession],
    target_sessions: &[ActivitySession],
    options: OverlapViewOptions,
) -> OverlapView {
    compute_overlap_view_with_zone(
        self_sessions,
        target_sessions,
        options,
        BucketTimeZone::Fixed(options.offset_minutes),
    )
}

pub fn compute_overlap_view_in_display_zone(
    self_sessions: &[ActivitySession],
    target_sessions: &[ActivitySession],
    options: OverlapViewOptions,
) -> OverlapView {
    compute_overlap_view_with_zone(
        self_sessions,
        target_sessions,
        options,
        BucketTimeZone::for_display(options.offset_minutes),
    )
}

fn compute_overlap_view_with_zone(
    self_sessions: &[ActivitySession],
    target_sessions: &[ActivitySession],
    options: OverlapViewOptions,
    zone: BucketTimeZone,
) -> OverlapView {
    let OverlapViewOptions {
        range_days,
        now_ms,
        offset_minutes: _,
        exclude_hours,
        config,
        max_session_ms,
    } = options;
    let window_start_ms = now_ms - range_days * MS_PER_DAY;
    let mut clipped_self = clip_sessions_to_range(self_sessions, window_start_ms, now_ms);
    let mut clipped_target = clip_sessions_to_range(target_sessions, window_start_ms, now_ms);
    clipped_self.sort_by_key(|session| session.start);
    clipped_target.sort_by_key(|session| session.start);

    let mut self_buckets =
        build_heatmap_buckets(&clipped_self, window_start_ms, now_ms, zone, max_session_ms);
    let mut target_buckets = build_heatmap_buckets(
        &clipped_target,
        window_start_ms,
        now_ms,
        zone,
        max_session_ms,
    );
    let mut raw_buckets = build_overlap_buckets(
        &clipped_self,
        &clipped_target,
        window_start_ms,
        now_ms,
        zone,
        max_session_ms,
    );

    if let Some(exclude_hours) = exclude_hours {
        apply_exclude_hours(
            &mut raw_buckets,
            &mut self_buckets,
            &mut target_buckets,
            exclude_hours,
        );
    }

    let overlap_minutes = sum(&raw_buckets);
    let self_minutes = sum(&self_buckets);
    let target_minutes = sum(&target_buckets);
    let denominator = self_minutes.min(target_minutes);
    let overlap_percent = if denominator > 0.0 {
        ((overlap_minutes / denominator) * 100.0).round() as i32
    } else {
        0
    };
    let normalized_buckets = normalize_buckets(&raw_buckets, with_range_days(&config, range_days));
    let best = if overlap_minutes > 0.0 {
        overlap_best_indices_from_buckets(&raw_buckets)
    } else {
        OverlapBestIndices::none()
    };

    OverlapView {
        raw_buckets,
        normalized_buckets,
        overlap_percent,
        best_day_index: best.best_day_index,
        best_hour_start: best.best_hour_start,
        best_hour_end: best.best_hour_end,
    }
}

pub fn normalize_buckets(buckets: &[f64], config: NormalizeConfig) -> Vec<f64> {
    let mut positive_entries: Vec<BucketEntry> = (0..BUCKET_COUNT)
        .filter_map(|index| {
            let value = buckets.get(index).copied().unwrap_or_default();
            (value > 0.0).then_some(BucketEntry { value, index })
        })
        .collect();

    if positive_entries.is_empty() {
        return vec![0.0; BUCKET_COUNT];
    }

    let mut sorted_values: Vec<f64> = positive_entries.iter().map(|entry| entry.value).collect();
    sorted_values.sort_by(|left, right| left.total_cmp(right));
    let floor = percentile(&sorted_values, config.floor_percentile);
    let cap = percentile(&sorted_values, config.cap_percentile);
    let log_floor = floor.ln_1p();
    let log_cap = cap.ln_1p();
    let log_range = log_cap - log_floor;

    positive_entries.retain(|entry| entry.value >= floor);
    if positive_entries.is_empty() {
        return vec![0.0; BUCKET_COUNT];
    }

    positive_entries.sort_by(|left, right| left.value.total_cmp(&right.value));
    let count = positive_entries.len();
    let amp_weight = 1.0 - config.rank_weight;
    let tied_ranks = tied_rank_scores(&positive_entries);
    let mut normalized = vec![0.0; BUCKET_COUNT];

    for (rank, entry) in positive_entries.iter().enumerate() {
        let base = if log_range > 1e-9 {
            ((entry.value.ln_1p() - log_floor) / log_range).max(0.0)
        } else {
            0.5
        };
        let clamped_base = base.min(1.0);
        normalized[entry.index] = clamped_base * amp_weight + tied_ranks[rank] * config.rank_weight;
    }

    let coverage = count as f64 / BUCKET_COUNT as f64;
    let gated_minutes = positive_entries
        .iter()
        .map(|entry| entry.value)
        .sum::<f64>();
    let range_days = if config.range_days > 0.0 {
        config.range_days
    } else {
        30.0
    };
    let volume = gated_minutes / range_days;
    let confidence = (coverage / config.target_coverage)
        .min(volume / config.target_volume)
        .clamp(0.0, 1.0);

    for value in &mut normalized {
        *value = (*value * confidence).min(1.0);
    }

    normalized
}

fn config(
    floor_percentile: f64,
    cap_percentile: f64,
    rank_weight: f64,
    target_coverage: f64,
    target_volume: f64,
    range_days: i64,
) -> NormalizeConfig {
    NormalizeConfig {
        floor_percentile,
        cap_percentile,
        rank_weight,
        target_coverage,
        target_volume,
        range_days: range_days as f64,
    }
}

fn with_range_days(config: &NormalizeConfig, range_days: i64) -> NormalizeConfig {
    NormalizeConfig {
        range_days: range_days as f64,
        ..*config
    }
}

fn clip_sessions_to_range(
    sessions: &[ActivitySession],
    range_start_ms: i64,
    range_end_ms: i64,
) -> Vec<ActivitySession> {
    sessions
        .iter()
        .filter(|session| session.end > range_start_ms && session.start < range_end_ms)
        .map(|session| ActivitySession {
            start: session.start.max(range_start_ms),
            end: session.end.min(range_end_ms),
            is_open_tail: session.is_open_tail,
            source_revision: session.source_revision.clone(),
        })
        .filter(|session| session.end > session.start)
        .collect()
}

fn build_heatmap_buckets(
    sessions: &[ActivitySession],
    window_start_ms: i64,
    now_ms: i64,
    zone: BucketTimeZone,
    max_session_ms: i64,
) -> Vec<f64> {
    let mut buckets = vec![0.0; BUCKET_COUNT];

    for session in sessions {
        let effective_end = session
            .end
            .min(session.start.saturating_add(max_session_ms));
        let start = session.start.max(window_start_ms);
        let end = effective_end.min(now_ms);
        if end <= start {
            continue;
        }

        let mut cursor = start;
        while cursor < end {
            let offset_minutes = match zone {
                BucketTimeZone::Fixed(offset) => offset,
                BucketTimeZone::Display => {
                    i64::from(
                        crate::time::display_offset_at(cursor.div_euclid(1000)).local_minus_utc(),
                    ) / 60
                }
            };
            let Some(slot) = local_hour_slot(cursor, offset_minutes) else {
                break;
            };
            let mut segment_end = next_local_hour_boundary_ms(cursor, offset_minutes).min(end);
            if matches!(zone, BucketTimeZone::Display) {
                segment_end =
                    segment_end.min((cursor.div_euclid(MS_PER_MINUTE) + 1) * MS_PER_MINUTE);
            }
            buckets[slot] += (segment_end - cursor) as f64 / MS_PER_MINUTE as f64;
            cursor = segment_end;
        }
    }

    buckets
}

fn build_overlap_buckets(
    self_sessions: &[ActivitySession],
    target_sessions: &[ActivitySession],
    window_start_ms: i64,
    now_ms: i64,
    zone: BucketTimeZone,
    max_session_ms: i64,
) -> Vec<f64> {
    let mut intersections = Vec::new();
    let mut left_index = 0usize;
    let mut right_index = 0usize;

    while left_index < self_sessions.len() && right_index < target_sessions.len() {
        let left = &self_sessions[left_index];
        let right = &target_sessions[right_index];
        let left_end = left.end.min(left.start.saturating_add(max_session_ms));
        let right_end = right.end.min(right.start.saturating_add(max_session_ms));
        let start = left.start.max(right.start);
        let end = left_end.min(right_end);

        if start < end {
            intersections.push(ActivitySession {
                start,
                end,
                is_open_tail: false,
                source_revision: String::new(),
            });
        }

        if left_end < right_end {
            left_index += 1;
        } else {
            right_index += 1;
        }
    }

    build_heatmap_buckets(
        &intersections,
        window_start_ms,
        now_ms,
        zone,
        max_session_ms,
    )
}

fn apply_exclude_hours(
    raw_buckets: &mut [f64],
    self_buckets: &mut [f64],
    target_buckets: &mut [f64],
    exclude_hours: ExcludeHours,
) {
    let start_hour = exclude_hours.start_hour.clamp(0, HOURS_PER_DAY as i32);
    let end_hour = exclude_hours.end_hour.clamp(0, HOURS_PER_DAY as i32);

    for day in 0..DAYS_PER_WEEK {
        if start_hour <= end_hour {
            zero_hour_range(
                day,
                start_hour,
                end_hour,
                raw_buckets,
                self_buckets,
                target_buckets,
            );
        } else {
            zero_hour_range(
                day,
                start_hour,
                HOURS_PER_DAY as i32,
                raw_buckets,
                self_buckets,
                target_buckets,
            );
            zero_hour_range(day, 0, end_hour, raw_buckets, self_buckets, target_buckets);
        }
    }
}

fn zero_hour_range(
    day: usize,
    start_hour: i32,
    end_hour: i32,
    raw_buckets: &mut [f64],
    self_buckets: &mut [f64],
    target_buckets: &mut [f64],
) {
    for hour in start_hour..end_hour {
        let slot = day * HOURS_PER_DAY + hour as usize;
        raw_buckets[slot] = 0.0;
        self_buckets[slot] = 0.0;
        target_buckets[slot] = 0.0;
    }
}

impl ActivityPeakIndices {
    fn hours_unknown(peak_day_index: i32) -> Self {
        Self {
            peak_day_index,
            peak_hour_start: -1,
            peak_hour_end: -1,
        }
    }
}

impl OverlapBestIndices {
    fn none() -> Self {
        Self {
            best_day_index: -1,
            best_hour_start: -1,
            best_hour_end: -1,
        }
    }
}

pub fn activity_peak_indices_from_buckets(buckets: &[f64]) -> ActivityPeakIndices {
    let mut day_sums = [0.0; DAYS_PER_WEEK];
    let mut hour_sums = [0.0; HOURS_PER_DAY];
    for (day, day_sum) in day_sums.iter_mut().enumerate() {
        for (hour, hour_sum) in hour_sums.iter_mut().enumerate() {
            let value = buckets
                .get(day * HOURS_PER_DAY + hour)
                .copied()
                .unwrap_or_default();
            *day_sum += value;
            *hour_sum += value;
        }
    }

    let max_day_sum = day_sums.iter().copied().fold(0.0, f64::max);
    let peak_day_index = if max_day_sum > 0.0 {
        day_sums
            .iter()
            .position(|value| *value == max_day_sum)
            .map(|index| index as i32)
            .unwrap_or(-1)
    } else {
        -1
    };

    let max_hour_sum = hour_sums.iter().copied().fold(0.0, f64::max);
    if max_hour_sum <= 0.0 {
        return ActivityPeakIndices::hours_unknown(peak_day_index);
    }

    let threshold = max_hour_sum * 0.7;
    let mut start_hour = hour_sums
        .iter()
        .position(|value| *value == max_hour_sum)
        .unwrap_or(0);
    let mut end_hour = start_hour;
    while start_hour > 0 && hour_sums[start_hour - 1] >= threshold {
        start_hour -= 1;
    }
    while end_hour < HOURS_PER_DAY - 1 && hour_sums[end_hour + 1] >= threshold {
        end_hour += 1;
    }

    ActivityPeakIndices {
        peak_day_index,
        peak_hour_start: start_hour as i32,
        peak_hour_end: end_hour as i32 + 1,
    }
}

pub fn overlap_best_indices_from_buckets(buckets: &[f64]) -> OverlapBestIndices {
    let mut hour_sums = [0.0; HOURS_PER_DAY];
    for (hour, hour_sum) in hour_sums.iter_mut().enumerate() {
        for day in 0..DAYS_PER_WEEK {
            *hour_sum += buckets
                .get(day * HOURS_PER_DAY + hour)
                .copied()
                .unwrap_or_default();
        }
    }

    let max_hour_sum = hour_sums.iter().copied().fold(0.0, f64::max);
    if max_hour_sum <= 0.0 {
        return OverlapBestIndices::none();
    }

    let threshold = max_hour_sum * 0.6;
    let mut start_hour = hour_sums
        .iter()
        .position(|value| *value == max_hour_sum)
        .unwrap_or(0);
    let mut end_hour = start_hour;
    while start_hour > 0 && hour_sums[start_hour - 1] >= threshold {
        start_hour -= 1;
    }
    while end_hour < HOURS_PER_DAY - 1 && hour_sums[end_hour + 1] >= threshold {
        end_hour += 1;
    }

    let mut day_sums = [0.0; DAYS_PER_WEEK];
    for (day, day_sum) in day_sums.iter_mut().enumerate() {
        for hour in start_hour..=end_hour {
            *day_sum += buckets
                .get(day * HOURS_PER_DAY + hour)
                .copied()
                .unwrap_or_default();
        }
    }

    let max_day_sum = day_sums.iter().copied().fold(0.0, f64::max);
    if max_day_sum <= 0.0 {
        return OverlapBestIndices::none();
    }
    let day_index = day_sums
        .iter()
        .position(|value| *value == max_day_sum)
        .map(|index| index as i32)
        .unwrap_or(-1);

    OverlapBestIndices {
        best_day_index: day_index,
        best_hour_start: start_hour as i32,
        best_hour_end: end_hour as i32 + 1,
    }
}

fn percentile(sorted_values: &[f64], percentile_value: f64) -> f64 {
    if sorted_values.is_empty() {
        return 1.0;
    }
    let index = (percentile_value / 100.0) * (sorted_values.len() - 1) as f64;
    let lower = index.floor() as usize;
    let upper = index.ceil() as usize;
    if lower == upper {
        return sorted_values[lower];
    }
    sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * (index - lower as f64)
}

fn tied_rank_scores(sorted_entries: &[BucketEntry]) -> Vec<f64> {
    let count = sorted_entries.len();
    let mut scores = vec![0.0; count];
    let mut i = 0usize;
    while i < count {
        let mut j = i;
        while j < count && sorted_entries[j].value == sorted_entries[i].value {
            j += 1;
        }
        let avg_rank = (i + 1 + j) as f64 / 2.0;
        let score = avg_rank / count as f64;
        for value in scores.iter_mut().take(j).skip(i) {
            *value = score;
        }
        i = j;
    }
    scores
}

fn local_hour_slot(ms: i64, offset_minutes: i64) -> Option<usize> {
    let local_ms = ms.checked_add(offset_minutes.checked_mul(MS_PER_MINUTE)?)?;
    let local = chrono::DateTime::<Utc>::from_timestamp_millis(local_ms)?;
    let day = local.weekday().num_days_from_sunday() as usize;
    let hour = local.hour() as usize;
    Some(day * HOURS_PER_DAY + hour)
}

fn next_local_hour_boundary_ms(ms: i64, offset_minutes: i64) -> i64 {
    let local_ms = ms.saturating_add(offset_minutes.saturating_mul(MS_PER_MINUTE));
    let remainder = local_ms.rem_euclid(MS_PER_HOUR);
    let delta = if remainder == 0 {
        MS_PER_HOUR
    } else {
        MS_PER_HOUR - remainder
    };
    ms.saturating_add(delta)
}

fn sum(values: &[f64]) -> f64 {
    values.iter().sum()
}

#[derive(Clone, Copy)]
struct BucketEntry {
    value: f64,
    index: usize,
}
