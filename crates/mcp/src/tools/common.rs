use std::borrow::Cow;

use chrono::{DateTime, Datelike, Duration, TimeZone, Utc};
use rmcp::model::CallToolResult;
use rmcp::schemars;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use vrcx_0_contracts::social_aggregates;

use crate::runtime::McpRuntime;
use vrcx_0_core::OwnerId;

pub(super) fn deserialize_optional_bool<'de, D>(deserializer: D) -> Result<Option<bool>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    match Value::deserialize(deserializer)? {
        Value::Null => Ok(None),
        Value::Bool(value) => Ok(Some(value)),
        Value::String(value) => value
            .trim()
            .parse::<bool>()
            .map(Some)
            .map_err(serde::de::Error::custom),
        _ => Err(serde::de::Error::custom(
            "expected a boolean or a true/false string",
        )),
    }
}

#[derive(Clone, Debug, Default)]
pub(super) struct TimeWindowParams {
    pub(super) from: Option<String>,
    pub(super) to: Option<String>,
}

impl schemars::JsonSchema for TimeWindowParams {
    fn inline_schema() -> bool {
        true
    }

    fn schema_name() -> Cow<'static, str> {
        "TimeWindow".into()
    }

    fn json_schema(_generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
        schemars::json_schema!({
            "oneOf": [
                {
                    "type": "string",
                    "description": "Relative window such as 90d or this week, a four-digit calendar year such as 2026, or all history."
                },
                {
                    "type": "integer",
                    "minimum": 1000,
                    "maximum": 9998,
                    "description": "Four-digit UTC calendar year such as 2026."
                },
                {
                    "type": "object",
                    "properties": {
                        "from": { "type": ["string", "null"] },
                        "to": { "type": ["string", "null"] }
                    },
                    "additionalProperties": false
                }
            ]
        })
    }
}

impl<'de> Deserialize<'de> for TimeWindowParams {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        time_window_from_value(&value).map_err(serde::de::Error::custom)
    }
}

impl From<TimeWindowParams> for social_aggregates::TimeWindow {
    fn from(value: TimeWindowParams) -> Self {
        Self {
            from: value.from,
            to: value.to,
        }
    }
}

fn time_window_from_value(value: &Value) -> Result<TimeWindowParams, String> {
    match value {
        Value::String(text) => parse_relative_window(text),
        Value::Number(year) => year
            .as_i64()
            .ok_or_else(|| "timeWindow calendar year must be an integer".to_string())
            .and_then(calendar_year_window),
        Value::Object(map) => {
            if let Some(field) = map.keys().find(|field| *field != "from" && *field != "to") {
                return Err(format!("unknown timeWindow field '{field}'"));
            }
            Ok(TimeWindowParams {
                from: time_window_bound(map.get("from"), "from")?,
                to: time_window_bound(map.get("to"), "to")?,
            })
        }
        _ => Err(
            "timeWindow must be a relative string, calendar year integer, or an object with from/to bounds"
                .into(),
        ),
    }
}

fn time_window_bound(value: Option<&Value>, field: &str) -> Result<Option<String>, String> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => normalize_time_bound(value),
        Some(_) => Err(format!("timeWindow.{field} must be a string or null")),
    }
}

fn normalize_time_bound(raw: &str) -> Result<Option<String>, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if DateTime::parse_from_rfc3339(trimmed).is_ok() {
        return Ok(Some(trimmed.to_string()));
    }
    let lowered = trimmed.to_ascii_lowercase();
    if lowered == "now" || lowered == "today" {
        return Ok(Some(Utc::now().to_rfc3339()));
    }
    if let Ok(date) = chrono::NaiveDate::parse_from_str(trimmed, "%Y-%m-%d") {
        let naive = date.and_time(chrono::NaiveTime::MIN);
        return Ok(Some(Utc.from_utc_datetime(&naive).to_rfc3339()));
    }
    for fmt in ["%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"] {
        if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(trimmed, fmt) {
            return Ok(Some(Utc.from_utc_datetime(&naive).to_rfc3339()));
        }
    }
    if let Some(duration) = parse_duration(&lowered) {
        return Ok(Some((Utc::now() - duration).to_rfc3339()));
    }
    Err(format!("unrecognized timeWindow bound '{raw}'"))
}

fn parse_relative_window(text: &str) -> Result<TimeWindowParams, String> {
    let normalized = text.trim().to_ascii_lowercase();
    if normalized.len() == 4 && normalized.chars().all(|ch| ch.is_ascii_digit()) {
        return normalized
            .parse::<i64>()
            .map_err(|_| format!("unrecognized timeWindow string '{text}'"))
            .and_then(calendar_year_window);
    }
    let now = Utc::now();
    let rfc = |dt: DateTime<Utc>| Some(dt.to_rfc3339());
    let window = |from, to| TimeWindowParams { from, to };

    match normalized.as_str() {
        "" | "all" | "all time" | "alltime" | "all history" | "all-history" | "entire history"
        | "any" | "anytime" | "ever" | "always" | "so far" | "forever" | "lifetime" => {
            return Ok(TimeWindowParams::default());
        }
        "today" => return Ok(window(rfc(start_of_day(now)), None)),
        "yesterday" => {
            let start_today = start_of_day(now);
            return Ok(window(
                rfc(start_today - Duration::days(1)),
                rfc(start_today),
            ));
        }
        "this week" | "week" => return Ok(window(rfc(start_of_week(now)), None)),
        "last week" | "past week" | "previous week" => {
            let this = start_of_week(now);
            return Ok(window(rfc(this - Duration::days(7)), rfc(this)));
        }
        "this month" | "month" => return Ok(window(rfc(start_of_month(now)), None)),
        "last month" | "past month" | "previous month" => {
            return Ok(window(
                rfc(start_of_prev_month(now)),
                rfc(start_of_month(now)),
            ));
        }
        _ => {}
    }

    if let Some(window) = parse_rolling_window(&normalized, now) {
        return Ok(window);
    }

    Err(format!("unrecognized timeWindow string '{text}'"))
}

fn calendar_year_window(year: i64) -> Result<TimeWindowParams, String> {
    let year = i32::try_from(year)
        .ok()
        .filter(|year| (1000..=9998).contains(year))
        .ok_or_else(|| "timeWindow calendar year must be between 1000 and 9998".to_string())?;
    let from = Utc
        .with_ymd_and_hms(year, 1, 1, 0, 0, 0)
        .single()
        .ok_or_else(|| "timeWindow calendar year is out of range".to_string())?;
    let to = Utc
        .with_ymd_and_hms(year + 1, 1, 1, 0, 0, 0)
        .single()
        .ok_or_else(|| "timeWindow calendar year is out of range".to_string())?;
    Ok(TimeWindowParams {
        from: Some(from.to_rfc3339()),
        to: Some(to.to_rfc3339()),
    })
}

fn parse_rolling_window(text: &str, now: DateTime<Utc>) -> Option<TimeWindowParams> {
    let duration = parse_duration(text)?;
    Some(TimeWindowParams {
        from: Some((now - duration).to_rfc3339()),
        to: None,
    })
}

/// Parse a duration from word forms (`7 days`, `last 3 weeks`) or compact forms
/// (`7d`, `2w`, `3mo`, `24h`, `1y`). Bare `m` is read as months - the common
/// intent for social-history windows. `text` is expected to be lowercased.
fn parse_duration(text: &str) -> Option<Duration> {
    let number: i64 = text
        .split(|ch: char| !ch.is_ascii_digit())
        .find(|token| !token.is_empty())
        .and_then(|token| token.parse().ok())?;
    let compact = compact_unit(text);
    if text.contains("hour") || compact == Some('h') {
        Some(Duration::hours(number))
    } else if text.contains("week") || compact == Some('w') {
        Some(Duration::days(number * 7))
    } else if text.contains("mo") || compact == Some('m') {
        Some(Duration::days(number * 30))
    } else if text.contains("year") || compact == Some('y') {
        Some(Duration::days(number * 365))
    } else if text.contains("day") || compact == Some('d') {
        Some(Duration::days(number))
    } else {
        None
    }
}

/// First alphabetic character that immediately follows a digit, e.g. `d` in
/// `7d`. Used to read compact duration units.
fn compact_unit(text: &str) -> Option<char> {
    let mut seen_digit = false;
    for ch in text.chars() {
        if ch.is_ascii_digit() {
            seen_digit = true;
        } else if seen_digit && ch.is_ascii_alphabetic() {
            return Some(ch);
        }
    }
    None
}

fn start_of_day(now: DateTime<Utc>) -> DateTime<Utc> {
    now.date_naive()
        .and_hms_opt(0, 0, 0)
        .map(|naive| Utc.from_utc_datetime(&naive))
        .unwrap_or(now)
}

fn start_of_week(now: DateTime<Utc>) -> DateTime<Utc> {
    let days = now.weekday().num_days_from_monday() as i64;
    start_of_day(now) - Duration::days(days)
}

fn start_of_month(now: DateTime<Utc>) -> DateTime<Utc> {
    now.date_naive()
        .with_day(1)
        .and_then(|date| date.and_hms_opt(0, 0, 0))
        .map(|naive| Utc.from_utc_datetime(&naive))
        .unwrap_or(now)
}

fn start_of_prev_month(now: DateTime<Utc>) -> DateTime<Utc> {
    let last_day_prev = start_of_month(now) - Duration::days(1);
    start_of_month(last_day_prev)
}
pub(super) struct TimeWindowBoundsMs {
    pub(super) from: Option<i64>,
    pub(super) to: Option<i64>,
}
pub(super) fn time_window_bounds_ms(
    time_window: &social_aggregates::TimeWindow,
) -> Result<TimeWindowBoundsMs, String> {
    Ok(TimeWindowBoundsMs {
        from: time_window
            .from
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(parse_rfc3339_ms)
            .transpose()?,
        to: time_window
            .to
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(parse_rfc3339_ms)
            .transpose()?,
    })
}

fn parse_rfc3339_ms(value: &str) -> Result<i64, String> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.timestamp_millis())
        .map_err(|error| format!("invalid RFC3339 time '{value}': {error}"))
}

pub(super) fn rfc3339_z(value: DateTime<Utc>) -> String {
    value.format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

pub(super) fn ms_to_rfc3339_z(millis: i64) -> String {
    DateTime::<Utc>::from_timestamp_millis(millis)
        .map(rfc3339_z)
        .unwrap_or_default()
}

pub(super) enum TargetResolution {
    Resolved {
        user_id: String,
        echo: Option<ResolvedUserEcho>,
    },
    Ambiguous(Vec<social_aggregates::ResolvedUserRow>),
    NotFound,
}

pub(super) struct ResolvedTarget {
    pub(super) user_id: String,
    pub(super) echo: Option<ResolvedUserEcho>,
}

pub(super) enum TargetResolutionOutcome {
    Resolved(ResolvedTarget),
    ToolResult(CallToolResult),
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct ResolvedUserEcho {
    user_id: String,
    display_name: String,
    is_friend: bool,
}

impl ResolvedUserEcho {
    fn from_row(row: &social_aggregates::ResolvedUserRow) -> Self {
        Self {
            user_id: row.user_id.clone(),
            display_name: row.display_name.clone(),
            is_friend: row.is_friend,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WithResolution<T: Serialize> {
    #[serde(flatten)]
    pub(super) inner: T,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) resolved_user: Option<ResolvedUserEcho>,
}

pub(super) fn resolve_target(
    runtime: &McpRuntime,
    value: &str,
) -> Result<TargetResolution, String> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(TargetResolution::NotFound);
    }
    if value.starts_with("usr_") {
        return Ok(TargetResolution::Resolved {
            user_id: value.to_string(),
            echo: None,
        });
    }
    let owner_user_id = require_current_user_id(runtime)?;
    let rows = runtime
        .social_history_queries
        .resolve_user(social_aggregates::ResolveUserInput {
            owner_user_id: owner_user_id.clone(),
            name_query: value.to_string(),
            limit: Some(5),
        })
        .map_err(map_application_query_error)?
        .rows;
    Ok(resolve_target_from_candidates(value, rows))
}

pub(super) fn resolve_target_or_result(
    runtime: &McpRuntime,
    value: &str,
) -> Result<TargetResolutionOutcome, String> {
    match resolve_target(runtime, value)? {
        TargetResolution::Resolved { user_id, echo } => {
            Ok(TargetResolutionOutcome::Resolved(ResolvedTarget {
                user_id,
                echo,
            }))
        }
        TargetResolution::Ambiguous(candidates) => Ok(TargetResolutionOutcome::ToolResult(
            disambiguation_result(value, candidates)?,
        )),
        TargetResolution::NotFound => Ok(TargetResolutionOutcome::ToolResult(not_found_result(
            value,
        )?)),
    }
}

pub(super) fn resolve_optional_target_or_result(
    runtime: &McpRuntime,
    value: Option<&str>,
) -> Result<Option<TargetResolutionOutcome>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    resolve_target_or_result(runtime, value).map(Some)
}

fn resolve_target_from_candidates(
    query: &str,
    rows: Vec<social_aggregates::ResolvedUserRow>,
) -> TargetResolution {
    let Some(top) = rows.first() else {
        return TargetResolution::NotFound;
    };
    if rows.len() == 1 || confident_target(query, &rows) {
        return TargetResolution::Resolved {
            user_id: top.user_id.clone(),
            echo: Some(ResolvedUserEcho::from_row(top)),
        };
    }
    TargetResolution::Ambiguous(rows)
}

fn confident_target(query: &str, rows: &[social_aggregates::ResolvedUserRow]) -> bool {
    let Some(top) = rows.first() else {
        return false;
    };
    let Some(second) = rows.get(1) else {
        return true;
    };
    if is_exact_name_match(top, query) && !is_exact_name_match(second, query) {
        return true;
    }
    if top.is_friend && !second.is_friend {
        return true;
    }
    top.encounter_count >= second.encounter_count.max(1).saturating_mul(3)
}

fn is_exact_name_match(row: &social_aggregates::ResolvedUserRow, query: &str) -> bool {
    row.display_name.eq_ignore_ascii_case(query) || row.matched_name.eq_ignore_ascii_case(query)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DisambiguationOutput {
    needs_disambiguation: bool,
    query: String,
    candidates: Vec<social_aggregates::ResolvedUserRow>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NotFoundOutput {
    not_found: bool,
    query: String,
    hint: &'static str,
}

pub(super) fn disambiguation_result(
    query: &str,
    candidates: Vec<social_aggregates::ResolvedUserRow>,
) -> Result<CallToolResult, String> {
    structured_result(DisambiguationOutput {
        needs_disambiguation: true,
        query: query.to_string(),
        candidates,
    })
}

pub(super) fn not_found_result(query: &str) -> Result<CallToolResult, String> {
    structured_result(NotFoundOutput {
        not_found: true,
        query: query.to_string(),
        hint: "no user matching this name in local history",
    })
}

pub(super) fn map_application_query_error(error: vrcx_0_application_core::Error) -> String {
    match error {
        vrcx_0_application_core::Error::PersistenceInvalidData(message) => message,
        other => {
            tracing::warn!("MCP persistence query failed: {other}");
            "internal data error while reading local VRCX-0-Nanashi data".into()
        }
    }
}

pub(super) fn structured_result(value: impl Serialize) -> Result<CallToolResult, String> {
    serde_json::to_value(value)
        .map(CallToolResult::structured)
        .map_err(|error| format!("serialize MCP tool result: {error}"))
}

pub(super) fn application_query_result<T: Serialize>(
    result: vrcx_0_application_core::Result<T>,
) -> Result<CallToolResult, String> {
    match result {
        Ok(value) => structured_result(value),
        Err(vrcx_0_application_core::Error::PersistenceInvalidData(message)) => Err(message),
        Err(error) => {
            tracing::warn!("MCP social query failed: {error}");
            Err("internal data error while reading local VRCX-0-Nanashi data".into())
        }
    }
}

pub(super) fn require_current_user_id(runtime: &McpRuntime) -> Result<OwnerId, String> {
    runtime
        .current_user_id()
        .filter(|value| !value.trim().is_empty())
        .map(OwnerId::new)
        .ok_or_else(|| {
            "This tool requires an active realtime VRChat session (current user unknown).".into()
        })
}

#[cfg(test)]
mod time_window_tests {
    use super::*;

    fn resolved_user(
        user_id: &str,
        display_name: &str,
        is_friend: bool,
        encounter_count: i64,
    ) -> social_aggregates::ResolvedUserRow {
        social_aggregates::ResolvedUserRow {
            user_id: user_id.into(),
            display_name: display_name.into(),
            matched_name: display_name.into(),
            is_friend,
            encounter_count,
            last_seen: "2026-06-01T10:00:00Z".into(),
        }
    }

    #[test]
    fn parses_object_form() {
        let value = serde_json::json!({ "from": "2026-01-01T00:00:00Z", "to": null });
        let window = time_window_from_value(&value).unwrap();
        assert_eq!(window.from.as_deref(), Some("2026-01-01T00:00:00Z"));
        assert_eq!(window.to, None);
    }

    #[test]
    fn relative_strings_produce_a_lower_bound() {
        for phrase in [
            "today",
            "this week",
            "last month",
            "last 7 days",
            "past 3 weeks",
        ] {
            let window = time_window_from_value(&serde_json::json!(phrase)).unwrap();
            assert!(window.from.is_some(), "{phrase} should set a lower bound");
        }
    }

    #[test]
    fn calendar_year_forms_produce_exact_bounds() {
        for value in [serde_json::json!("2026"), serde_json::json!(2026)] {
            let window = time_window_from_value(&value).unwrap();
            assert_eq!(window.from.as_deref(), Some("2026-01-01T00:00:00+00:00"));
            assert_eq!(window.to.as_deref(), Some("2027-01-01T00:00:00+00:00"));
        }
    }

    #[test]
    fn invalid_calendar_year_forms_fail_closed() {
        for value in [
            serde_json::json!(9999),
            serde_json::json!("9999"),
            serde_json::json!(2026.5),
        ] {
            let error = time_window_from_value(&value).unwrap_err();
            assert!(error.contains("calendar year"));
        }
    }

    #[test]
    fn all_history_phrases_stay_empty() {
        for phrase in ["all", "all time", "ever", ""] {
            let window = time_window_from_value(&serde_json::json!(phrase)).unwrap();
            assert!(
                window.from.is_none() && window.to.is_none(),
                "{phrase} should be unbounded"
            );
        }
    }

    #[test]
    fn unknown_string_is_rejected() {
        let error = time_window_from_value(&serde_json::json!("whenever-ish")).unwrap_err();
        assert!(error.contains("unrecognized timeWindow string"));
    }

    #[test]
    fn object_bounds_are_coerced_to_rfc3339() {
        // Shorthand, date-only, and "now" must all become valid RFC3339.
        for value in [
            serde_json::json!({ "from": "7d" }),
            serde_json::json!({ "from": "7d", "to": "now" }),
            serde_json::json!({ "from": "2025-07-11", "to": "2025-07-18" }),
            serde_json::json!({ "from": "2025-07-11T10:00:00" }),
        ] {
            let window = time_window_from_value(&value).unwrap();
            for bound in [window.from.as_deref(), window.to.as_deref()]
                .into_iter()
                .flatten()
            {
                assert!(
                    DateTime::parse_from_rfc3339(bound).is_ok(),
                    "bound '{bound}' should be valid RFC3339"
                );
            }
            assert!(
                window.from.is_some(),
                "from bound should be set for {value}"
            );
        }
    }

    #[test]
    fn valid_rfc3339_bounds_pass_through() {
        let value = serde_json::json!({ "from": "2025-07-11T10:00:00Z" });
        let window = time_window_from_value(&value).unwrap();
        assert_eq!(window.from.as_deref(), Some("2025-07-11T10:00:00Z"));
    }

    #[test]
    fn invalid_object_values_are_rejected() {
        let value = serde_json::json!({ "from": "soon", "to": "2025-07-18" });
        assert!(time_window_from_value(&value)
            .unwrap_err()
            .contains("unrecognized timeWindow bound"));
        assert!(time_window_from_value(&serde_json::json!({ "from": 7 }))
            .unwrap_err()
            .contains("timeWindow.from must be a string or null"));
        assert!(
            time_window_from_value(&serde_json::json!({ "since": "7d" }))
                .unwrap_err()
                .contains("unknown timeWindow field")
        );
    }

    #[test]
    fn target_resolution_prefers_exact_name_over_non_exact_candidate() {
        let resolution = resolve_target_from_candidates(
            "Alice",
            vec![
                resolved_user("usr_alice", "Alice", false, 1),
                resolved_user("usr_alias", "Alice Clone", false, 30),
            ],
        );

        match resolution {
            TargetResolution::Resolved { user_id, echo } => {
                assert_eq!(user_id, "usr_alice");
                assert_eq!(echo.unwrap().display_name, "Alice");
            }
            _ => panic!("expected confident resolution"),
        }
    }

    #[test]
    fn target_resolution_returns_ambiguous_for_close_candidates() {
        let resolution = resolve_target_from_candidates(
            "Ali",
            vec![
                resolved_user("usr_alice", "Alice", false, 2),
                resolved_user("usr_ally", "Ally", false, 2),
            ],
        );

        match resolution {
            TargetResolution::Ambiguous(candidates) => assert_eq!(candidates.len(), 2),
            _ => panic!("expected disambiguation"),
        }
    }
}
