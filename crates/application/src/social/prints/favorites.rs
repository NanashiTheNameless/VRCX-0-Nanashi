use std::collections::HashSet;

use serde_json::Value;

use super::cleanup::{
    clamp_print_limit, favorite_limit_for_print_limit, CleanupWarning, PRINT_AUTO_DELETE_LIMIT_MAX,
    PRINT_HARD_CAP,
};
use vrcx_0_application_core::vrchat_api::require_text;
use vrcx_0_application_core::Result;

pub use super::cleanup::CleanupWarningKind;

pub const DEFAULT_AUTO_DELETE_PRINTS_LIMIT: i64 = 60;
const PRINT_FAVORITES_OWNER_REQUIRED: &str = "Print favorites require an authenticated user.";

pub trait PrintFavoritesStore: Send + Sync {
    fn auto_delete_enabled(&self) -> Result<bool>;
    fn auto_delete_limit(&self) -> Result<String>;
    fn legacy_favorite_ids(&self) -> Result<Value>;
    fn favorite_ids(&self, user_id: &str) -> Result<Option<Value>>;
    fn write_favorite_ids(&self, user_id: &str, ids: &Value) -> Result<()>;
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PrintFavoriteState {
    pub favorite_ids: Vec<String>,
    pub max_favorites: u32,
    pub warning: Option<CleanupWarning>,
}

pub fn favorite_ids_from_json(value: &Value) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut ids = Vec::new();
    let Some(array) = value.as_array() else {
        return ids;
    };

    for entry in array {
        let id = entry
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let Some(id) = id else {
            continue;
        };
        if seen.insert(id.to_string()) {
            ids.push(id.to_string());
        }
        if ids.len() >= PRINT_HARD_CAP as usize {
            break;
        }
    }
    ids
}

pub fn set_favorite_id(
    current: &[String],
    print_id: &str,
    favorite: bool,
    max_favorites: usize,
) -> Vec<String> {
    let mut ids = favorite_ids_from_json(&serde_json::json!(current));
    let print_id = print_id.trim();
    if print_id.is_empty() {
        return ids;
    }

    if favorite {
        if ids.iter().all(|id| id != print_id) && ids.len() < max_favorites {
            ids.push(print_id.to_string());
        }
    } else {
        ids.retain(|id| id != print_id);
    }
    ids
}

pub fn favorite_warning(favorite_count: usize, limit: i64) -> Option<CleanupWarning> {
    let max_favorites = favorite_limit_for_print_limit(limit);
    if favorite_count > max_favorites {
        return Some(CleanupWarning {
            kind: CleanupWarningKind::TooManyFavorites,
            favorites: crate::wire_count(favorite_count),
            max: crate::wire_count(max_favorites),
            over: crate::wire_count(favorite_count - max_favorites),
        });
    }
    None
}

pub fn read_auto_delete_old_prints_enabled(store: &dyn PrintFavoritesStore) -> Result<bool> {
    store.auto_delete_enabled()
}

pub fn read_auto_delete_prints_limit(store: &dyn PrintFavoritesStore) -> Result<i64> {
    let raw = store.auto_delete_limit()?;
    let parsed = raw
        .trim()
        .parse::<i64>()
        .unwrap_or(DEFAULT_AUTO_DELETE_PRINTS_LIMIT);
    Ok(clamp_print_limit(parsed) as i64)
}

pub fn effective_favorite_limit(store: &dyn PrintFavoritesStore) -> Result<i64> {
    if read_auto_delete_old_prints_enabled(store)? {
        read_auto_delete_prints_limit(store)
    } else {
        Ok(PRINT_AUTO_DELETE_LIMIT_MAX)
    }
}

fn read_favorite_ids(store: &dyn PrintFavoritesStore, user_id: &str) -> Result<Vec<String>> {
    let user_id = require_text(user_id, PRINT_FAVORITES_OWNER_REQUIRED)?;
    let ids = match store.favorite_ids(&user_id)? {
        Some(ids) => ids,
        None => store.legacy_favorite_ids()?,
    };
    Ok(favorite_ids_from_json(&ids))
}

fn write_favorite_ids(
    store: &dyn PrintFavoritesStore,
    user_id: &str,
    ids: &[String],
) -> Result<()> {
    let user_id = require_text(user_id, PRINT_FAVORITES_OWNER_REQUIRED)?;
    let ids = favorite_ids_from_json(&serde_json::json!(ids));
    store.write_favorite_ids(&user_id, &serde_json::json!(ids))
}

pub(super) fn retain_existing_favorite_ids(
    store: &dyn PrintFavoritesStore,
    user_id: &str,
    existing_ids: &HashSet<String>,
) -> Result<HashSet<String>> {
    let stored = read_favorite_ids(store, user_id)?;
    let retained = stored
        .iter()
        .filter(|id| existing_ids.contains(*id))
        .cloned()
        .collect::<Vec<_>>();
    if retained.len() != stored.len() {
        write_favorite_ids(store, user_id, &retained)?;
    }
    Ok(retained.into_iter().collect())
}

pub fn favorite_state(
    store: &dyn PrintFavoritesStore,
    user_id: &str,
) -> Result<PrintFavoriteState> {
    let favorite_ids = read_favorite_ids(store, user_id)?;
    let limit = effective_favorite_limit(store)?;
    let max_favorites = favorite_limit_for_print_limit(limit);
    Ok(PrintFavoriteState {
        warning: favorite_warning(favorite_ids.len(), limit),
        favorite_ids,
        max_favorites: crate::wire_count(max_favorites),
    })
}

pub fn set_print_favorite(
    store: &dyn PrintFavoritesStore,
    user_id: &str,
    print_id: &str,
    favorite: bool,
) -> Result<PrintFavoriteState> {
    let current = read_favorite_ids(store, user_id)?;
    let limit = effective_favorite_limit(store)?;
    let max_favorites = favorite_limit_for_print_limit(limit);
    let next = set_favorite_id(&current, print_id, favorite, max_favorites);
    write_favorite_ids(store, user_id, &next)?;
    Ok(PrintFavoriteState {
        warning: favorite_warning(next.len(), limit),
        favorite_ids: next,
        max_favorites: crate::wire_count(max_favorites),
    })
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PrintFavoriteBulkResult {
    pub state: PrintFavoriteState,
    pub applied: u32,
    pub skipped: u32,
}

pub fn set_print_favorites(
    store: &dyn PrintFavoritesStore,
    user_id: &str,
    print_ids: &[String],
    favorite: bool,
) -> Result<PrintFavoriteBulkResult> {
    let limit = effective_favorite_limit(store)?;
    let max_favorites = favorite_limit_for_print_limit(limit);
    let mut next = read_favorite_ids(store, user_id)?;
    let mut applied = 0;
    let mut skipped = 0;

    for print_id in print_ids {
        let print_id = print_id.trim();
        if print_id.is_empty() {
            continue;
        }
        if next.iter().any(|id| id == print_id) == favorite {
            continue;
        }
        let updated = set_favorite_id(&next, print_id, favorite, max_favorites);
        if updated.len() == next.len() {
            skipped += 1;
            continue;
        }
        next = updated;
        applied += 1;
    }

    if applied > 0 {
        write_favorite_ids(store, user_id, &next)?;
    }

    Ok(PrintFavoriteBulkResult {
        state: PrintFavoriteState {
            warning: favorite_warning(next.len(), limit),
            favorite_ids: next,
            max_favorites: crate::wire_count(max_favorites),
        },
        applied,
        skipped,
    })
}

pub fn ensure_print_deletable(
    store: &dyn PrintFavoritesStore,
    user_id: &str,
    print_id: &str,
) -> Result<()> {
    let print_id = print_id.trim();
    if print_id.is_empty() {
        return Ok(());
    }
    if read_favorite_ids(store, user_id)?
        .iter()
        .any(|id| id == print_id)
    {
        return Err(vrcx_0_application_core::Error::Custom(format!(
            "Print {print_id} is favorited and cannot be deleted."
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use super::{
        ensure_print_deletable, favorite_ids_from_json, favorite_warning, read_favorite_ids,
        set_favorite_id, set_print_favorite, set_print_favorites, CleanupWarningKind,
        PrintFavoritesStore,
    };
    use serde_json::{json, Value};
    use vrcx_0_application_core::Result;

    const USER: &str = "usr_self";

    struct TestFavoritesStore {
        limit: i64,
        legacy: Value,
        by_user: Mutex<HashMap<String, Value>>,
    }

    impl TestFavoritesStore {
        fn new(limit: i64, ids: &[&str]) -> Self {
            Self {
                limit,
                legacy: json!([]),
                by_user: Mutex::new(HashMap::from([(USER.to_string(), json!(ids))])),
            }
        }

        fn with_legacy(legacy: &[&str]) -> Self {
            Self {
                limit: 60,
                legacy: json!(legacy),
                by_user: Mutex::new(HashMap::new()),
            }
        }

        fn stored_ids(&self, user_id: &str) -> Option<Vec<String>> {
            self.by_user
                .lock()
                .expect("favorite ids lock")
                .get(user_id)
                .map(favorite_ids_from_json)
        }

        fn ids(&self) -> Vec<String> {
            self.stored_ids(USER).unwrap_or_default()
        }
    }

    impl PrintFavoritesStore for TestFavoritesStore {
        fn auto_delete_enabled(&self) -> Result<bool> {
            Ok(true)
        }

        fn auto_delete_limit(&self) -> Result<String> {
            Ok(self.limit.to_string())
        }

        fn legacy_favorite_ids(&self) -> Result<Value> {
            Ok(self.legacy.clone())
        }

        fn favorite_ids(&self, user_id: &str) -> Result<Option<Value>> {
            Ok(self
                .by_user
                .lock()
                .expect("favorite ids lock")
                .get(user_id)
                .cloned())
        }

        fn write_favorite_ids(&self, user_id: &str, ids: &Value) -> Result<()> {
            self.by_user
                .lock()
                .expect("favorite ids lock")
                .insert(user_id.to_string(), ids.clone());
            Ok(())
        }
    }

    #[test]
    fn favorites_are_scoped_per_account_and_seeded_from_the_legacy_list() {
        let store = TestFavoritesStore::with_legacy(&["prnt_a", "prnt_b"]);

        set_print_favorite(&store, "usr_b", "prnt_c", true).expect("favorite");

        assert_eq!(
            store.stored_ids("usr_b"),
            Some(vec!["prnt_a".into(), "prnt_b".into(), "prnt_c".into()])
        );
        assert_eq!(store.stored_ids("usr_a"), None);
        assert_eq!(
            read_favorite_ids(&store, "usr_a").expect("read"),
            vec!["prnt_a", "prnt_b"]
        );
        assert!(read_favorite_ids(&store, "  ").is_err());
    }

    #[test]
    fn normalizes_favorite_ids_from_json() {
        let raw = json!([" prnt_a ", "", "prnt_b", "prnt_a", 42, "prnt_c"]);

        let ids = favorite_ids_from_json(&raw);

        assert_eq!(ids, vec!["prnt_a", "prnt_b", "prnt_c"]);
    }

    #[test]
    fn caps_favorite_ids_from_json_to_the_vrchat_hard_limit() {
        let raw = json!((0..80)
            .map(|index| format!("prnt_{index:02}"))
            .collect::<Vec<_>>());

        let ids = favorite_ids_from_json(&raw);

        assert_eq!(ids.len(), 64);
        assert_eq!(ids.first().map(String::as_str), Some("prnt_00"));
        assert_eq!(ids.last().map(String::as_str), Some("prnt_63"));
    }

    #[test]
    fn toggles_favorite_ids_without_duplicates() {
        let current = vec!["prnt_a".to_string(), "prnt_b".to_string()];

        assert_eq!(
            set_favorite_id(&current, " prnt_c ", true, 3),
            vec!["prnt_a", "prnt_b", "prnt_c"]
        );
        assert_eq!(
            set_favorite_id(&current, " prnt_c ", true, 2),
            vec!["prnt_a", "prnt_b"]
        );
        assert_eq!(
            set_favorite_id(&current, "prnt_a", false, 2),
            vec!["prnt_b"]
        );
        assert_eq!(set_favorite_id(&current, "prnt_b", true, 2), current);
    }

    #[test]
    fn reports_favorite_warning_from_count_and_limit() {
        assert_eq!(
            favorite_warning(26, 30).map(|warning| warning.kind),
            Some(CleanupWarningKind::TooManyFavorites)
        );
        assert_eq!(favorite_warning(25, 30), None);
    }

    #[test]
    fn bulk_favorite_stops_at_the_favorite_limit() {
        let existing = (0..24)
            .map(|index| format!("prnt_{index:02}"))
            .collect::<Vec<_>>();
        let store =
            TestFavoritesStore::new(30, &existing.iter().map(String::as_str).collect::<Vec<_>>());

        let result = set_print_favorites(
            &store,
            USER,
            &[
                "prnt_new_a".to_string(),
                "prnt_new_b".to_string(),
                "prnt_new_c".to_string(),
            ],
            true,
        )
        .expect("bulk favorite");

        assert_eq!(result.applied, 1);
        assert_eq!(result.skipped, 2);
        assert_eq!(result.state.max_favorites, 25);
        assert_eq!(result.state.favorite_ids.len(), 25);
        assert_eq!(store.ids().len(), 25);
    }

    #[test]
    fn bulk_favorite_ignores_ids_already_in_the_requested_state() {
        let store = TestFavoritesStore::new(30, &["prnt_a", "prnt_b"]);

        let result = set_print_favorites(
            &store,
            USER,
            &[" prnt_a ".to_string(), "".to_string(), "prnt_c".to_string()],
            true,
        )
        .expect("bulk favorite");

        assert_eq!(result.applied, 1);
        assert_eq!(result.skipped, 0);
        assert_eq!(
            result.state.favorite_ids,
            vec!["prnt_a", "prnt_b", "prnt_c"]
        );
    }

    #[test]
    fn bulk_unfavorite_removes_every_requested_id() {
        let store = TestFavoritesStore::new(30, &["prnt_a", "prnt_b", "prnt_c"]);

        let result = set_print_favorites(
            &store,
            USER,
            &["prnt_a".to_string(), "prnt_c".to_string()],
            false,
        )
        .expect("bulk unfavorite");

        assert_eq!(result.applied, 2);
        assert_eq!(result.state.favorite_ids, vec!["prnt_b"]);
        assert_eq!(store.ids(), vec!["prnt_b"]);
    }

    #[test]
    fn favorited_prints_are_not_deletable() {
        let store = TestFavoritesStore::new(30, &["prnt_a"]);

        assert!(ensure_print_deletable(&store, USER, " prnt_a ").is_err());
        assert!(ensure_print_deletable(&store, USER, "prnt_b").is_ok());
        assert!(ensure_print_deletable(&store, USER, "  ").is_ok());
    }
}
