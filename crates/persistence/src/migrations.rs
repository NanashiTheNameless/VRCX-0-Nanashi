//! Versioned one-time migrations, keyed by `PRAGMA user_version`.
//!
//! Only operations that are too expensive to repeat on every startup belong here - a full
//! table scan to seed derived data, or a table rebuild. Anything idempotent and cheap
//! (adding a column, creating or dropping an index) goes into the relevant `ensure_*_tables`
//! path instead, so it reaches existing databases without an upgrade cycle.
//!
//! WARNING: Published versions are append-only - never edit, reorder or remove an entry.

use crate::migration::Migration;

mod epoch_seconds;

pub(crate) use epoch_seconds::{
    convert_setting_text, epoch_seconds_sql, legacy_event_discriminator, staged_create_sql,
};

pub fn migrations() -> Vec<Migration> {
    vec![epoch_seconds::migration()]
}
