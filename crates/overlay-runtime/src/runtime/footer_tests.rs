use super::{elapsed_minutes_text, instance_duration_text};

fn ms(seconds: i64) -> i64 {
    seconds * 1000
}

#[test]
fn elapsed_time_only_advances_on_wall_clock_minute_boundaries() {
    let started_at = 1792411240;

    assert_eq!(elapsed_minutes_text(started_at, ms(1792411559)), "4m");
    assert_eq!(elapsed_minutes_text(started_at, ms(1792411560)), "5m");
    assert_eq!(elapsed_minutes_text(started_at, ms(1792418760)), "2h 5m");
}

#[test]
fn elapsed_time_shows_under_a_minute_right_after_start() {
    assert_eq!(elapsed_minutes_text(1792411240, ms(1792411250)), "<1m");
}

#[test]
fn elapsed_time_is_empty_for_future_or_unparseable_starts() {
    let now = ms(1792411200);
    assert_eq!(elapsed_minutes_text(1792411260, now), "");
    assert_eq!(elapsed_minutes_text(0, now), "");
}

#[test]
fn instance_duration_needs_a_real_instance_location() {
    let now = ms(1792411800);
    assert_eq!(
        instance_duration_text("wrld_abc:12345", 1792411200, now),
        "10m"
    );
    assert_eq!(instance_duration_text("offline", 1792411200, now), "");
}
