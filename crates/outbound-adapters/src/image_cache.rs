use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::Duration;

use async_trait::async_trait;
use moka::policy::EvictionPolicy;
use moka::sync::Cache;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use vrcx_0_application_core::WebClient;
use vrcx_0_application_core::{Error, ImageCachePort, Result};
use vrcx_0_contracts::UgcCategory;
use vrcx_0_media::image_cache::ImageCache as LocalImageCache;
use vrcx_0_media::Error as MediaError;

const FETCH_TIMEOUT: Duration = Duration::from_secs(5);
const FAILURE_TTL: Duration = Duration::from_secs(60);
const FAILURE_CAPACITY: u64 = 32;
const INFLIGHT_CAPACITY: usize = 128;

struct FetchGuardTable {
    failures: Cache<String, ()>,
    inflight: Mutex<HashMap<String, Weak<InflightLock>>>,
    inflight_permits: Arc<Semaphore>,
}

struct InflightLock {
    lock: tokio::sync::Mutex<()>,
    _permit: OwnedSemaphorePermit,
}

impl InflightLock {
    async fn lock(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.lock.lock().await
    }
}

impl Default for FetchGuardTable {
    fn default() -> Self {
        Self {
            failures: Cache::builder()
                .max_capacity(FAILURE_CAPACITY)
                .time_to_live(FAILURE_TTL)
                .eviction_policy(EvictionPolicy::lru())
                .build(),
            inflight: Mutex::new(HashMap::new()),
            inflight_permits: Arc::new(Semaphore::new(INFLIGHT_CAPACITY)),
        }
    }
}

impl FetchGuardTable {
    fn recently_failed(&self, key: &str) -> bool {
        self.failures.get(key).is_some()
    }

    fn record_failure(&self, key: &str) {
        self.failures.insert(key.to_string(), ());
    }

    async fn inflight_lock(&self, key: &str) -> Arc<InflightLock> {
        {
            let map = lock(&self.inflight);
            if let Some(existing) = map.get(key).and_then(Weak::upgrade) {
                return existing;
            }
        }

        let permit = Arc::clone(&self.inflight_permits)
            .acquire_owned()
            .await
            .expect("image fetch in-flight semaphore is never closed");

        let mut map = lock(&self.inflight);
        if let Some(existing) = map.get(key).and_then(Weak::upgrade) {
            return existing;
        }
        map.retain(|_, weak| weak.strong_count() > 0);
        let guard = Arc::new(InflightLock {
            lock: tokio::sync::Mutex::new(()),
            _permit: permit,
        });
        map.insert(key.to_string(), Arc::downgrade(&guard));
        guard
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub struct LocalImageCacheAdapter {
    web: Arc<WebClient>,
    local_cache: LocalImageCache,
    guards: FetchGuardTable,
}

impl LocalImageCacheAdapter {
    pub fn new(cache_dir: PathBuf, web: Arc<WebClient>) -> Result<Self> {
        Ok(Self {
            web,
            local_cache: LocalImageCache::new(cache_dir).map_err(media_error)?,
            guards: FetchGuardTable::default(),
        })
    }
}

#[async_trait]
impl ImageCachePort for LocalImageCacheAdapter {
    async fn get_image(&self, url: &str, file_id: &str, version: &str) -> Result<String> {
        let key = format!("{file_id}/{version}");
        if self.guards.recently_failed(&key) {
            return Err(Error::Custom(format!("image fetch recently failed: {key}")));
        }
        let inflight = self.guards.inflight_lock(&key).await;
        let _guard = inflight.lock().await;
        if self.guards.recently_failed(&key) {
            return Err(Error::Custom(format!("image fetch recently failed: {key}")));
        }
        let result = self
            .local_cache
            .get_image_with_fetch(file_id, version, || async {
                match tokio::time::timeout(FETCH_TIMEOUT, self.web.fetch_image(url)).await {
                    Ok(result) => result.map_err(|error| MediaError::Custom(error.to_string())),
                    Err(_) => Err(MediaError::Custom(format!("image fetch timed out: {url}"))),
                }
            })
            .await;
        match result {
            Ok(path) => Ok(path),
            Err(error) => {
                self.guards.record_failure(&key);
                Err(media_error(error))
            }
        }
    }

    async fn save_image_to_file(&self, url: &str, path: &str) -> Result<()> {
        self.local_cache
            .save_image_to_file_with_fetch(path, || async {
                self.web
                    .fetch_image(url)
                    .await
                    .map_err(|error| MediaError::Custom(error.to_string()))
            })
            .await
            .map_err(media_error)
    }

    async fn save_ugc_image_to_file(
        &self,
        url: &str,
        ugc_folder_path: &str,
        category: UgcCategory,
        month_folder: &str,
        file_name: &str,
    ) -> Result<String> {
        let out = vrcx_0_media::ugc_image_files::build_ugc_image_path(
            ugc_folder_path,
            category,
            month_folder,
            file_name,
        )
        .map_err(media_error)?;
        let out_str = out.to_string_lossy().into_owned();
        self.save_image_to_file(url, &out_str).await?;
        Ok(out_str)
    }
}

fn media_error(error: MediaError) -> Error {
    match error {
        MediaError::Io(error) => Error::Io(error),
        MediaError::Custom(message) => Error::Custom(message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fetch_guard_table_short_circuits_within_failure_ttl() {
        let table = FetchGuardTable::default();
        assert!(!table.recently_failed("file_a/1"));

        table.record_failure("file_a/1");

        assert!(table.recently_failed("file_a/1"));
        assert!(!table.recently_failed("file_b/1"));
    }

    #[test]
    fn fetch_guard_table_bounds_failure_entries() {
        let table = FetchGuardTable::default();
        for index in 0..FAILURE_CAPACITY * 2 {
            table.record_failure(&format!("file_{index}/1"));
        }
        table.failures.run_pending_tasks();

        assert!(table.failures.entry_count() <= FAILURE_CAPACITY);
    }

    #[tokio::test]
    async fn fetch_guard_table_reuses_inflight_lock_for_same_key() {
        let table = FetchGuardTable::default();
        let first = table.inflight_lock("file_a/1").await;
        let second = table.inflight_lock("file_a/1").await;
        assert!(Arc::ptr_eq(&first, &second));
    }

    #[tokio::test]
    async fn fetch_guard_table_drops_inflight_entry_once_unreferenced() {
        let table = FetchGuardTable::default();
        {
            let first = table.inflight_lock("file_a/1").await;
            drop(first);
        }
        let second = table.inflight_lock("file_a/1").await;
        assert_eq!(Arc::strong_count(&second), 1);
    }

    #[tokio::test]
    async fn fetch_guard_table_bounds_distinct_inflight_entries() {
        let table = FetchGuardTable::default();
        let mut guards = Vec::with_capacity(INFLIGHT_CAPACITY);
        for index in 0..INFLIGHT_CAPACITY {
            guards.push(table.inflight_lock(&format!("file_{index}/1")).await);
        }
        assert_eq!(lock(&table.inflight).len(), INFLIGHT_CAPACITY);
        assert_eq!(table.inflight_permits.available_permits(), 0);

        guards.pop();
        guards.push(table.inflight_lock("file_replacement/1").await);

        assert_eq!(lock(&table.inflight).len(), INFLIGHT_CAPACITY);
        assert_eq!(table.inflight_permits.available_permits(), 0);
    }
}
