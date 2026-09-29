use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::Duration;

use moka::policy::EvictionPolicy;
use moka::sync::Cache;
use serde_json::Value;
use vrcx_0_core::json::JsonExt;

use super::NotificationRemote;

const FETCH_TIMEOUT: Duration = Duration::from_secs(5);
const SUCCESS_TTL: Duration = Duration::from_secs(15 * 60);
const FAILURE_TTL: Duration = Duration::from_secs(60);
const SUCCESS_CAPACITY: u64 = 128;
const FAILURE_CAPACITY: u64 = 32;

pub struct UserImageCache {
    success: Cache<String, String>,
    failures: Cache<String, ()>,
    inflight: Mutex<HashMap<String, Weak<tokio::sync::Mutex<()>>>>,
}

impl Default for UserImageCache {
    fn default() -> Self {
        Self::new()
    }
}

impl UserImageCache {
    pub fn new() -> Self {
        Self {
            success: Cache::builder()
                .max_capacity(SUCCESS_CAPACITY)
                .time_to_live(SUCCESS_TTL)
                .eviction_policy(EvictionPolicy::lru())
                .build(),
            failures: Cache::builder()
                .max_capacity(FAILURE_CAPACITY)
                .time_to_live(FAILURE_TTL)
                .eviction_policy(EvictionPolicy::lru())
                .build(),
            inflight: Mutex::new(HashMap::new()),
        }
    }

    pub async fn resolve(
        &self,
        remote: &dyn NotificationRemote,
        endpoint: &str,
        user_id: &str,
    ) -> Option<String> {
        let user_id = user_id.trim();
        if !user_id.starts_with("usr_") {
            return None;
        }
        let endpoint = endpoint.trim();
        if endpoint.is_empty() {
            return None;
        }
        if let Some(url) = self.cached(user_id) {
            return Some(url);
        }
        if self.recently_failed(user_id) {
            return None;
        }
        let inflight = self.inflight_lock(user_id);
        let _guard = inflight.lock().await;
        if let Some(url) = self.cached(user_id) {
            return Some(url);
        }
        if self.recently_failed(user_id) {
            return None;
        }
        match fetch_user_image(remote, endpoint, user_id).await {
            Some(url) => {
                self.store(user_id, &url);
                Some(url)
            }
            None => {
                self.record_failure(user_id);
                None
            }
        }
    }

    pub fn cached_url(&self, user_id: &str) -> Option<String> {
        let user_id = user_id.trim();
        if !user_id.starts_with("usr_") {
            return None;
        }
        self.cached(user_id)
    }

    fn cached(&self, key: &str) -> Option<String> {
        self.success.get(key)
    }

    fn store(&self, key: &str, url: &str) {
        self.success.insert(key.to_string(), url.to_string());
    }

    fn recently_failed(&self, key: &str) -> bool {
        self.failures.get(key).is_some()
    }

    fn record_failure(&self, key: &str) {
        self.failures.insert(key.to_string(), ());
    }

    fn inflight_lock(&self, key: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut map = lock(&self.inflight);
        if let Some(existing) = map.get(key).and_then(Weak::upgrade) {
            return existing;
        }
        map.retain(|_, weak| weak.strong_count() > 0);
        let guard = Arc::new(tokio::sync::Mutex::new(()));
        map.insert(key.to_string(), Arc::downgrade(&guard));
        guard
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

async fn fetch_user_image(
    remote: &dyn NotificationRemote,
    endpoint: &str,
    user_id: &str,
) -> Option<String> {
    let user = tokio::time::timeout(FETCH_TIMEOUT, remote.user(endpoint, user_id))
        .await
        .ok()??;
    image_url_from_user(&user, endpoint)
}

pub fn normalize_avatar_image_url_128(url: &str, endpoint: &str) -> String {
    let url = url.trim();
    if url.is_empty() {
        return String::new();
    }
    file_url_to_image_url_128(url, endpoint).unwrap_or_else(|| url.to_string())
}

fn image_url_from_user(user: &Value, endpoint: &str) -> Option<String> {
    user.trimmed_field("iconUrl")
        .map(|url| normalize_avatar_image_url_128(url, endpoint))
}

fn file_url_to_image_url_128(url: &str, endpoint: &str) -> Option<String> {
    let normalized = url.trim().trim_end_matches('/');
    let path = normalized.split('?').next().unwrap_or(normalized);
    let segments = path.split('/').collect::<Vec<_>>();
    let file_index = segments
        .windows(2)
        .position(|pair| matches!(pair[0], "file" | "image") && pair[1].starts_with("file_"))?;
    let kind = segments[file_index];
    let file_id = segments.get(file_index + 1)?;
    let version = segments.get(file_index + 2)?;
    if !is_vrchat_file_id(file_id) || !is_digits(version) {
        return None;
    }
    let trailing = segments.get(file_index + 3);
    let is_last = file_index + 4 == segments.len();
    match (kind, trailing) {
        ("file", None) => {}
        ("file", Some(&"file")) if is_last => {}
        ("image", Some(resolution)) if is_last && is_digits(resolution) => {}
        _ => return None,
    }
    let endpoint = endpoint.trim().trim_end_matches('/');
    if endpoint.is_empty() {
        return None;
    }
    Some(format!("{endpoint}/image/{file_id}/{version}/128"))
}

fn is_digits(value: &str) -> bool {
    !value.is_empty() && value.chars().all(|value| value.is_ascii_digit())
}

fn is_vrchat_file_id(value: &str) -> bool {
    let Some(suffix) = value.strip_prefix("file_") else {
        return false;
    };
    !suffix.is_empty()
        && suffix
            .chars()
            .all(|value| value.is_ascii_hexdigit() || value == '-')
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn user_image_cache_uses_bounded_moka_storage() {
        let cache = UserImageCache::new();

        for index in 0..SUCCESS_CAPACITY * 2 {
            let key = format!("usr_{index}");
            cache.store(&key, &format!("https://img.example/{index}"));
            cache.record_failure(&key);
        }
        cache.success.run_pending_tasks();
        cache.failures.run_pending_tasks();

        assert!(cache.success.entry_count() <= SUCCESS_CAPACITY);
        assert!(cache.failures.entry_count() <= FAILURE_CAPACITY);
    }

    #[test]
    fn downscales_icon_url_to_128() {
        let user = json!({
            "iconUrl": "https://api.vrchat.cloud/api/1/image/file_1234abcd-0000-1111-2222-abcdefabcdef/2/256",
        });
        assert_eq!(
            image_url_from_user(&user, "https://api.vrchat.cloud/api/1").as_deref(),
            Some("https://api.vrchat.cloud/api/1/image/file_1234abcd-0000-1111-2222-abcdefabcdef/2/128")
        );
    }

    #[test]
    fn converts_icon_file_url_to_128() {
        let user = json!({
            "iconUrl": "https://api.vrchat.cloud/api/1/file/file_abcdefab-0000-1111-2222-abcdefabcdef/7/file",
        });
        assert_eq!(
            image_url_from_user(&user, "https://api.vrchat.cloud/api/1").as_deref(),
            Some("https://api.vrchat.cloud/api/1/image/file_abcdefab-0000-1111-2222-abcdefabcdef/7/128")
        );
    }

    #[test]
    fn keeps_unrecognized_icon_url() {
        let user = json!({
            "iconUrl": "https://img.example/avatar.png",
        });
        assert_eq!(
            image_url_from_user(&user, "https://api.vrchat.cloud/api/1").as_deref(),
            Some("https://img.example/avatar.png")
        );
    }

    #[test]
    fn returns_none_without_icon_url() {
        let user = json!({ "displayName": "Nobody", "iconUrl": " " });
        assert!(image_url_from_user(&user, "https://api.vrchat.cloud/api/1").is_none());
    }
}
