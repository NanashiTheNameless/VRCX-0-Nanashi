//! The time zone dates are shown in. Stored dates never carry one; this only
//! decides how an epoch second reads on screen, in notifications and in
//! anything else a person looks at. It is a per-device setting.

use std::sync::RwLock;

use chrono::{DateTime, FixedOffset, NaiveDateTime, Utc};
use jiff::tz::{Offset, TimeZone};

use super::EpochSeconds;

/// The largest offset accepted as an arbitrary UTC offset, in hours.
const MAX_OFFSET_HOURS: i32 = 23;

static DISPLAY_ZONE: RwLock<Option<TimeZone>> = RwLock::new(None);

/// A parsed time zone setting.
#[derive(Clone, Debug, PartialEq)]
pub enum DisplayZoneSetting {
    /// Follow the operating system.
    System,
    /// An IANA tz database name such as `Europe/Berlin`.
    Named(String),
    /// A fixed offset from UTC, in seconds east of UTC.
    Offset(i32),
}

/// Read a setting value: empty or `system` follows the operating system, a
/// tz database name is used as is, and `UTC+5`, `UTC-03:30`, `GMT+1`, `+0530`
/// or `-8` are fixed offsets. Returns `None` for anything else.
pub fn parse_display_zone_setting(value: &str) -> Option<DisplayZoneSetting> {
    let value = value.trim();
    if value.is_empty() || value.eq_ignore_ascii_case("system") {
        return Some(DisplayZoneSetting::System);
    }
    if let Some(seconds) = parse_fixed_offset(value) {
        return Some(DisplayZoneSetting::Offset(seconds));
    }
    TimeZone::get(value)
        .ok()
        .map(|_| DisplayZoneSetting::Named(value.to_string()))
}

fn parse_fixed_offset(value: &str) -> Option<i32> {
    let upper = value.to_ascii_uppercase();
    let rest = upper
        .strip_prefix("UTC")
        .or_else(|| upper.strip_prefix("GMT"))
        .unwrap_or(&upper)
        .trim();
    if rest.is_empty() {
        return (upper == "UTC" || upper == "GMT").then_some(0);
    }
    let (sign, digits) = match rest.as_bytes()[0] {
        b'+' => (1, &rest[1..]),
        b'-' => (-1, &rest[1..]),
        _ => return None,
    };
    let (hours, minutes) = match digits.split_once(':') {
        Some((hours, minutes)) => (hours, minutes),
        None if digits.len() > 2 => digits.split_at(digits.len() - 2),
        None => (digits, "0"),
    };
    if hours.is_empty()
        || hours.len() > 2
        || minutes.len() > 2
        || !hours
            .bytes()
            .chain(minutes.bytes())
            .all(|b| b.is_ascii_digit())
    {
        return None;
    }
    let hours: i32 = hours.parse().ok()?;
    let minutes: i32 = minutes.parse().ok()?;
    if minutes >= 60 || hours > MAX_OFFSET_HOURS {
        return None;
    }
    Some(sign * (hours * 3600 + minutes * 60))
}

fn zone_for(setting: &DisplayZoneSetting) -> Option<TimeZone> {
    match setting {
        DisplayZoneSetting::System => None,
        DisplayZoneSetting::Named(name) => TimeZone::get(name).ok(),
        DisplayZoneSetting::Offset(seconds) => {
            Offset::from_seconds(*seconds).ok().map(TimeZone::fixed)
        }
    }
}

/// Apply a setting value. An unreadable value falls back to the operating
/// system and returns `false`.
pub fn set_display_zone(value: &str) -> bool {
    let setting = parse_display_zone_setting(value);
    let zone = setting.as_ref().and_then(zone_for);
    if let Ok(mut current) = DISPLAY_ZONE.write() {
        *current = zone;
    }
    setting.is_some()
}

fn with_zone<T>(f: impl FnOnce(&TimeZone) -> T) -> T {
    let configured = DISPLAY_ZONE.read().ok().and_then(|zone| zone.clone());
    match configured {
        Some(zone) => f(&zone),
        None => f(&TimeZone::system()),
    }
}

pub fn display_zone_label() -> String {
    with_zone(|zone| zone.iana_name().map(str::to_string))
        .unwrap_or_else(|| format!("UTC{}", display_now().format("%:z")))
}

pub fn display_zone_cache_key() -> String {
    with_zone(|zone| format!("{zone:?}"))
}

/// The display offset in effect at `seconds`.
pub fn display_offset_at(seconds: EpochSeconds) -> FixedOffset {
    let offset = jiff::Timestamp::from_second(seconds)
        .map(|timestamp| with_zone(|zone| zone.to_offset(timestamp).seconds()))
        .unwrap_or(0);
    FixedOffset::east_opt(offset).unwrap_or_else(|| FixedOffset::east_opt(0).unwrap())
}

/// `seconds` as a date and time in the display zone.
pub fn to_display(seconds: EpochSeconds) -> Option<DateTime<FixedOffset>> {
    DateTime::<Utc>::from_timestamp(seconds, 0)
        .map(|value| value.with_timezone(&display_offset_at(seconds)))
}

/// The current date and time in the display zone.
pub fn display_now() -> DateTime<FixedOffset> {
    let now = Utc::now();
    now.with_timezone(&display_offset_at(now.timestamp()))
}

/// The epoch second a wall-clock time in the display zone names. A time
/// skipped by a clock change resolves to the instant after the gap, and a
/// repeated one to its first occurrence.
pub fn display_local_to_epoch(local: NaiveDateTime) -> Option<EpochSeconds> {
    use chrono::{Datelike, Timelike};
    let civil = jiff::civil::DateTime::new(
        i16::try_from(local.year()).ok()?,
        i8::try_from(local.month()).ok()?,
        i8::try_from(local.day()).ok()?,
        i8::try_from(local.hour()).ok()?,
        i8::try_from(local.minute()).ok()?,
        i8::try_from(local.second()).ok()?,
        0,
    )
    .ok()?;
    with_zone(|zone| zone.to_ambiguous_timestamp(civil).compatible().ok())
        .map(|timestamp| timestamp.as_second())
}

#[derive(Clone, Copy, Debug)]
pub struct DisplayTimeZone;

impl chrono::TimeZone for DisplayTimeZone {
    type Offset = FixedOffset;

    fn from_offset(_: &Self::Offset) -> Self {
        Self
    }

    fn offset_from_local_date(
        &self,
        local: &chrono::NaiveDate,
    ) -> chrono::LocalResult<Self::Offset> {
        self.offset_from_local_datetime(&local.and_time(chrono::NaiveTime::MIN))
    }

    fn offset_from_local_datetime(
        &self,
        local: &NaiveDateTime,
    ) -> chrono::LocalResult<Self::Offset> {
        display_local_to_epoch(*local)
            .and_then(|instant| i32::try_from(local.and_utc().timestamp() - instant).ok())
            .and_then(FixedOffset::east_opt)
            .map_or(chrono::LocalResult::None, chrono::LocalResult::Single)
    }

    fn offset_from_utc_date(&self, utc: &chrono::NaiveDate) -> Self::Offset {
        self.offset_from_utc_datetime(&utc.and_time(chrono::NaiveTime::MIN))
    }

    fn offset_from_utc_datetime(&self, utc: &NaiveDateTime) -> Self::Offset {
        display_offset_at(utc.and_utc().timestamp())
    }
}

#[cfg(test)]
mod tests;
