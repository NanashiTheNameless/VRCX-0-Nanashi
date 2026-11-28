//! Versioned one-time migrations, keyed by `PRAGMA user_version`.
//!
//! Only operations that are too expensive to repeat on every startup belong here - a full
//! table scan to seed derived data, or a table rebuild. Anything idempotent and cheap
//! (adding a column, creating or dropping an index) goes into the relevant `ensure_*_tables`
//! path instead, so it reaches existing databases without an upgrade cycle.
//!
//! WARNING: Published versions are append-only - never edit, reorder or remove an entry.

use crate::migration::Migration;
use crate::{DatabaseService, Error};

mod epoch_seconds;

pub(crate) use epoch_seconds::{
    convert_setting_text, epoch_seconds_sql, legacy_event_discriminator, rebuild_table,
    staged_create_sql,
};

pub fn migrations() -> Vec<Migration> {
    vec![
        epoch_seconds::migration(),
        crate::favorites::migration_v1::migration(),
    ]
}

/// Fork: upstream VRCX-0 numbers its migrations on its own, so a database
/// copied from it can claim a version whose fork migrations (epoch seconds
/// first of all) never ran. Upstream's favorite tables keep text dates while
/// the fork's are always integers, which tells the two apart. Such a database
/// starts again from version 0; every fork migration tolerates data upstream
/// already converted.
pub fn reconcile_upstream_database(db: &DatabaseService) -> Result<bool, Error> {
    if crate::migration::migration_version(db)? < 1 {
        return Ok(false);
    }
    let declared = db
        .execute(
            "SELECT type FROM pragma_table_info('vrcx0_favorite_group') WHERE name = 'created_at'",
            &Default::default(),
        )?
        .first()
        .and_then(|row| row.first())
        .and_then(|value| value.as_str())
        .map(str::to_ascii_uppercase)
        .unwrap_or_default();
    if declared != "TEXT" {
        return Ok(false);
    }
    db.execute_non_query("PRAGMA user_version = 0", &Default::default())?;
    Ok(true)
}

#[cfg(test)]
mod tests;
