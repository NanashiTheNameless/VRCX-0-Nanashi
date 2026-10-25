//! Migration 1: every stored absolute date becomes signed Unix epoch seconds in
//! an INTEGER column.
//!
//! SQLite cannot change a column's declared type, and a TEXT column would turn
//! an integer back into text, so each table is rebuilt: create a copy with the
//! new column types, copy every row while converting, drop the original, rename
//! the copy and recreate its indexes and triggers. Columns that held
//! milliseconds lose their `_ms` suffix. Values the SQL conversion cannot read
//! are parsed in Rust first; anything still unreadable becomes NULL (or 0 for a
//! NOT NULL column) and is logged, but its row is kept.

use serde_json::Value;
use vrcx_0_core::time::parse_epoch_seconds;

use crate::migration::{Migration, MigrationTx, Step, Target};
use crate::Error;

mod settings;
pub(crate) use settings::convert_setting_text;

pub(crate) const VERSION: i64 = 1;

type Columns = &'static [(&'static str, &'static str)];

const GLOBAL_TABLES: &[(&str, Columns)] = &[
    ("assistant_message", &[("created_at", "created_at")]),
    (
        "assistant_session",
        &[("created_at", "created_at"), ("updated_at", "updated_at")],
    ),
    ("memos", &[("edited_at", "edited_at")]),
    ("world_memos", &[("edited_at", "edited_at")]),
    ("avatar_memos", &[("edited_at", "edited_at")]),
    (
        "browse_history",
        &[
            ("first_viewed_at", "first_viewed_at"),
            ("last_viewed_at", "last_viewed_at"),
        ],
    ),
    (
        "cache_avatar",
        &[
            ("added_at", "added_at"),
            ("created_at", "created_at"),
            ("updated_at", "updated_at"),
        ],
    ),
    (
        "cache_world",
        &[
            ("added_at", "added_at"),
            ("created_at", "created_at"),
            ("updated_at", "updated_at"),
        ],
    ),
    ("cache_file", &[("fetched_at", "fetched_at")]),
    ("config_local_changes", &[("changed_at_ms", "changed_at")]),
    ("favorite_world", &[("created_at", "created_at")]),
    ("favorite_avatar", &[("created_at", "created_at")]),
    ("favorite_friend", &[("created_at", "created_at")]),
    ("favorite_screenshot", &[("created_at", "created_at")]),
    ("favorite_group_collection", &[("created_at", "created_at")]),
    ("gamelog_location", &[("created_at", "created_at")]),
    ("gamelog_join_leave", &[("created_at", "created_at")]),
    ("gamelog_portal_spawn", &[("created_at", "created_at")]),
    ("gamelog_video_play", &[("created_at", "created_at")]),
    ("gamelog_resource_load", &[("created_at", "created_at")]),
    ("gamelog_event", &[("created_at", "created_at")]),
    ("gamelog_external", &[("created_at", "created_at")]),
    ("remote_sync_state", &[("last_sync_at_ms", "last_sync_at")]),
    (
        "remote_sync_coverage",
        &[
            ("started_at_ms", "started_at"),
            ("extended_at_ms", "extended_at"),
            ("ended_at_ms", "ended_at"),
        ],
    ),
    ("remote_sync_tombstone", &[("deleted_at_ms", "deleted_at")]),
    ("remote_sync_log", &[("created_at_ms", "created_at")]),
];

const PER_USER_TABLES: &[(&str, Columns)] = &[
    ("feed_gps", &[("created_at", "created_at")]),
    ("feed_status", &[("created_at", "created_at")]),
    ("feed_bio", &[("created_at", "created_at")]),
    ("feed_avatar", &[("created_at", "created_at")]),
    ("feed_online_offline", &[("created_at", "created_at")]),
    ("self_profile_log", &[("created_at", "created_at")]),
    ("friend_log_history", &[("created_at", "created_at")]),
    ("notifications", &[("created_at", "created_at")]),
    (
        "notifications_v2",
        &[
            ("created_at", "created_at"),
            ("updated_at", "updated_at"),
            ("expires_at", "expires_at"),
        ],
    ),
    ("avatar_history", &[("created_at", "created_at")]),
    (
        "avatar_wear_log",
        &[("started_at", "started_at"), ("ended_at", "ended_at")],
    ),
    ("moderation", &[("updated_at", "updated_at")]),
    ("notes", &[("created_at", "created_at")]),
    (
        "mutual_graph_meta",
        &[("last_fetched_at", "last_fetched_at")],
    ),
    ("profile_bio", &[("checked_at", "checked_at")]),
    ("remote_sync_app_settings", &[("updated_at", "updated_at")]),
    (
        "activity_sync_state_v2",
        &[
            ("updated_at", "updated_at"),
            ("source_last_created_at", "source_last_created_at"),
            ("pending_session_start_at", "pending_session_start_at"),
        ],
    ),
    (
        "activity_sessions_v2",
        &[("start_at", "start_at"), ("end_at", "end_at")],
    ),
    ("activity_bucket_cache_v2", &[("built_at", "built_at")]),
    ("activity_page_cache", &[("built_at", "built_at")]),
];

/// Derived from the game log and rebuilt on demand; their cursors and revision
/// strings were built from text dates, so they are cleared instead of kept.
const PER_USER_DERIVED_CACHES: &[&str] = &[
    "activity_sync_state_v2",
    "activity_sessions_v2",
    "activity_bucket_cache_v2",
    "activity_page_cache",
];

/// Config keys whose value is an absolute date, written as ISO text or epoch
/// milliseconds by earlier versions. `*` matches the per-account suffix.
const DATE_CONFIG_KEYS: &[&str] = &[
    "config:vrcx_vrchatregistrylastbackupdate",
    "config:vrcx_vrchatregistrylastrestorecheck",
    "config:vrcx_lastgameofflineat",
    "config:vrcx_gamelogpersistenceresumeafter",
    "config:vrcx_lastavatarcleanupdate_*",
];

/// Triggers the app recreates on startup. Their bodies write the old
/// millisecond columns, so they are dropped here and come back in the new form.
const MANAGED_TRIGGER_PATTERNS: &[&str] = &[
    "remote_sync_deleted_*",
    "remote_sync_restored_*",
    "config_local_change_*",
];

pub(crate) fn migration() -> Migration {
    let mut migration = Migration::new(VERSION, "store absolute dates as epoch seconds")
        .step(Step::custom(|tx, _| drop_managed_triggers(tx)));
    for (table, columns) in GLOBAL_TABLES {
        migration = migration.step(Step::custom(move |tx, _| rebuild_table(tx, table, columns)));
    }
    for (suffix, columns) in PER_USER_TABLES {
        migration = migration.step(Step::per_user_custom(suffix, move |tx, target| {
            rebuild_table(tx, target.require_table()?, columns)
        }));
    }
    // Indexed `julianday(created_at)`, which means nothing for an integer; the
    // app creates its replacement under a new name.
    migration = migration.step(Step::per_user("friend_log_history", |table| {
        vec![format!("DROP INDEX IF EXISTS \"{table}_time_idx\"")]
    }));
    migration = migration
        .step(Step::custom(|tx, _| convert_date_settings(tx, "configs")))
        .step(Step::per_user_custom(
            "remote_sync_app_settings",
            |tx, target: &Target<'_>| convert_date_settings(tx, target.require_table()?),
        ));
    for suffix in PER_USER_DERIVED_CACHES {
        migration = migration.step(Step::per_user_custom(suffix, |tx, target: &Target<'_>| {
            tx.execute_non_query(&format!("DELETE FROM {}", quote(target.require_table()?)))?;
            Ok(())
        }));
    }
    migration
}

fn drop_managed_triggers(tx: &dyn MigrationTx) -> Result<(), Error> {
    let filter = MANAGED_TRIGGER_PATTERNS
        .iter()
        .map(|pattern| format!("name GLOB '{pattern}'"))
        .collect::<Vec<_>>()
        .join(" OR ");
    for name in strings(tx.query(&format!(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND ({filter})"
    ))?) {
        tx.execute_non_query(&format!("DROP TRIGGER IF EXISTS {}", quote(&name)))?;
    }
    Ok(())
}

/// Rewrites date-valued settings to epoch seconds (as text, like every other
/// setting). Values that are not dates are left as they are.
fn convert_date_settings(tx: &dyn MigrationTx, table: &str) -> Result<(), Error> {
    if strings(tx.query(&format!(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '{}'",
        table.replace('\'', "''")
    ))?)
    .is_empty()
    {
        return Ok(());
    }
    let keys = DATE_CONFIG_KEYS
        .iter()
        .map(|key| format!("lower(key) GLOB '{key}'"))
        .collect::<Vec<_>>()
        .join(" OR ");
    let converted = epoch_seconds_sql("value");
    tx.execute_non_query(&format!(
        "UPDATE {} SET value = COALESCE(CAST({converted} AS TEXT), value) WHERE {keys}",
        quote(table)
    ))?;
    for row in tx.query(&format!("SELECT rowid, key, value FROM {}", quote(table)))? {
        let (Some(id), Some(key), Some(value)) =
            (row[0].as_i64(), row[1].as_str(), row[2].as_str())
        else {
            continue;
        };
        let converted = convert_setting_text(key, value);
        if converted != value {
            tx.execute_non_query(&format!(
                "UPDATE {} SET value = '{}' WHERE rowid = {id}",
                quote(table),
                converted.replace('\'', "''")
            ))?;
        }
    }
    Ok(())
}

fn is_managed_trigger(name: &str) -> bool {
    MANAGED_TRIGGER_PATTERNS.iter().any(|pattern| {
        let prefix = pattern.trim_end_matches('*');
        name.starts_with(prefix)
    })
}

pub(crate) fn rebuild_table(
    tx: &dyn MigrationTx,
    table: &str,
    columns: Columns,
) -> Result<(), Error> {
    let Some(create_sql) = strings(tx.query(&format!(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '{}'",
        table.replace('\'', "''")
    ))?)
    .into_iter()
    .next() else {
        return Ok(());
    };
    let existing = table_columns(tx, table)?;
    let present: Vec<(&str, &str, bool)> = columns
        .iter()
        .filter_map(|(from, to)| {
            existing
                .iter()
                .find(|column| column.name.eq_ignore_ascii_case(from))
                .map(|column| (*from, *to, column.not_null))
        })
        .collect();
    if present.is_empty() {
        return Ok(());
    }

    if table.starts_with("gamelog_")
        && !existing
            .iter()
            .any(|column| column.name == "event_discriminator")
    {
        let rows = tx.query(&format!("SELECT rowid, created_at FROM {}", quote(table)))?;
        tx.execute_non_query(&format!(
            "ALTER TABLE {} ADD COLUMN event_discriminator TEXT NOT NULL DEFAULT ''",
            quote(table)
        ))?;
        for row in rows {
            let id = row[0]
                .as_i64()
                .ok_or_else(|| Error::Database("Missing game log row id".into()))?;
            let discriminator = legacy_event_discriminator(&row[1]);
            tx.execute_non_query(&format!(
                "UPDATE {} SET event_discriminator = '{}' WHERE rowid = {id}",
                quote(table),
                discriminator
            ))?;
        }
    }
    let existing = table_columns(tx, table)?;
    tx.execute_non_query("DROP TABLE IF EXISTS temp.__epoch_date_repairs")?;
    tx.execute_non_query("CREATE TEMP TABLE __epoch_date_repairs (column_name TEXT, source_rowid INTEGER, value INTEGER, PRIMARY KEY(column_name, source_rowid))")?;
    for (from, _, not_null) in &present {
        repair_unreadable_values(tx, table, from, *not_null)?;
    }

    let dependents = tx.query(&format!(
        "SELECT type, name, sql FROM sqlite_master WHERE tbl_name = '{}' AND type IN ('index', 'trigger') AND sql IS NOT NULL",
        table.replace('\'', "''")
    ))?;

    let staging = format!("{table}__epoch_seconds");
    tx.execute_non_query(&format!("DROP TABLE IF EXISTS {}", quote(&staging)))?;
    let create_sql = if table.starts_with("gamelog_") {
        strings(tx.query(&format!(
            "SELECT sql FROM sqlite_master WHERE name = '{}'",
            table.replace('\'', "''")
        ))?)
        .into_iter()
        .next()
        .unwrap_or(create_sql)
    } else {
        create_sql
    };
    tx.execute_non_query(&staged_create_sql(&create_sql, &staging, &present)?)?;

    let mut targets = Vec::new();
    let mut sources = Vec::new();
    for column in &existing {
        match present
            .iter()
            .find(|(from, _, _)| column.name.eq_ignore_ascii_case(from))
        {
            Some((from, to, not_null)) => {
                targets.push(quote(to));
                let raw_converted = if from.ends_with("_ms") {
                    millis_sql(&quote(from))
                } else {
                    epoch_seconds_sql(&quote(from))
                };
                let converted = format!("COALESCE((SELECT value FROM temp.__epoch_date_repairs WHERE column_name = '{}' AND source_rowid = {}.rowid), {raw_converted})", from.replace('\'', "''"), quote(table));
                sources.push(if *not_null {
                    format!("COALESCE({converted}, 0)")
                } else {
                    converted
                });
            }
            None => {
                targets.push(quote(&column.name));
                sources.push(quote(&column.name));
            }
        }
    }
    tx.execute_non_query(&format!(
        "INSERT INTO {} ({}) SELECT {} FROM {} ORDER BY rowid",
        quote(&staging),
        targets.join(", "),
        sources.join(", "),
        quote(table)
    ))?;
    tx.execute_non_query(&format!("DROP TABLE {}", quote(table)))?;
    tx.execute_non_query(&format!(
        "ALTER TABLE {} RENAME TO {}",
        quote(&staging),
        quote(table)
    ))?;

    for row in dependents {
        let kind = row.first().and_then(Value::as_str).unwrap_or_default();
        let name = row.get(1).and_then(Value::as_str).unwrap_or_default();
        let Some(sql) = row.get(2).and_then(Value::as_str) else {
            continue;
        };
        if kind == "trigger" && is_managed_trigger(name) {
            continue;
        }
        let sql = present
            .iter()
            .filter(|(from, to, _)| from != to)
            .fold(sql.to_string(), |sql, (from, to, _)| {
                replace_identifier(&sql, from, to)
            });
        tx.execute_non_query(&sql)?;
    }
    Ok(())
}

/// The same conversion `parse_epoch_seconds` does, for the forms SQLite can
/// read itself: integers in seconds or milliseconds (also as text) and ISO
/// 8601 text with an optional `Z` or `+HH:MM`. Anything else yields NULL.
pub(crate) fn epoch_seconds_sql(column: &str) -> String {
    let trimmed = format!("trim({column})");
    let integer = format!("CAST({trimmed} AS INTEGER)");
    let suffix_length = format!("(CASE WHEN substr({trimmed}, -1) IN ('Z', 'z') THEN 1 WHEN substr({trimmed}, -6, 1) IN ('+', '-') THEN 6 WHEN substr({trimmed}, -5, 1) IN ('+', '-') THEN 5 WHEN substr({trimmed}, -3, 1) IN ('+', '-') THEN 3 ELSE 0 END)");
    let suffix = format!("(CASE {suffix_length} WHEN 1 THEN 'Z' WHEN 6 THEN substr({trimmed}, -6) WHEN 5 THEN substr({trimmed}, -5, 3) || ':' || substr({trimmed}, -2) WHEN 3 THEN substr({trimmed}, -3) || ':00' ELSE '' END)");
    let fraction = format!("substr({trimmed}, 21, length({trimmed}) - 20 - {suffix_length})");
    let whole_seconds = format!("(CASE WHEN substr({trimmed}, 20, 1) = '.' AND length({fraction}) > 0 AND {fraction} NOT GLOB '*[^0-9]*' THEN substr({trimmed}, 1, 19) || {suffix} ELSE {trimmed} END)");
    format!(
        "(CASE \
            WHEN {column} IS NULL THEN NULL \
            WHEN typeof({column}) IN ('integer', 'real') THEN {} \
            WHEN {trimmed} = '' THEN NULL \
            WHEN CAST({integer} AS TEXT) = {trimmed} THEN {} \
            ELSE CAST(strftime('%s', {whole_seconds}) AS INTEGER) \
        END)",
        normalize_sql(&format!("CAST({column} AS INTEGER)")),
        normalize_sql(&integer),
    )
}

fn millis_sql(value: &str) -> String {
    format!(
        "(({value}) / 1000 - CASE WHEN ({value}) < 0 AND ({value}) % 1000 != 0 THEN 1 ELSE 0 END)"
    )
}

fn normalize_sql(value: &str) -> String {
    format!("(CASE WHEN ({value}) >= 100000000000 OR ({value}) <= -100000000000 THEN {} ELSE {value} END)", millis_sql(value))
}

/// Rewrites values SQLite's date functions cannot read but the app's parser can
/// (for example `+0000` offsets) into seconds, so the bulk copy keeps them.
fn repair_unreadable_values(
    tx: &dyn MigrationTx,
    table: &str,
    column: &str,
    not_null: bool,
) -> Result<(), Error> {
    let quoted = quote(column);
    let rows = tx.query(&format!(
        "SELECT rowid, {quoted} FROM {} WHERE typeof({quoted}) = 'text' AND trim({quoted}) <> '' AND {} IS NULL",
        quote(table),
        epoch_seconds_sql(&quoted)
    ))?;
    let mut unreadable = 0usize;
    for row in rows {
        let Some(rowid) = row.first().and_then(Value::as_i64) else {
            continue;
        };
        let text = row.get(1).and_then(Value::as_str).unwrap_or_default();
        let replacement = match parse_epoch_seconds(text) {
            Some(seconds) => seconds.to_string(),
            None => {
                unreadable += 1;
                if not_null {
                    "0".into()
                } else {
                    "NULL".into()
                }
            }
        };
        tx.execute_non_query(&format!(
            "INSERT INTO temp.__epoch_date_repairs (column_name, source_rowid, value) VALUES ('{}', {rowid}, {replacement})",
            column.replace('\'', "''")
        ))?;
    }
    if unreadable > 0 {
        tracing::warn!(
            table,
            column,
            unreadable,
            "date migration: values that are not dates were cleared"
        );
    }
    Ok(())
}

struct TableColumn {
    name: String,
    not_null: bool,
}

fn table_columns(tx: &dyn MigrationTx, table: &str) -> Result<Vec<TableColumn>, Error> {
    Ok(tx
        .query(&format!(
            "SELECT name, \"notnull\" FROM pragma_table_info('{}')",
            table.replace('\'', "''")
        ))?
        .into_iter()
        .filter_map(|row| {
            Some(TableColumn {
                name: row.first()?.as_str()?.to_string(),
                not_null: row.get(1).and_then(Value::as_i64).unwrap_or(0) != 0,
            })
        })
        .collect())
}

/// The original CREATE TABLE statement for `staging`, with each converted
/// column renamed, typed INTEGER, and a `DEFAULT ''` turned into `DEFAULT 0`.
pub(crate) fn staged_create_sql(
    create_sql: &str,
    staging: &str,
    columns: &[(&str, &str, bool)],
) -> Result<String, Error> {
    let open = create_sql
        .find('(')
        .ok_or_else(|| Error::Database(format!("Unexpected table definition: {create_sql}")))?;
    let close = create_sql
        .rfind(')')
        .filter(|close| *close > open)
        .ok_or_else(|| Error::Database(format!("Unexpected table definition: {create_sql}")))?;
    let definitions = split_top_level(&create_sql[open + 1..close])
        .into_iter()
        .map(|definition| {
            let trimmed = definition.trim();
            if staging.starts_with("gamelog_")
                && trimmed.to_ascii_uppercase().starts_with("UNIQUE")
                && !trimmed.contains("event_discriminator")
            {
                if let Some(close) = trimmed.rfind(')') {
                    return format!(
                        "{}, \"event_discriminator\"{}",
                        &trimmed[..close],
                        &trimmed[close..]
                    );
                }
            }
            let (name, rest) = split_identifier(trimmed);
            match columns
                .iter()
                .find(|(from, _, _)| name.eq_ignore_ascii_case(from))
            {
                Some((_, to, _)) => {
                    let constraints = strip_type(rest);
                    let constraints = replace_empty_default(constraints);
                    format!("{} INTEGER{constraints}", quote(to))
                        .trim_end()
                        .to_string()
                }
                None => trimmed.to_string(),
            }
        })
        .collect::<Vec<_>>();
    Ok(format!(
        "CREATE TABLE {} ({}){}",
        quote(staging),
        definitions.join(", "),
        &create_sql[close + 1..]
    ))
}

fn split_top_level(body: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut depth = 0i32;
    let mut quote_char: Option<char> = None;
    for ch in body.chars() {
        if let Some(open) = quote_char {
            current.push(ch);
            let close = if open == '[' { ']' } else { open };
            if ch == close {
                quote_char = None;
            }
            continue;
        }
        match ch {
            '\'' | '"' | '`' | '[' => {
                quote_char = Some(ch);
                current.push(ch);
            }
            '(' => {
                depth += 1;
                current.push(ch);
            }
            ')' => {
                depth -= 1;
                current.push(ch);
            }
            ',' if depth == 0 => parts.push(std::mem::take(&mut current)),
            _ => current.push(ch),
        }
    }
    if !current.trim().is_empty() {
        parts.push(current);
    }
    parts
}

/// Splits a column definition into its (unquoted) name and the rest.
fn split_identifier(definition: &str) -> (String, &str) {
    let mut chars = definition.char_indices();
    match chars.next() {
        Some((_, open @ ('"' | '`' | '['))) => {
            let close = if open == '[' { ']' } else { open };
            match definition[1..].find(close) {
                Some(end) => (definition[1..end + 1].to_string(), &definition[end + 2..]),
                None => (definition.to_string(), ""),
            }
        }
        _ => {
            let end = definition
                .find(|ch: char| ch.is_whitespace())
                .unwrap_or(definition.len());
            (definition[..end].to_string(), &definition[end..])
        }
    }
}

/// Drops the declared type (the words before the first constraint keyword).
fn strip_type(rest: &str) -> &str {
    const CONSTRAINTS: &[&str] = &[
        "CONSTRAINT",
        "PRIMARY",
        "NOT",
        "NULL",
        "UNIQUE",
        "CHECK",
        "DEFAULT",
        "COLLATE",
        "REFERENCES",
        "GENERATED",
        "AS",
    ];
    let mut offset = 0;
    for word in rest.split_inclusive(char::is_whitespace) {
        let token = word.trim();
        if !token.is_empty()
            && CONSTRAINTS
                .iter()
                .any(|keyword| token.eq_ignore_ascii_case(keyword))
        {
            return &rest[offset..];
        }
        offset += word.len();
    }
    &rest[rest.len()..]
}

fn replace_empty_default(constraints: &str) -> String {
    let lower = constraints.to_ascii_lowercase();
    let Some(index) = lower.find("default") else {
        return format!(" {}", constraints.trim()).trim_end().to_string();
    };
    let after = constraints[index + "default".len()..].trim_start();
    let rewritten = if let Some(rest) = after.strip_prefix("''") {
        format!("{}DEFAULT 0{rest}", &constraints[..index])
    } else {
        constraints.to_string()
    };
    format!(" {}", rewritten.trim())
}

/// Replaces whole identifiers only, so `created_at_ms` does not match
/// `created_at`.
pub(crate) fn replace_identifier(sql: &str, from: &str, to: &str) -> String {
    let is_ident = |ch: char| ch.is_ascii_alphanumeric() || ch == '_';
    let mut result = String::with_capacity(sql.len());
    let mut rest = sql;
    while let Some(index) = rest.find(from) {
        let before = rest[..index].chars().next_back();
        let after = rest[index + from.len()..].chars().next();
        result.push_str(&rest[..index]);
        if before.is_some_and(is_ident) || after.is_some_and(is_ident) {
            result.push_str(from);
        } else {
            result.push_str(to);
        }
        rest = &rest[index + from.len()..];
    }
    result.push_str(rest);
    result
}

fn quote(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

fn strings(rows: Vec<Vec<Value>>) -> Vec<String> {
    rows.into_iter()
        .filter_map(|row| row.into_iter().next())
        .filter_map(|value| value.as_str().map(str::to_owned))
        .collect()
}

#[cfg(test)]
mod tests;

pub(crate) fn legacy_event_discriminator(value: &Value) -> String {
    use sha2::{Digest, Sha256};
    let numeric;
    let text = match value {
        Value::String(text) => text.as_str(),
        Value::Number(number) => {
            let Some(integer) = number.as_i64() else {
                return String::new();
            };
            if integer.unsigned_abs() < 100_000_000_000 || integer % 1000 == 0 {
                return String::new();
            }
            numeric = integer.to_string();
            numeric.as_str()
        }
        _ => return String::new(),
    };
    if parse_epoch_seconds(text)
        .and_then(|seconds| chrono::DateTime::from_timestamp(seconds, 0))
        .is_some_and(|date| vrcx_0_core::time::iso_millis(date) == text)
    {
        return String::new();
    }
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
