//! Versioned one-time migrations, keyed by `PRAGMA user_version`.
//!
//! Only operations that are too expensive to repeat on every startup belong here - a full
//! table scan to seed derived data, or a table rebuild. Anything idempotent and cheap
//! (adding a column, creating or dropping an index) goes into the relevant `ensure_*_tables`
//! path instead, so it reaches existing databases without an upgrade cycle.
//!
//! WARNING: Published versions are append-only - never edit, reorder or remove an entry.

use crate::migration::Migration;

pub fn migrations() -> Vec<Migration> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_ascends_strictly_from_one() {
        let versions: Vec<i64> = migrations().iter().map(|entry| entry.version).collect();
        assert!(versions.first().is_none_or(|first| *first == 1));
        assert!(versions.windows(2).all(|pair| pair[1] > pair[0]));
    }
}
