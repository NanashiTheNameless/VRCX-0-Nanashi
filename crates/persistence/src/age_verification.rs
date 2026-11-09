//! Last observed age verification of the signed-in user's friends.
//!
//! VRChat's friend list does not carry age verification, so without this the
//! value is lost on restart until each profile is observed again. Rows are
//! written only from data the app already received; nothing here makes a
//! request, and the table is never synced.

use serde_json::{Map, Value};

use crate::common::{normalize_text, row_i64, row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::ownership::OwnerId;
use crate::realtime::normalize_user_table_prefix;
use crate::Error;

const UNKNOWN: i64 = -1;

fn ensure_age_verification_table(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
) -> Result<String, Error> {
    let user_prefix = normalize_user_table_prefix(owner_user_id.as_str())?;
    db.ensure_schema_once(&format!("age_verification:{user_prefix}"), || {
        db.execute_non_query(
            &format!(
                "CREATE TABLE IF NOT EXISTS {user_prefix}_age_verification (endpoint TEXT NOT NULL, user_id TEXT NOT NULL, age_verified INTEGER NOT NULL DEFAULT -1, status TEXT NOT NULL DEFAULT '', observed_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (endpoint, user_id))"
            ),
            &Default::default(),
        )?;
        Ok(())
    })?;
    Ok(user_prefix)
}

struct Observation {
    user_id: String,
    age_verified: i64,
    status: String,
}

fn observation(user: &Map<String, Value>) -> Option<Observation> {
    let user_id = normalize_text(user.get("id").and_then(Value::as_str).unwrap_or_default());
    if user_id.is_empty() {
        return None;
    }
    let age_verified = user.get("ageVerified").and_then(Value::as_bool);
    let status = user.get("ageVerificationStatus").and_then(Value::as_str);
    if age_verified.is_none() && status.is_none() {
        return None;
    }
    Some(Observation {
        user_id,
        age_verified: age_verified.map_or(UNKNOWN, i64::from),
        status: status.unwrap_or_default().trim().to_string(),
    })
}

/// Stores the age verification fields of the given user facts. Users without
/// either field are skipped, and a row is only rewritten when a value changed.
pub fn observe<'a>(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    endpoint: &str,
    users: impl IntoIterator<Item = &'a Map<String, Value>>,
    observed_at: i64,
) -> Result<(), Error> {
    let observations: Vec<Observation> = users.into_iter().filter_map(observation).collect();
    if observations.is_empty() {
        return Ok(());
    }
    let user_prefix = ensure_age_verification_table(db, owner_user_id)?;
    let endpoint = normalize_text(endpoint);
    let sql = format!(
        "INSERT INTO {user_prefix}_age_verification (endpoint, user_id, age_verified, status, observed_at) \
         VALUES (@endpoint, @user_id, @age_verified, @status, @observed_at) \
         ON CONFLICT(endpoint, user_id) DO UPDATE SET age_verified = excluded.age_verified, status = excluded.status, observed_at = excluded.observed_at \
         WHERE age_verified != excluded.age_verified OR status != excluded.status"
    );
    db.write_transaction(|tx| {
        for observation in observations {
            tx.execute_non_query(
                &sql,
                &ParamsBuilder::new()
                    .set("endpoint", endpoint.clone())
                    .set("user_id", observation.user_id)
                    .set("age_verified", observation.age_verified)
                    .set("status", observation.status)
                    .set("observed_at", observed_at)
                    .build(),
            )?;
        }
        Ok(())
    })
}

/// Returns stored facts for the given users as user fact patches carrying
/// `id`, `observedAt` and whichever age fields were observed.
pub fn list(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    endpoint: &str,
    user_ids: &[String],
) -> Result<Vec<Map<String, Value>>, Error> {
    if user_ids.is_empty() {
        return Ok(Vec::new());
    }
    let user_prefix = ensure_age_verification_table(db, owner_user_id)?;
    let wanted: std::collections::HashSet<&str> = user_ids.iter().map(String::as_str).collect();
    let rows = db.execute(
        &format!(
            "SELECT user_id, age_verified, status, observed_at FROM {user_prefix}_age_verification WHERE endpoint = @endpoint"
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
            let mut fact = Map::new();
            fact.insert("id".into(), Value::String(user_id));
            match row_i64(row, 1) {
                0 => {
                    fact.insert("ageVerified".into(), Value::Bool(false));
                }
                1 => {
                    fact.insert("ageVerified".into(), Value::Bool(true));
                }
                _ => {}
            }
            let status = row_string(row, 2);
            if !status.is_empty() {
                fact.insert("ageVerificationStatus".into(), Value::String(status));
            }
            fact.insert("observedAt".into(), Value::from(row_i64(row, 3)));
            Some(fact)
        })
        .collect())
}

#[cfg(test)]
mod tests;
