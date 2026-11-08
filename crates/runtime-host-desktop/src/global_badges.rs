//! Fork: the global badge list. Starts from the copy built into this
//! release, then prefers a signed copy cached in the data folder or newly
//! downloaded from the `data-assets` release, whichever has the highest
//! revision. A copy is only used after its signature checks out, so an old
//! or tampered file can never replace a newer one.

use std::path::{Path, PathBuf};
use std::sync::{OnceLock, RwLock};
use std::time::Duration;

use vrcx_0_application_core::{sleep_until_due_or_stopped, TaskSupervisor};
use vrcx_0_contracts::global_badges::{GlobalBadgeCatalog, GlobalBadgeSource};
use vrcx_0_integrations::global_badges::{fetch_signed_catalog, parse_catalog, verify_signature};

const EMBEDDED: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../data/global-badges.jsonc"
));
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(30);
const REFRESH_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
/// Dot files in the data folder are skipped by data export.
const CACHE_FILE: &str = ".global-badges.jsonc";
const CACHE_SIGNATURE_FILE: &str = ".global-badges.jsonc.sig";

static CATALOG: OnceLock<RwLock<GlobalBadgeCatalog>> = OnceLock::new();

fn embedded_catalog() -> GlobalBadgeCatalog {
    match parse_catalog(EMBEDDED, GlobalBadgeSource::Embedded) {
        Ok((catalog, _)) => catalog,
        Err(error) => {
            tracing::warn!(%error, "built-in global badge list is unreadable");
            GlobalBadgeCatalog::default()
        }
    }
}

fn catalog_lock() -> &'static RwLock<GlobalBadgeCatalog> {
    CATALOG.get_or_init(|| RwLock::new(embedded_catalog()))
}

/// The global badge list currently in use.
pub fn global_badges_catalog() -> GlobalBadgeCatalog {
    catalog_lock()
        .read()
        .unwrap_or_else(|error| error.into_inner())
        .clone()
}

/// Uses `candidate` when it is newer than the list in use.
fn adopt(candidate: GlobalBadgeCatalog) -> bool {
    let mut current = catalog_lock()
        .write()
        .unwrap_or_else(|error| error.into_inner());
    if candidate.revision > current.revision {
        *current = candidate;
        true
    } else {
        false
    }
}

fn read_cached(dir: &Path) -> Option<GlobalBadgeCatalog> {
    let text = std::fs::read_to_string(dir.join(CACHE_FILE)).ok()?;
    let signature = std::fs::read_to_string(dir.join(CACHE_SIGNATURE_FILE)).ok()?;
    if let Err(error) = verify_signature(text.as_bytes(), &signature) {
        tracing::warn!(%error, "ignoring cached global badge list");
        return None;
    }
    parse_catalog(&text, GlobalBadgeSource::Cached)
        .map(|(catalog, _)| catalog)
        .ok()
}

fn write_cached(dir: &Path, text: &str, signature: &str) {
    let result = std::fs::write(dir.join(CACHE_FILE), text)
        .and_then(|()| std::fs::write(dir.join(CACHE_SIGNATURE_FILE), signature));
    if let Err(error) = result {
        tracing::debug!(%error, "could not cache the global badge list");
    }
}

async fn refresh(dir: &Path) {
    match fetch_signed_catalog().await {
        Ok((text, signature)) => match parse_catalog(&text, GlobalBadgeSource::Downloaded) {
            Ok((catalog, problems)) => {
                if !problems.is_empty() {
                    tracing::debug!(?problems, "global badge list has skipped entries");
                }
                let revision = catalog.revision;
                if adopt(catalog) {
                    write_cached(dir, &text, &signature);
                    tracing::info!(revision, "using a newer global badge list");
                }
            }
            Err(error) => tracing::debug!(%error, "downloaded global badge list is unreadable"),
        },
        Err(error) => tracing::debug!(%error, "global badge list not refreshed"),
    }
}

pub(crate) fn start_global_badges_loop(data_dir: &Path, tasks: &TaskSupervisor) {
    let dir: PathBuf = data_dir.to_path_buf();
    if let Some(cached) = read_cached(&dir) {
        adopt(cached);
    }
    tasks.spawn_cancellable(move |stop_token| async move {
        if !sleep_until_due_or_stopped(FIRST_CHECK_DELAY, &stop_token).await {
            return;
        }
        loop {
            if stop_token.is_stop_requested() {
                return;
            }
            refresh(&dir).await;
            if !sleep_until_due_or_stopped(REFRESH_INTERVAL, &stop_token).await {
                return;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_built_in_list_is_used_first() {
        let catalog = embedded_catalog();
        assert!(catalog.revision > 0);
        assert_eq!(catalog.source, GlobalBadgeSource::Embedded);
        assert!(catalog.badges.iter().any(|badge| badge.id == "donator"));
    }

    #[test]
    fn a_cached_copy_without_a_valid_signature_is_ignored() {
        let dir = std::env::temp_dir().join(format!("vrcx0-global-badges-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(CACHE_FILE), r#"{"revision": 999999}"#).unwrap();
        std::fs::write(dir.join(CACHE_SIGNATURE_FILE), "bm90IGEgc2lnbmF0dXJl").unwrap();
        assert!(read_cached(&dir).is_none());
        std::fs::remove_file(dir.join(CACHE_SIGNATURE_FILE)).unwrap();
        assert!(read_cached(&dir).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_a_higher_revision_replaces_the_list_in_use() {
        let current = global_badges_catalog().revision;
        let older = GlobalBadgeCatalog {
            revision: current.saturating_sub(1),
            ..GlobalBadgeCatalog::default()
        };
        assert!(!adopt(older));
        let same = GlobalBadgeCatalog {
            revision: current,
            ..GlobalBadgeCatalog::default()
        };
        assert!(!adopt(same));
        let newer = GlobalBadgeCatalog {
            revision: current + 1000,
            source: GlobalBadgeSource::Downloaded,
            ..GlobalBadgeCatalog::default()
        };
        assert!(adopt(newer));
        assert_eq!(global_badges_catalog().revision, current + 1000);
    }
}
