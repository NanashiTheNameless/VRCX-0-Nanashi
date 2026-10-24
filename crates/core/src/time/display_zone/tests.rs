use super::*;

#[test]
fn reads_system_names_and_offsets() {
    assert_eq!(
        parse_display_zone_setting(""),
        Some(DisplayZoneSetting::System)
    );
    assert_eq!(
        parse_display_zone_setting("system"),
        Some(DisplayZoneSetting::System)
    );
    assert_eq!(
        parse_display_zone_setting("Europe/Berlin"),
        Some(DisplayZoneSetting::Named("Europe/Berlin".into()))
    );
    for (text, seconds) in [
        ("UTC", 0),
        ("UTC+5", 5 * 3600),
        ("utc-03:30", -(3 * 3600 + 30 * 60)),
        ("GMT+1", 3600),
        ("+0530", 5 * 3600 + 30 * 60),
        ("-8", -8 * 3600),
        ("+14:00", 14 * 3600),
        ("UTC-18", -18 * 3600),
        ("UTC+23:59", 23 * 3600 + 59 * 60),
    ] {
        assert_eq!(
            parse_display_zone_setting(text),
            Some(DisplayZoneSetting::Offset(seconds)),
            "{text}"
        );
    }
}

#[test]
fn rejects_unknown_zones_and_impossible_offsets() {
    for text in [
        "Mars/Olympus",
        "UTC+24",
        "+05:60",
        "UTC+",
        "5",
        "+123:00",
        "UTC+23:60",
    ] {
        assert_eq!(parse_display_zone_setting(text), None, "{text}");
    }
}

#[test]
fn display_conversions_follow_the_configured_zone() {
    // One test owns the process-wide setting so parallel tests cannot race.
    assert!(set_display_zone("America/New_York"));
    // 2026-07-01T12:00:00Z is 08:00 EDT; 2026-01-15T12:00:00Z is 07:00 EST.
    assert_eq!(
        display_offset_at(1_782_907_200).local_minus_utc(),
        -4 * 3600
    );
    assert_eq!(
        display_offset_at(1_768_478_400).local_minus_utc(),
        -5 * 3600
    );
    assert_eq!(
        to_display(1_782_907_200)
            .unwrap()
            .format("%H:%M")
            .to_string(),
        "08:00"
    );
    let local = chrono::NaiveDate::from_ymd_opt(2026, 7, 1)
        .unwrap()
        .and_hms_opt(8, 0, 0)
        .unwrap();
    assert_eq!(display_local_to_epoch(local), Some(1_782_907_200));
    // 02:30 on 2026-03-08 does not exist in New York; it resolves past the gap.
    let skipped = chrono::NaiveDate::from_ymd_opt(2026, 3, 8)
        .unwrap()
        .and_hms_opt(2, 30, 0)
        .unwrap();
    assert_eq!(
        display_local_to_epoch(skipped).map(|at| display_offset_at(at).local_minus_utc()),
        Some(-4 * 3600)
    );

    let epoch = |text| crate::time::parse_epoch_seconds(text).unwrap() * 1000;
    let sessions = [
        ("2026-01-15T12:00:00Z", "2026-01-15T13:00:00Z"),
        ("2026-07-01T12:00:00Z", "2026-07-01T13:00:00Z"),
        ("2026-03-08T06:30:00Z", "2026-03-08T07:30:00Z"),
        ("2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z"),
    ]
    .map(|(start, end)| crate::activity_sessions::ActivitySession {
        start: epoch(start),
        end: epoch(end),
        is_open_tail: false,
        source_revision: String::new(),
    });
    let view = crate::activity_heatmap::compute_activity_view_in_display_zone(
        &sessions,
        365,
        epoch("2026-11-02T00:00:00Z"),
        i64::from(display_now().offset().local_minus_utc()) / 60,
        &crate::activity_heatmap::activity_normalize_config(true, 365),
        8 * 3600 * 1000,
    );
    assert_eq!(view.raw_buckets[4 * 24 + 7], 60.0);
    assert_eq!(view.raw_buckets[3 * 24 + 8], 60.0);
    assert_eq!(view.raw_buckets[1], 90.0);
    assert_eq!(view.raw_buckets[2], 0.0);
    assert_eq!(view.raw_buckets[3], 30.0);

    assert!(set_display_zone("UTC+05:30"));
    assert_eq!(
        display_offset_at(1_782_907_200).local_minus_utc(),
        5 * 3600 + 1800
    );

    assert!(!set_display_zone("Nowhere/Invalid"));
    assert!(set_display_zone(""));
}
