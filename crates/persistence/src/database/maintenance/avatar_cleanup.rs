use chrono::{DateTime, Utc};
use serde_json::Value;
use vrcx_0_core::time::epoch_from_json;

use crate::common::ParamsBuilder;
use crate::feed::feed_avatar_delete_before_sql;
use crate::realtime::{ensure_realtime_tables, normalize_user_table_prefix};
use crate::Error;

use super::super::DatabaseService;

pub fn avatar_auto_cleanup_run(
    db: &DatabaseService,
    user_id: &str,
    now: DateTime<Utc>,
) -> Result<(), Error> {
    crate::config::ensure_config_table(db)?;
    let user_prefix = normalize_user_table_prefix(user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let cleanup_key = crate::config::resolve_config_key("VRCX_avatarAutoCleanup");
    let completed_key =
        crate::config::resolve_config_key(&format!("lastAvatarCleanupDate_{}", user_id.trim()));

    db.write_transaction(|tx| {
        let retention_days = tx
            .execute(
                "SELECT value FROM configs WHERE key = @key LIMIT 1",
                &ParamsBuilder::new().set("key", cleanup_key).build(),
            )?
            .first()
            .and_then(|row| row.first())
            .and_then(Value::as_str)
            .map(str::trim)
            .and_then(parse_retention_days);
        let Some(retention_days) = retention_days else {
            return Ok(());
        };

        let last_completed = tx
            .execute(
                "SELECT value FROM configs WHERE key = @key LIMIT 1",
                &ParamsBuilder::new().set("key", completed_key.clone()).build(),
            )?
            .first()
            .and_then(|row| row.first())
            .and_then(epoch_from_json);
        let now = now.timestamp();
        if last_completed.is_some_and(|last| last <= now && now - last < 7 * 86_400) {
            return Ok(());
        }

        let cutoff = now - retention_days * 86_400;
        let completed_at = now.to_string();
        tx.execute_non_query(
            &feed_avatar_delete_before_sql(&user_prefix),
            &ParamsBuilder::new().set("cutoff", cutoff).build(),
        )?;
        tx.execute_non_query(
            "INSERT INTO configs (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            &ParamsBuilder::new()
                .set("key", completed_key)
                .set("value", completed_at)
                .build(),
        )?;
        Ok(())
    })
}

fn parse_retention_days(value: &str) -> Option<i64> {
    match value {
        "30" => Some(30),
        "90" => Some(90),
        "180" => Some(180),
        "365" => Some(365),
        _ => None,
    }
}
