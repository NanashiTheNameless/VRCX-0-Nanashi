use chrono::{DateTime, NaiveDate, NaiveDateTime, SecondsFormat, TimeZone, Utc};

mod display_zone;

pub use display_zone::{
    display_local_to_epoch, display_now, display_offset_at, display_zone_cache_key,
    display_zone_label, parse_display_zone_setting, set_display_zone, to_display, DisplayTimeZone,
    DisplayZoneSetting,
};

/// Every stored absolute date is signed Unix epoch seconds (UTC). Timezones
/// only apply when a date is shown.
pub type EpochSeconds = i64;

/// Bare integers at or above this magnitude are milliseconds: as seconds they
/// would be past the year 5000, as milliseconds they are after 1973.
const MILLIS_THRESHOLD: i64 = 100_000_000_000;

pub fn iso_millis(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn now_iso() -> String {
    iso_millis(Utc::now())
}

pub fn now_epoch() -> EpochSeconds {
    Utc::now().timestamp()
}

pub fn epoch_from_millis(millis: i64) -> EpochSeconds {
    millis.div_euclid(1000)
}

/// RFC 3339 in UTC, for APIs and files outside the app that expect text.
pub fn epoch_to_iso(seconds: EpochSeconds) -> String {
    Utc.timestamp_opt(seconds, 0)
        .single()
        .map(|value| value.to_rfc3339_opts(SecondsFormat::Secs, true))
        .unwrap_or_default()
}

/// Read a timestamp in any form the app has stored or received: RFC 3339 with
/// any offset or fraction, SQLite's `YYYY-MM-DD HH:MM:SS[.fff]` and
/// `YYYY-MM-DDTHH:MM:SS[.fff]` without an offset (UTC), a bare date (UTC
/// midnight), or a bare integer in seconds or milliseconds.
pub fn parse_epoch_seconds(text: &str) -> Option<EpochSeconds> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    if let Ok(number) = text.parse::<i64>() {
        return Some(normalize_epoch_integer(number));
    }
    if let Ok(value) = DateTime::parse_from_rfc3339(text) {
        return Some(value.timestamp());
    }
    for format in [
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%dT%H:%M",
    ] {
        if let Ok(value) = NaiveDateTime::parse_from_str(text, format) {
            return Some(value.and_utc().timestamp());
        }
    }
    for format in ["%Y-%m-%d %H:%M:%S%.f%#z", "%Y-%m-%dT%H:%M:%S%.f%#z"] {
        if let Ok(value) = DateTime::parse_from_str(text, format) {
            return Some(value.timestamp());
        }
    }
    NaiveDate::parse_from_str(text, "%Y-%m-%d")
        .ok()
        .and_then(|date| date.and_hms_opt(0, 0, 0))
        .map(|value| value.and_utc().timestamp())
}

/// A stored integer that may be seconds or milliseconds.
pub fn normalize_epoch_integer(number: i64) -> EpochSeconds {
    if number.unsigned_abs() >= MILLIS_THRESHOLD as u64 {
        epoch_from_millis(number)
    } else {
        number
    }
}

/// A timestamp from JSON written by this or an older version: a number in
/// seconds or milliseconds, or text in any form `parse_epoch_seconds` reads.
pub fn epoch_from_json(value: &serde_json::Value) -> Option<EpochSeconds> {
    match value {
        serde_json::Value::Number(number) => number
            .as_i64()
            .or_else(|| {
                number
                    .as_f64()
                    .filter(|value| {
                        value.is_finite()
                            && *value >= i64::MIN as f64
                            && *value < -(i64::MIN as f64)
                    })
                    .map(|value| value.floor() as i64)
            })
            .map(normalize_epoch_integer),
        serde_json::Value::String(text) => parse_epoch_seconds(text),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    #[test]
    fn renders_utc_with_millisecond_precision() {
        let value = Utc
            .with_ymd_and_hms(2026, 7, 21, 10, 30, 15)
            .unwrap()
            .checked_add_signed(chrono::Duration::milliseconds(250))
            .unwrap();

        assert_eq!(iso_millis(value), "2026-07-21T10:30:15.250Z");
    }

    #[test]
    fn parses_every_stored_timestamp_form() {
        let expected = Utc
            .with_ymd_and_hms(2026, 7, 21, 10, 30, 15)
            .unwrap()
            .timestamp();
        for text in [
            "2026-07-21T10:30:15Z",
            "2026-07-21T10:30:15.250Z",
            "2026-07-21T05:30:15-05:00",
            "2026-07-21T10:30:15.250+00:00",
            "2026-07-21 10:30:15",
            "2026-07-21 10:30:15.250",
            "2026-07-21T10:30:15",
            " 2026-07-21T10:30:15.250Z ",
            "1784629815",
            "1784629815250",
        ] {
            assert_eq!(parse_epoch_seconds(text), Some(expected), "{text}");
        }
        assert_eq!(
            parse_epoch_seconds("2026-07-21"),
            Some(expected - (10 * 3600 + 30 * 60 + 15))
        );
    }

    #[test]
    fn rejects_text_that_is_not_a_timestamp() {
        for text in ["", "  ", "yesterday", "2026-13-01", "wrld_123"] {
            assert_eq!(parse_epoch_seconds(text), None, "{text}");
        }
    }

    #[test]
    fn dates_before_1970_stay_negative() {
        assert_eq!(parse_epoch_seconds("1969-12-31T23:59:59Z"), Some(-1));
        assert_eq!(epoch_to_iso(-1), "1969-12-31T23:59:59Z");
        assert_eq!(epoch_from_millis(-1), -1);
    }

    #[test]
    fn json_timestamps_accept_numbers_and_text() {
        assert_eq!(
            epoch_from_json(&serde_json::json!(1784629815)),
            Some(1784629815)
        );
        assert_eq!(
            epoch_from_json(&serde_json::json!(1784629815250_i64)),
            Some(1784629815)
        );
        assert_eq!(
            epoch_from_json(&serde_json::json!("2026-07-21T10:30:15.250Z")),
            Some(1784629815)
        );
        assert_eq!(epoch_from_json(&serde_json::json!(null)), None);
        assert_eq!(epoch_from_json(&serde_json::json!(true)), None);
    }

    #[test]
    fn iso_round_trips_through_seconds() {
        assert_eq!(epoch_to_iso(1784629815), "2026-07-21T10:30:15Z");
        assert_eq!(
            parse_epoch_seconds(&epoch_to_iso(1784629815)),
            Some(1784629815)
        );
    }
}
