use serde_json::Value;
pub use vrcx_0_contracts::profile_history::{
    ProfileHistoryEntry, ProfileHistoryField, ProfileHistoryQuery, ProfileHistorySettings,
    REVISION_KEY, SETTINGS_KEY,
};
use vrcx_0_core::{json::RawJsonObject, OwnerId};

use crate::common::{row_i64, row_string, ParamsBuilder};
use crate::database::{DatabaseService, DatabaseWriteTransaction};
use crate::{config, realtime::normalize_user_table_prefix, Error};

pub fn settings_get(db: &DatabaseService) -> Result<ProfileHistorySettings, Error> {
    let value = config::get_json(db, SETTINGS_KEY, Value::Null)?;
    Ok(serde_json::from_value(value).unwrap_or_default())
}

/// A consistent device-local settings revision for the collector's copy.
pub fn settings_snapshot(db: &DatabaseService) -> Result<(ProfileHistorySettings, u64), Error> {
    config::ensure_config_table(db)?;
    db.write_transaction(|tx| {
        let settings = settings_in_transaction(tx)?;
        let revision = tx
            .execute(
                "SELECT value FROM configs WHERE key = @key",
                &ParamsBuilder::new()
                    .set("key", vrcx_0_contracts::resolve_config_key(REVISION_KEY))
                    .build(),
            )?
            .first()
            .and_then(|row| row_string(row, 0).parse().ok())
            .unwrap_or(0);
        Ok((settings, revision))
    })
}

pub(crate) fn settings_in_transaction(
    tx: &DatabaseWriteTransaction<'_>,
) -> Result<ProfileHistorySettings, Error> {
    Ok(tx
        .execute(
            "SELECT value FROM configs WHERE key = @key",
            &ParamsBuilder::new()
                .set("key", vrcx_0_contracts::resolve_config_key(SETTINGS_KEY))
                .build(),
        )?
        .first()
        .and_then(|row| serde_json::from_str(&row_string(row, 0)).ok())
        .unwrap_or_default())
}

pub fn ensure_tables(db: &DatabaseService, owner: &OwnerId) -> Result<String, Error> {
    crate::remote_sync::ensure_remote_sync_tables(db)?;
    let prefix = normalize_user_table_prefix(owner.as_str())?;
    db.ensure_schema_once(&format!("profile-history:{prefix}"), || {
        db.execute_non_query(
            &format!("CREATE TABLE IF NOT EXISTS {prefix}_profile_history_baseline (user_id TEXT NOT NULL, property TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (user_id, property))"),
            &Default::default(),
        )?;
        for field in ProfileHistoryField::ALL {
            let table = format!("{prefix}_{}", field.stream());
            db.execute_non_query(
                &format!("CREATE TABLE IF NOT EXISTS {table} (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, user_id TEXT NOT NULL, property TEXT NOT NULL, previous_value TEXT NOT NULL, value TEXT NOT NULL)"),
                &Default::default(),
            )?;
            db.execute_non_query(
                &format!("CREATE INDEX IF NOT EXISTS {table}_user_time ON {table} (user_id, created_at DESC, id DESC)"),
                &Default::default(),
            )?;
        }
        Ok(())
    })?;
    Ok(prefix)
}

pub fn settings_set(db: &DatabaseService, next: &ProfileHistorySettings) -> Result<(), Error> {
    config::ensure_config_table(db)?;
    crate::remote_sync::ensure_remote_sync_tables(db)?;
    db.write_transaction(|tx| {
        let previous = settings_in_transaction(tx)?;
        let baseline_tables = tx.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%_profile_history_baseline'",
            &Default::default(),
        )?;
        for field in ProfileHistoryField::ALL {
            if previous.choice(field).recording != next.choice(field).recording {
                for table in &baseline_tables {
                    let table = row_string(table, 0).replace('"', "\"\"");
                    for property in field.properties() {
                        tx.execute_non_query(
                            &format!("DELETE FROM \"{table}\" WHERE property = @property"),
                            &ParamsBuilder::new().set("property", *property).build(),
                        )?;
                    }
                }
            }
            if !previous.choice(field).sync && next.choice(field).sync {
                tx.execute_non_query("UPDATE remote_sync_state SET pull_cursor = 0", &Default::default())?;
            }
        }
        tx.execute_non_query(
            "INSERT INTO configs (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            &ParamsBuilder::new()
                .set("key", vrcx_0_contracts::resolve_config_key(SETTINGS_KEY))
                .set("value", serde_json::to_string(next).expect("profile history settings serialize"))
                .build(),
        )?;
        if previous != *next {
            let revision_key = vrcx_0_contracts::resolve_config_key(REVISION_KEY);
            let revision = tx.execute("SELECT value FROM configs WHERE key = @key", &ParamsBuilder::new().set("key", revision_key.clone()).build())?.first().and_then(|row| row_string(row, 0).parse::<u64>().ok()).unwrap_or(0).saturating_add(1);
            tx.execute_non_query("INSERT INTO configs (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = excluded.value", &ParamsBuilder::new().set("key", revision_key).set("value", revision.to_string()).build())?;
        }
        Ok(())
    })?;
    db.bump_config_generation();
    Ok(())
}

pub fn stream_enabled(db: &DatabaseService, stream: &str) -> Result<bool, Error> {
    let stream = stream
        .strip_suffix(crate::remote_sync::streams::DELETED_SUFFIX)
        .unwrap_or(stream);
    match ProfileHistoryField::from_stream(stream) {
        Some(field) => Ok(settings_get(db)?.choice(field).sync),
        None => Ok(true),
    }
}

pub fn upload_stream_enabled(db: &DatabaseService, stream: &str) -> Result<bool, Error> {
    Ok(stream != "self_profile_log" && stream_enabled(db, stream)?)
}

pub fn observe(
    db: &DatabaseService,
    owner: &OwnerId,
    users: &[RawJsonObject],
    observed_at: i64,
) -> Result<(), Error> {
    observe_with_intent(db, owner, users, observed_at, false)
}

/// Saves enabled values from a manually opened profile if history does not already
/// contain that version. Equal before/after values identify a snapshot, not a change.
pub fn observe_snapshot(
    db: &DatabaseService,
    owner: &OwnerId,
    users: &[RawJsonObject],
    observed_at: i64,
) -> Result<(), Error> {
    observe_with_intent(db, owner, users, observed_at, true)
}

fn observe_with_intent(
    db: &DatabaseService,
    owner: &OwnerId,
    users: &[RawJsonObject],
    observed_at: i64,
    manually_opened: bool,
) -> Result<(), Error> {
    let settings = settings_get(db)?;
    if !ProfileHistoryField::ALL
        .into_iter()
        .any(|field| settings.choice(field).recording)
    {
        return Ok(());
    }
    let prefix = ensure_tables(db, owner)?;
    db.write_transaction(|tx| {
        let settings = settings_in_transaction(tx)?;
        for user in users {
            let Some(user_id) = user.get("id").and_then(Value::as_str).filter(|id| id.starts_with("usr_")) else { continue };
            for field in ProfileHistoryField::ALL {
                if !settings.choice(field).recording { continue; }
                for property in field.properties() {
                    let value = match user.get(*property) {
                        Some(Value::String(value)) => value.as_str(),
                        Some(Value::Null) => "",
                        _ => continue,
                    };
                    let args = ParamsBuilder::new().set("user", user_id).set("property", *property).set("value", value).build();
                    let previous = tx.execute(
                        &format!("SELECT value FROM {prefix}_profile_history_baseline WHERE user_id = @user AND property = @property"), &args,
                    )?.first().map(|row| row_string(row, 0));
                    if !manually_opened && previous.as_deref() == Some(value) { continue; }
                    let previous = if manually_opened {
                        let already_saved = !tx.execute(
                            &format!("SELECT 1 FROM {prefix}_{} WHERE user_id = @user AND property = @property AND (value = @value OR previous_value = @value) LIMIT 1", field.stream()), &args,
                        )?.is_empty();
                        (!already_saved).then(|| value.to_owned())
                    } else { previous };
                    if let Some(previous) = previous {
                        tx.execute_non_query(
                            &format!("INSERT INTO {prefix}_{} (created_at, user_id, property, previous_value, value) VALUES (@at, @user, @property, @previous, @value)", field.stream()),
                            &ParamsBuilder::new().set("at", observed_at).set("user", user_id).set("property", *property).set("previous", previous).set("value", value).build(),
                        )?;
                        crate::remote_sync::late_copies::drop_synced_copies(
                            tx,
                            &format!("{prefix}_{}", field.stream()),
                            field.stream(),
                            crate::remote_sync::late_copies::Rows::Near { subject: user_id, time: observed_at },
                        )?;
                    }
                    tx.execute_non_query(
                        &format!("INSERT INTO {prefix}_profile_history_baseline (user_id, property, value) VALUES (@user, @property, @value) ON CONFLICT(user_id, property) DO UPDATE SET value = excluded.value"), &args,
                    )?;
                }
            }
        }
        Ok(())
    })
}

pub fn query(
    db: &DatabaseService,
    owner: &OwnerId,
    query: &ProfileHistoryQuery,
) -> Result<Vec<ProfileHistoryEntry>, Error> {
    let prefix = ensure_tables(db, owner)?;
    let union = ProfileHistoryField::ALL.into_iter().map(|field| format!(
        "SELECT id, created_at, user_id, property, previous_value, value, '{}' AS field FROM {prefix}_{}", field.as_str(), field.stream()
    )).collect::<Vec<_>>().join(" UNION ALL ");
    let rows = db.execute(
        &format!("SELECT id, created_at, property, previous_value, value, field FROM ({union}) WHERE user_id = @user AND (@field = '' OR field = @field) AND (@before_at IS NULL OR (created_at, field, id) < (@before_at, @before_field, @before_id)) ORDER BY created_at DESC, field DESC, id DESC LIMIT 200"),
        &ParamsBuilder::new().set("user", query.user_id.clone()).set("field", query.field.map_or("", |field| field.as_str())).set("before_at", query.before_at).set("before_id", query.before_id).set("before_field", query.before_field.map_or("", |field| field.as_str())).build(),
    )?;
    Ok(rows
        .into_iter()
        .filter_map(|row| {
            let field = ProfileHistoryField::ALL
                .into_iter()
                .find(|field| field.as_str() == row_string(&row, 5))?;
            Some(ProfileHistoryEntry {
                id: row_i64(&row, 0),
                field,
                created_at: row_i64(&row, 1),
                property: row_string(&row, 2),
                previous_value: row_string(&row, 3),
                value: row_string(&row, 4),
            })
        })
        .collect())
}

#[cfg(test)]
mod tests;
