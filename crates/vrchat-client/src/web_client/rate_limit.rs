use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use reqwest::header::{HeaderMap, DATE, RETRY_AFTER};
use reqwest::{StatusCode, Url};
use tokio::sync::{Mutex, OwnedMutexGuard};
use tokio::time::Instant;

const API_REQUEST_SPACING: Duration = Duration::from_millis(500);
const MIN_RATE_LIMIT_WAIT: Duration = Duration::from_secs(60);
const MAX_BACKOFF: Duration = Duration::from_secs(15 * 60);

#[derive(Default)]
pub(super) struct VrchatRateLimits {
    origins: Mutex<HashMap<String, Arc<Mutex<ApiRateLimit>>>>,
}

pub(super) struct ApiRateLimit {
    not_before: Option<Instant>,
    backoff: Duration,
}

impl Default for ApiRateLimit {
    fn default() -> Self {
        Self {
            not_before: Some(Instant::now()),
            backoff: MIN_RATE_LIMIT_WAIT,
        }
    }
}

impl VrchatRateLimits {
    pub(super) async fn acquire(
        &self,
        url: &Url,
        vrchat_api: bool,
        can_wait: bool,
    ) -> Result<Option<OwnedMutexGuard<ApiRateLimit>>, Duration> {
        let state = {
            let mut origins = self.origins.lock().await;
            let origin = url.origin().ascii_serialization();
            if vrchat_api || (super::is_vrchat_url(url.as_str()) && url.path().starts_with("/api/"))
            {
                Arc::clone(origins.entry(origin).or_default())
            } else {
                let Some(state) = origins.get(&origin) else {
                    return Ok(None);
                };
                Arc::clone(state)
            }
        };
        loop {
            let mut guard = Arc::clone(&state).lock_owned().await;
            let now = Instant::now();
            match guard.not_before {
                Some(until) if until > now => {
                    let delay = until.duration_since(now);
                    if !can_wait && delay > API_REQUEST_SPACING {
                        return Err(delay);
                    }
                    drop(guard);
                    tokio::time::sleep_until(until).await;
                }
                None => {
                    drop(guard);
                    if !can_wait {
                        return Err(Duration::MAX);
                    }
                    std::future::pending::<()>().await;
                }
                _ => {
                    guard.not_before = Some(now + API_REQUEST_SPACING);
                    return Ok(Some(guard));
                }
            }
        }
    }
}

impl ApiRateLimit {
    pub(super) fn observe(&mut self, status: StatusCode, headers: &HeaderMap) {
        let retry_after = retry_after_delay(headers, SystemTime::now());
        if status == StatusCode::TOO_MANY_REQUESTS
            || (status == StatusCode::SERVICE_UNAVAILABLE && retry_after.is_some())
        {
            let delay = retry_after.unwrap_or_default().max(self.backoff);
            self.not_before = Instant::now().checked_add(delay);
            self.backoff = self.backoff.saturating_mul(2).min(MAX_BACKOFF);
        } else if status.is_success() {
            self.backoff = MIN_RATE_LIMIT_WAIT;
        }
    }
}

fn retry_after_delay(headers: &HeaderMap, now: SystemTime) -> Option<Duration> {
    let value = headers.get(RETRY_AFTER)?.to_str().ok()?.trim();
    if let Ok(seconds) = value.parse::<u64>() {
        return Some(Duration::from_secs(seconds));
    }
    let retry_at = httpdate::parse_http_date(value).ok()?;
    let server_now = headers
        .get(DATE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| httpdate::parse_http_date(value).ok())
        .unwrap_or(now);
    Some(retry_at.duration_since(server_now).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_after_accepts_seconds_and_http_dates_with_server_clock_skew() {
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1000);
        let mut headers = HeaderMap::new();
        headers.insert(RETRY_AFTER, "120".parse().unwrap());
        assert_eq!(
            retry_after_delay(&headers, now),
            Some(Duration::from_secs(120))
        );
        headers.insert(DATE, "Wed, 21 Oct 2015 07:28:00 GMT".parse().unwrap());
        headers.insert(
            RETRY_AFTER,
            "Wed, 21 Oct 2015 07:30:00 GMT".parse().unwrap(),
        );
        assert_eq!(
            retry_after_delay(&headers, now),
            Some(Duration::from_secs(120))
        );
        headers.insert(RETRY_AFTER, "invalid".parse().unwrap());
        assert_eq!(retry_after_delay(&headers, now), None);
    }

    #[tokio::test(start_paused = true)]
    async fn api_requests_are_serialized_and_spaced() {
        let limits = VrchatRateLimits::default();
        let url = Url::parse("https://api.vrchat.cloud/api/1/users/usr_a").unwrap();
        let first = limits.acquire(&url, false, true).await.unwrap().unwrap();
        assert!(
            tokio::time::timeout(Duration::from_secs(1), limits.acquire(&url, false, true))
                .await
                .is_err()
        );
        drop(first);
        let start = Instant::now();
        drop(limits.acquire(&url, false, true).await.unwrap().unwrap());
        drop(limits.acquire(&url, false, true).await.unwrap().unwrap());
        assert_eq!(start.elapsed(), API_REQUEST_SPACING);
    }

    #[tokio::test(start_paused = true)]
    async fn retry_after_survives_canceled_waiters_and_applies_to_other_api_paths() {
        let limits = VrchatRateLimits::default();
        let profile = Url::parse("https://api.vrchat.cloud/api/1/users/usr_a").unwrap();
        let friends = Url::parse("https://api.vrchat.cloud/api/1/auth/user/friends").unwrap();
        let start = Instant::now();
        let mut first = limits
            .acquire(&profile, false, true)
            .await
            .unwrap()
            .unwrap();
        let mut headers = HeaderMap::new();
        headers.insert(RETRY_AFTER, "600".parse().unwrap());
        first.observe(StatusCode::TOO_MANY_REQUESTS, &headers);
        drop(first);
        assert!(tokio::time::timeout(
            Duration::from_secs(5),
            limits.acquire(&friends, false, true)
        )
        .await
        .is_err());
        drop(
            limits
                .acquire(&friends, false, true)
                .await
                .unwrap()
                .unwrap(),
        );
        assert_eq!(start.elapsed(), Duration::from_secs(600));
    }

    #[tokio::test(start_paused = true)]
    async fn repeated_rate_limits_back_off_and_external_requests_are_unaffected() {
        let limits = VrchatRateLimits::default();
        let url = Url::parse("https://api.vrchat.cloud/api/1/users/usr_a").unwrap();
        for delay in [60, 120, 240] {
            let mut request = limits.acquire(&url, false, true).await.unwrap().unwrap();
            request.observe(StatusCode::TOO_MANY_REQUESTS, &HeaderMap::new());
            drop(request);
            let start = Instant::now();
            drop(limits.acquire(&url, false, true).await.unwrap().unwrap());
            assert_eq!(start.elapsed(), Duration::from_secs(delay));
        }
        let external = Url::parse("https://example.com/api/1/users/usr_a").unwrap();
        assert!(limits
            .acquire(&external, false, true)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test(start_paused = true)]
    async fn configured_api_endpoints_share_limits_with_fresh_client_fallbacks() {
        let limits = VrchatRateLimits::default();
        let url = Url::parse("https://example.com/custom-api/users/usr_a").unwrap();
        let mut first = limits.acquire(&url, true, true).await.unwrap().unwrap();
        first.observe(StatusCode::TOO_MANY_REQUESTS, &HeaderMap::new());
        drop(first);
        let start = Instant::now();
        drop(limits.acquire(&url, false, true).await.unwrap().unwrap());
        assert_eq!(start.elapsed(), MIN_RATE_LIMIT_WAIT);
    }

    #[tokio::test(start_paused = true)]
    async fn interactive_actions_fail_without_waiting_through_a_server_pause() {
        let limits = VrchatRateLimits::default();
        let url = Url::parse("https://api.vrchat.cloud/api/1/users/usr_a").unwrap();
        let mut first = limits.acquire(&url, false, true).await.unwrap().unwrap();
        first.observe(StatusCode::TOO_MANY_REQUESTS, &HeaderMap::new());
        drop(first);
        let start = Instant::now();
        assert!(
            tokio::time::timeout(Duration::from_secs(1), limits.acquire(&url, false, true))
                .await
                .is_err()
        );
        assert!(
            matches!(limits.acquire(&url, false, false).await, Err(delay) if delay > Duration::from_secs(58))
        );
        assert_eq!(start.elapsed(), Duration::from_secs(1));
    }
}
