//! Last observed full-profile details of the signed-in user's friends.
//!
//! VRChat's friend list leaves out the details only a full profile carries
//! (join date, pronouns, badges, age verification and similar), so without
//! this every restart needs one profile request per friend to show them
//! again. Rows are written only from data the app already received and only
//! when a value changed; nothing here makes a request, and the table is never
//! synced.

use std::collections::HashSet;

use serde_json::{Map, Value};

use crate::common::{normalize_text, row_i64, row_string, ParamsBuilder};
use crate::database::{DatabaseService, DatabaseWriteTransaction};
use crate::ownership::OwnerId;
use crate::realtime::normalize_user_table_prefix;
use crate::Error;

pub use vrcx_0_core::friends::FRIEND_PROFILE_DETAIL_KEYS as DETAIL_KEYS;

fn ensure_table(db: &DatabaseService, owner_user_id: &OwnerId) -> Result<String, Error> {
    let user_prefix = normalize_user_table_prefix(owner_user_id.as_str())?;
    db.ensure_schema_once(&format!("friend_profile_details:{user_prefix}"), || {
        db.execute_non_query(
            &format!(
                "CREATE TABLE IF NOT EXISTS {user_prefix}_friend_profile_details (endpoint TEXT NOT NULL, user_id TEXT NOT NULL, details TEXT NOT NULL, observed_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (endpoint, user_id)) WITHOUT ROWID"
            ),
            &Default::default(),
        )?;
        merge_legacy_age_verification(db, &user_prefix)
    })?;
    Ok(user_prefix)
}

/// Age verification used to have a table of its own. Its rows move into the
/// details once, without overwriting newer details, and the table is dropped.
fn merge_legacy_age_verification(db: &DatabaseService, user_prefix: &str) -> Result<(), Error> {
    let legacy = format!("{user_prefix}_age_verification");
    let exists = !db
        .execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = @name",
            &ParamsBuilder::new().set("name", legacy.clone()).build(),
        )?
        .is_empty();
    if !exists {
        return Ok(());
    }
    let table = format!("{user_prefix}_friend_profile_details");
    db.write_transaction(|tx| {
        let rows = tx.execute(
            &format!("SELECT endpoint, user_id, age_verified, status, observed_at FROM {legacy}"),
            &Default::default(),
        )?;
        for row in rows {
            let endpoint = row_string(&row, 0);
            let user_id = row_string(&row, 1);
            let stored = stored_details(tx, &table, &endpoint, &user_id)?;
            let mut details = stored
                .as_deref()
                .and_then(|text| serde_json::from_str::<Map<String, Value>>(text).ok())
                .unwrap_or_default();
            match row_i64(&row, 2) {
                0 | 1 if !details.contains_key("ageVerified") => {
                    details.insert("ageVerified".into(), Value::Bool(row_i64(&row, 2) == 1));
                }
                _ => {}
            }
            let status = row_string(&row, 3);
            if !status.is_empty() && !details.contains_key("ageVerificationStatus") {
                details.insert("ageVerificationStatus".into(), Value::String(status));
            }
            write_details(
                tx,
                &table,
                &endpoint,
                &user_id,
                stored,
                &details,
                row_i64(&row, 4),
            )?;
        }
        tx.execute_non_query(&format!("DROP TABLE {legacy}"), &Default::default())?;
        Ok(())
    })
}

fn stored_details(
    tx: &DatabaseWriteTransaction<'_>,
    table: &str,
    endpoint: &str,
    user_id: &str,
) -> Result<Option<String>, Error> {
    Ok(tx
        .execute(
            &format!(
                "SELECT details FROM {table} WHERE endpoint = @endpoint AND user_id = @user_id"
            ),
            &ParamsBuilder::new()
                .set("endpoint", endpoint)
                .set("user_id", user_id)
                .build(),
        )?
        .first()
        .map(|row| row_string(row, 0)))
}

/// Writes `details` unless they are empty or equal to what is stored.
fn write_details(
    tx: &DatabaseWriteTransaction<'_>,
    table: &str,
    endpoint: &str,
    user_id: &str,
    stored: Option<String>,
    details: &Map<String, Value>,
    observed_at: i64,
) -> Result<(), Error> {
    if details.is_empty() {
        return Ok(());
    }
    let text = serde_json::to_string(details)?;
    if stored.as_deref() == Some(text.as_str()) {
        return Ok(());
    }
    tx.execute_non_query(
        &format!(
            "INSERT INTO {table} (endpoint, user_id, details, observed_at) VALUES (@endpoint, @user_id, @details, @observed_at) \
             ON CONFLICT(endpoint, user_id) DO UPDATE SET details = excluded.details, observed_at = excluded.observed_at"
        ),
        &ParamsBuilder::new()
            .set("endpoint", endpoint)
            .set("user_id", user_id)
            .set("details", text)
            .set("observed_at", observed_at)
            .build(),
    )?;
    Ok(())
}

/// The detail properties present on `user`, or `None` when it carries none.
fn details_of(user: &Map<String, Value>) -> Option<Map<String, Value>> {
    let details: Map<String, Value> = DETAIL_KEYS
        .iter()
        .filter_map(|key| user.get(*key).map(|value| (key.to_string(), value.clone())))
        .collect();
    (!details.is_empty()).then_some(details)
}

/// Stores the details carried by `users`, merged over what was stored before
/// so a property missing from one response is kept. A row is only rewritten
/// when its stored details actually change.
pub fn observe<'a>(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    endpoint: &str,
    users: impl IntoIterator<Item = &'a Map<String, Value>>,
    observed_at: i64,
) -> Result<(), Error> {
    let observations: Vec<(String, Map<String, Value>)> = users
        .into_iter()
        .filter_map(|user| {
            let user_id =
                normalize_text(user.get("id").and_then(Value::as_str).unwrap_or_default());
            if !user_id.starts_with("usr_") {
                return None;
            }
            details_of(user).map(|details| (user_id, details))
        })
        .collect();
    if observations.is_empty() {
        return Ok(());
    }
    let user_prefix = ensure_table(db, owner_user_id)?;
    let endpoint = normalize_text(endpoint);
    let table = format!("{user_prefix}_friend_profile_details");
    db.write_transaction(|tx| {
        for (user_id, details) in observations {
            let stored = stored_details(tx, &table, &endpoint, &user_id)?;
            let mut merged = stored
                .as_deref()
                .and_then(|text| serde_json::from_str::<Map<String, Value>>(text).ok())
                .unwrap_or_default();
            merged.extend(details);
            write_details(
                tx,
                &table,
                &endpoint,
                &user_id,
                stored,
                &merged,
                observed_at,
            )?;
        }
        Ok(())
    })
}

fn patch(user_id: &str, text: &str, observed_at: Option<i64>) -> Option<Map<String, Value>> {
    let mut details: Map<String, Value> = serde_json::from_str(text).ok()?;
    details.insert("id".into(), Value::String(user_id.to_string()));
    if let Some(observed_at) = observed_at {
        details.insert("observedAt".into(), Value::from(observed_at));
    }
    Some(details)
}

/// The stored details for one friend, as a profile patch carrying `id`.
pub fn get(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    endpoint: &str,
    user_id: &str,
) -> Result<Option<Map<String, Value>>, Error> {
    let user_prefix = ensure_table(db, owner_user_id)?;
    let user_id = normalize_text(user_id);
    let rows = db.execute(
        &format!(
            "SELECT details FROM {user_prefix}_friend_profile_details WHERE endpoint = @endpoint AND user_id = @user_id"
        ),
        &ParamsBuilder::new()
            .set("endpoint", normalize_text(endpoint))
            .set("user_id", user_id.clone())
            .build(),
    )?;
    Ok(rows
        .first()
        .and_then(|row| patch(&user_id, &row_string(row, 0), None)))
}

/// The stored details for the given friends, as profile patches carrying
/// `id` and `observedAt`.
pub fn list(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    endpoint: &str,
    user_ids: &[String],
) -> Result<Vec<Map<String, Value>>, Error> {
    if user_ids.is_empty() {
        return Ok(Vec::new());
    }
    let user_prefix = ensure_table(db, owner_user_id)?;
    let wanted: HashSet<&str> = user_ids.iter().map(String::as_str).collect();
    let rows = db.execute(
        &format!(
            "SELECT user_id, details, observed_at FROM {user_prefix}_friend_profile_details WHERE endpoint = @endpoint"
        ),
        &ParamsBuilder::new()
            .set("endpoint", normalize_text(endpoint))
            .build(),
    )?;
    Ok(rows
        .iter()
        .filter_map(|row| {
            let user_id = row_string(row, 0);
            if !wanted.contains(user_id.as_str()) {
                return None;
            }
            patch(&user_id, &row_string(row, 1), Some(row_i64(row, 2)))
        })
        .collect())
}

#[cfg(test)]
mod tests;
