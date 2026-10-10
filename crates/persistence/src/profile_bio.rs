pub use vrcx_0_contracts::profile_bio::ProfileBioRecord;

use crate::common::{normalize_text, row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::ownership::OwnerId;
use crate::realtime::{ensure_realtime_tables, normalize_user_table_prefix};
use crate::Error;

pub(crate) fn ensure_profile_bio_table(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
) -> Result<String, Error> {
    let user_prefix = normalize_user_table_prefix(owner_user_id.as_str())?;
    db.ensure_schema_once(&format!("profile_bio:{user_prefix}"), || {
        db.execute_non_query(
            &format!(
                "CREATE TABLE IF NOT EXISTS {user_prefix}_profile_bio (user_id TEXT PRIMARY KEY, bio TEXT NOT NULL DEFAULT '', checked_at TEXT NOT NULL DEFAULT '')"
            ),
            &Default::default(),
        )?;
        Ok(())
    })?;
    Ok(user_prefix)
}

pub fn profile_bio_get(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    user_id: &str,
) -> Result<Option<ProfileBioRecord>, Error> {
    let user_prefix = ensure_profile_bio_table(db, owner_user_id)?;
    let user_id = normalize_text(user_id);
    if user_id.is_empty() {
        return Ok(None);
    }
    Ok(db
        .execute(
            &format!(
                "SELECT bio, checked_at FROM {user_prefix}_profile_bio WHERE user_id = @user_id LIMIT 1"
            ),
            &ParamsBuilder::new().set("user_id", user_id).build(),
        )?
        .first()
        .map(|row| ProfileBioRecord {
            bio: row_string(row, 0),
            checked_at: row_string(row, 1),
        }))
}

pub fn profile_bio_upsert(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    user_id: &str,
    record: &ProfileBioRecord,
) -> Result<(), Error> {
    let user_prefix = ensure_profile_bio_table(db, owner_user_id)?;
    let user_id = require_user_id(user_id)?;
    db.execute_non_query(
        &format!(
            "INSERT INTO {user_prefix}_profile_bio (user_id, bio, checked_at) VALUES (@user_id, @bio, @checked_at) \
             ON CONFLICT(user_id) DO UPDATE SET bio = excluded.bio, checked_at = excluded.checked_at"
        ),
        &ParamsBuilder::new()
            .set("user_id", user_id)
            .set("bio", record.bio.clone())
            .set("checked_at", record.checked_at.clone())
            .build(),
    )?;
    Ok(())
}

pub fn profile_bio_mark_checked(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    user_id: &str,
    checked_at: &str,
) -> Result<(), Error> {
    let user_prefix = ensure_profile_bio_table(db, owner_user_id)?;
    let user_id = require_user_id(user_id)?;
    db.execute_non_query(
        &format!(
            "INSERT INTO {user_prefix}_profile_bio (user_id, checked_at) VALUES (@user_id, @checked_at) \
             ON CONFLICT(user_id) DO UPDATE SET checked_at = excluded.checked_at"
        ),
        &ParamsBuilder::new()
            .set("user_id", user_id)
            .set("checked_at", checked_at.to_string())
            .build(),
    )?;
    Ok(())
}

pub fn profile_bio_next_stale_friend(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    checked_before: &str,
) -> Result<Option<String>, Error> {
    let user_prefix = ensure_profile_bio_table(db, owner_user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    Ok(db
        .execute(
            &format!(
                "SELECT friend.user_id FROM {user_prefix}_friend_log_current friend \
                 LEFT JOIN {user_prefix}_profile_bio bio ON bio.user_id = friend.user_id \
                 WHERE bio.checked_at IS NULL OR bio.checked_at < @checked_before \
                 ORDER BY bio.checked_at IS NOT NULL, bio.checked_at ASC, friend.friend_number ASC, friend.user_id ASC \
                 LIMIT 1"
            ),
            &ParamsBuilder::new()
                .set("checked_before", checked_before.to_string())
                .build(),
        )?
        .first()
        .map(|row| row_string(row, 0))
        .filter(|user_id| !user_id.is_empty()))
}

fn require_user_id(user_id: &str) -> Result<String, Error> {
    let user_id = normalize_text(user_id);
    if user_id.is_empty() {
        return Err(Error::InvalidData("profile bio requires a user id".into()));
    }
    Ok(user_id)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use vrcx_0_contracts::friend_log::{FriendLogCurrentEntryInput, FriendLogUpsertOptionsInput};

    use super::*;
    use crate::friends::friend_log_upsert_current;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-profile-bio-{name}-{}-{nonce}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn owner() -> OwnerId {
        OwnerId::new("usr_owner")
    }

    fn add_friend(db: &DatabaseService, user_id: &str, friend_number: i64) {
        friend_log_upsert_current(
            db,
            owner().as_str().to_string(),
            FriendLogCurrentEntryInput {
                user_id: user_id.into(),
                display_name: format!("{user_id} name"),
                trust_level: None,
                friend_number: friend_number.into(),
            },
            FriendLogUpsertOptionsInput::default(),
        )
        .unwrap();
    }

    fn record(bio: &str, checked_at: &str) -> ProfileBioRecord {
        ProfileBioRecord {
            bio: bio.into(),
            checked_at: checked_at.into(),
        }
    }

    #[test]
    fn upsert_mark_checked_and_get_round_trip_per_owner() {
        let dir = TestDir::new("round-trip");
        let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap();

        assert_eq!(profile_bio_get(&db, &owner(), "usr_friend").unwrap(), None);
        profile_bio_upsert(
            &db,
            &owner(),
            "usr_friend",
            &record("hello", "2026-09-18T00:00:00Z"),
        )
        .unwrap();
        assert_eq!(
            profile_bio_get(&db, &owner(), "usr_friend").unwrap(),
            Some(record("hello", "2026-09-18T00:00:00Z"))
        );

        profile_bio_mark_checked(&db, &owner(), "usr_friend", "2026-09-19T00:00:00Z").unwrap();
        assert_eq!(
            profile_bio_get(&db, &owner(), "usr_friend").unwrap(),
            Some(record("hello", "2026-09-19T00:00:00Z"))
        );
        profile_bio_mark_checked(&db, &owner(), "usr_new", "2026-09-19T00:00:00Z").unwrap();
        assert_eq!(
            profile_bio_get(&db, &owner(), "usr_new").unwrap(),
            Some(record("", "2026-09-19T00:00:00Z"))
        );
        assert_eq!(
            profile_bio_get(&db, &OwnerId::new("usr_other"), "usr_friend").unwrap(),
            None
        );
    }

    #[test]
    fn next_stale_friend_prefers_never_checked_then_oldest_and_skips_fresh_rows() {
        let dir = TestDir::new("next-stale");
        let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap();
        add_friend(&db, "usr_fresh", 1);
        add_friend(&db, "usr_old", 2);
        add_friend(&db, "usr_new", 3);
        profile_bio_upsert(
            &db,
            &owner(),
            "usr_fresh",
            &record("", "2026-09-18T11:00:00Z"),
        )
        .unwrap();
        profile_bio_upsert(
            &db,
            &owner(),
            "usr_old",
            &record("", "2026-09-17T00:00:00Z"),
        )
        .unwrap();
        profile_bio_upsert(
            &db,
            &owner(),
            "usr_gone",
            &record("", "2026-01-01T00:00:00Z"),
        )
        .unwrap();

        let before = "2026-09-18T00:00:00Z";
        assert_eq!(
            profile_bio_next_stale_friend(&db, &owner(), before).unwrap(),
            Some("usr_new".into())
        );

        profile_bio_mark_checked(&db, &owner(), "usr_new", "2026-09-18T12:00:00Z").unwrap();
        assert_eq!(
            profile_bio_next_stale_friend(&db, &owner(), before).unwrap(),
            Some("usr_old".into())
        );

        profile_bio_mark_checked(&db, &owner(), "usr_old", "2026-09-18T12:00:01Z").unwrap();
        assert_eq!(
            profile_bio_next_stale_friend(&db, &owner(), before).unwrap(),
            None
        );
    }
}
