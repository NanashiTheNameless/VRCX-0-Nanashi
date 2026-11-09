use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use reqwest::header::{HeaderMap, DATE, RETRY_AFTER};
use reqwest::{StatusCode, Url};
use tokio::sync::Mutex;
use tokio::time::Instant;

const MIN_RATE_LIMIT_WAIT: Duration = Duration::from_secs(60);
const MAX_BACKOFF: Duration = Duration::from_secs(15 * 60);
const MAX_RETRY_AFTER: Duration = Duration::from_secs(60 * 60);

// Only a server pause is shared across requests. Ordinary requests run
// concurrently; bulk jobs pace themselves with their own RequestPacer.
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
    ) -> Result<Option<Arc<Mutex<ApiRateLimit>>>, Duration> {
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
            let not_before = state.lock().await.not_before;
            let now = Instant::now();
            match not_before {
                Some(until) if until > now => {
                    if !can_wait {
                        return Err(until.duration_since(now));
                    }
                    tokio::time::sleep_until(until).await;
                }
                None => {
                    if !can_wait {
                        return Err(Duration::MAX);
                    }
                    std::future::pending::<()>().await;
                }
                _ => return Ok(Some(state)),
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
            let now = Instant::now();
            let retry_after = retry_after.unwrap_or_default().min(MAX_RETRY_AFTER);
            // Requests already in flight when the pause began report the
            // same limit; only the first one escalates the backoff.
            if self.not_before.is_some_and(|until| until > now) {
                self.not_before = self.not_before.max(Some(now + retry_after));
            } else {
                self.not_before = Some(now + retry_after.max(self.backoff));
                self.backoff = self.backoff.saturating_mul(2).min(MAX_BACKOFF);
            }
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
    async fn api_requests_run_concurrently_without_a_pause() {
        let limits = VrchatRateLimits::default();
        let url = Url::parse("https://api.vrchat.cloud/api/1/users/usr_a").unwrap();
        let start = Instant::now();
        let in_flight: Vec<_> = acquire_without_waiting(&limits, &url).await;
        assert_eq!(in_flight.len(), 10);
        assert_eq!(start.elapsed(), Duration::ZERO);
    }

    async fn acquire_without_waiting(
        limits: &VrchatRateLimits,
        url: &Url,
    ) -> Vec<Arc<Mutex<ApiRateLimit>>> {
        let mut handles = Vec::new();
        for _ in 0..10 {
            handles.push(limits.acquire(url, false, false).await.unwrap().unwrap());
        }
        handles
    }

    #[tokio::test(start_paused = true)]
    async fn retry_after_survives_canceled_waiters_and_applies_to_other_api_paths() {
        let limits = VrchatRateLimits::default();
        let profile = Url::parse("https://api.vrchat.cloud/api/1/users/usr_a").unwrap();
        let friends = Url::parse("https://api.vrchat.cloud/api/1/auth/user/friends").unwrap();
        let start = Instant::now();
        let first = limits
            .acquire(&profile, false, true)
            .await
            .unwrap()
            .unwrap();
        let mut headers = HeaderMap::new();
        headers.insert(RETRY_AFTER, "600".parse().unwrap());
        first
            .lock()
            .await
            .observe(StatusCode::TOO_MANY_REQUESTS, &headers);
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
            let request = limits.acquire(&url, false, true).await.unwrap().unwrap();
            request
                .lock()
                .await
                .observe(StatusCode::TOO_MANY_REQUESTS, &HeaderMap::new());
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
    async fn concurrent_rate_limits_escalate_the_backoff_once() {
        let limits = VrchatRateLimits::default();
        let url = Url::parse("https://api.vrchat.cloud/api/1/users/usr_a").unwrap();
        let in_flight = acquire_without_waiting(&limits, &url).await;
        for request in &in_flight {
            request
                .lock()
                .await
                .observe(StatusCode::TOO_MANY_REQUESTS, &HeaderMap::new());
        }
        let start = Instant::now();
        let next = limits.acquire(&url, false, true).await.unwrap().unwrap();
        assert_eq!(start.elapsed(), MIN_RATE_LIMIT_WAIT);
        next.lock()
            .await
            .observe(StatusCode::TOO_MANY_REQUESTS, &HeaderMap::new());
        let start = Instant::now();
        drop(limits.acquire(&url, false, true).await.unwrap().unwrap());
        assert_eq!(start.elapsed(), MIN_RATE_LIMIT_WAIT * 2);
    }

    #[tokio::test(start_paused = true)]
    async fn huge_retry_after_is_capped_instead_of_pausing_forever() {
        let limits = VrchatRateLimits::default();
        let url = Url::parse("https://api.vrchat.cloud/api/1/users/usr_a").unwrap();
        let mut headers = HeaderMap::new();
        headers.insert(RETRY_AFTER, u64::MAX.to_string().parse().unwrap());
        limits
            .acquire(&url, false, true)
            .await
            .unwrap()
            .unwrap()
            .lock()
            .await
            .observe(StatusCode::TOO_MANY_REQUESTS, &headers);
        let start = Instant::now();
        drop(limits.acquire(&url, false, true).await.unwrap().unwrap());
        assert_eq!(start.elapsed(), MAX_RETRY_AFTER);
    }

    #[tokio::test(start_paused = true)]
    async fn configured_api_endpoints_share_limits_with_fresh_client_fallbacks() {
        let limits = VrchatRateLimits::default();
        let url = Url::parse("https://example.com/custom-api/users/usr_a").unwrap();
        let first = limits.acquire(&url, true, true).await.unwrap().unwrap();
        first
            .lock()
            .await
            .observe(StatusCode::TOO_MANY_REQUESTS, &HeaderMap::new());
        drop(first);
        let start = Instant::now();
        drop(limits.acquire(&url, false, true).await.unwrap().unwrap());
        assert_eq!(start.elapsed(), MIN_RATE_LIMIT_WAIT);
    }

    #[tokio::test(start_paused = true)]
    async fn interactive_actions_fail_without_waiting_through_a_server_pause() {
        let limits = VrchatRateLimits::default();
        let url = Url::parse("https://api.vrchat.cloud/api/1/users/usr_a").unwrap();
        let first = limits.acquire(&url, false, true).await.unwrap().unwrap();
        first
            .lock()
            .await
            .observe(StatusCode::TOO_MANY_REQUESTS, &HeaderMap::new());
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
