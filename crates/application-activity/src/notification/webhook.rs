use std::time::Duration;

use serde_json::Value;
use vrcx_0_application_core::TaskStopToken;

use super::{NotificationWebhookTransport, NotificationWebhookTransportError};

const WEBHOOK_RETRY_DELAYS: &[Duration] = &[Duration::from_millis(750), Duration::from_secs(2)];
const WEBHOOK_MAX_RETRY_DELAY: Duration = Duration::from_secs(60);
const WEBHOOK_STOP_POLL_INTERVAL: Duration = Duration::from_millis(50);

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WebhookDeliveryOutcome {
    pub status: i32,
    pub attempts: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WebhookDeliveryFailureKind {
    Serialization,
    Timeout,
    Transport,
    Http,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WebhookDeliveryFailure {
    pub status: Option<i32>,
    pub attempts: u32,
    pub kind: WebhookDeliveryFailureKind,
}

impl std::fmt::Display for WebhookDeliveryFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match (self.kind, self.status) {
            (WebhookDeliveryFailureKind::Serialization, _) => {
                formatter.write_str("Webhook payload could not be serialized.")
            }
            (WebhookDeliveryFailureKind::Timeout, _) => write!(
                formatter,
                "Webhook delivery timed out after {} attempt(s).",
                self.attempts
            ),
            (WebhookDeliveryFailureKind::Http, Some(status)) => write!(
                formatter,
                "Webhook returned HTTP {status} after {} attempt(s).",
                self.attempts
            ),
            _ => write!(
                formatter,
                "Webhook delivery failed after {} attempt(s).",
                self.attempts
            ),
        }
    }
}

impl std::error::Error for WebhookDeliveryFailure {}

struct WebhookResponse {
    status: i32,
    body: String,
}

pub async fn send_json_webhook_with_retry(
    transport: &dyn NotificationWebhookTransport,
    url: &str,
    payload: Value,
) -> Result<WebhookDeliveryOutcome, WebhookDeliveryFailure> {
    let url = url.trim();
    if url.is_empty() {
        return Err(WebhookDeliveryFailure {
            status: None,
            attempts: 0,
            kind: WebhookDeliveryFailureKind::Transport,
        });
    }
    let body = match serde_json::to_string(&payload) {
        Ok(body) => body,
        Err(_) => {
            return Err(WebhookDeliveryFailure {
                status: None,
                attempts: 0,
                kind: WebhookDeliveryFailureKind::Serialization,
            });
        }
    };
    let mut last_failure = WebhookDeliveryFailure {
        status: None,
        attempts: 0,
        kind: WebhookDeliveryFailureKind::Transport,
    };
    for attempt in 0..=WEBHOOK_RETRY_DELAYS.len() {
        let attempts = attempt as u32 + 1;
        let mut retry_after = None;
        match send_webhook_once(transport, url, &body).await {
            Ok(response) if (200..=299).contains(&response.status) => {
                return Ok(WebhookDeliveryOutcome {
                    status: response.status,
                    attempts,
                });
            }
            Ok(response) => {
                last_failure = if response.status == -1 {
                    WebhookDeliveryFailure {
                        status: None,
                        attempts,
                        kind: WebhookDeliveryFailureKind::Transport,
                    }
                } else {
                    WebhookDeliveryFailure {
                        status: Some(response.status),
                        attempts,
                        kind: WebhookDeliveryFailureKind::Http,
                    }
                };
                if !webhook_status_retryable(response.status) {
                    break;
                }
                if response.status == 429 {
                    retry_after = webhook_retry_after(&response.body);
                }
            }
            Err(kind) => {
                last_failure = WebhookDeliveryFailure {
                    status: None,
                    attempts,
                    kind,
                };
            }
        }
        if let Some(fallback_delay) = WEBHOOK_RETRY_DELAYS.get(attempt) {
            tokio::time::sleep(retry_after.unwrap_or(*fallback_delay)).await;
        }
    }
    Err(last_failure)
}

pub fn webhook_local_time_string(created_at: i64) -> String {
    chrono::DateTime::from_timestamp(created_at, 0)
        .map(|value| {
            value
                .with_timezone(&vrcx_0_core::time::DisplayTimeZone)
                .format("%Y-%m-%d %H:%M:%S")
                .to_string()
        })
        .unwrap_or_default()
}

pub fn discord_webhook_url_with_wait(url: &str) -> String {
    let url = url.trim();
    let Ok(mut parsed) = url::Url::parse(url) else {
        return url.to_string();
    };
    let mut query_pairs = parsed
        .query_pairs()
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<Vec<_>>();
    let mut found_wait = false;
    for (key, value) in &mut query_pairs {
        if key == "wait" {
            *value = "true".into();
            found_wait = true;
        }
    }
    if !found_wait {
        query_pairs.push(("wait".into(), "true".into()));
    }
    parsed.query_pairs_mut().clear().extend_pairs(query_pairs);
    parsed.into()
}

pub(super) async fn wait_for_webhook_stop(stop_token: &TaskStopToken) {
    while !stop_token.is_stop_requested() {
        tokio::time::sleep(WEBHOOK_STOP_POLL_INTERVAL).await;
    }
}

fn webhook_retry_after(body: &str) -> Option<Duration> {
    let seconds = serde_json::from_str::<Value>(body)
        .ok()?
        .get("retry_after")?
        .as_f64()?;
    if !seconds.is_finite() || seconds < 0.0 {
        return None;
    }
    Some(Duration::from_secs_f64(seconds).min(WEBHOOK_MAX_RETRY_DELAY))
}

async fn send_webhook_once(
    transport: &dyn NotificationWebhookTransport,
    url: &str,
    body: &str,
) -> Result<WebhookResponse, WebhookDeliveryFailureKind> {
    match transport.send(url, body).await {
        Ok((status, body)) => Ok(WebhookResponse { status, body }),
        Err(NotificationWebhookTransportError::Transport) => {
            Err(WebhookDeliveryFailureKind::Transport)
        }
        Err(NotificationWebhookTransportError::Timeout) => Err(WebhookDeliveryFailureKind::Timeout),
    }
}

fn webhook_status_retryable(status: i32) -> bool {
    matches!(status, 408 | 409 | 425 | 429 | 500..=599 | -1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discord_webhook_url_enables_wait_without_dropping_query() {
        assert_eq!(
            discord_webhook_url_with_wait(
                "https://discord.com/api/webhooks/1/token?thread_id=2&wait=false"
            ),
            "https://discord.com/api/webhooks/1/token?thread_id=2&wait=true"
        );
        assert_eq!(
            discord_webhook_url_with_wait("https://discord.com/api/webhooks/1/token"),
            "https://discord.com/api/webhooks/1/token?wait=true"
        );
    }

    #[test]
    fn webhook_retry_after_uses_fractional_seconds_and_caps_delay() {
        assert_eq!(
            webhook_retry_after(r#"{"retry_after":0.25}"#),
            Some(Duration::from_millis(250))
        );
        assert_eq!(
            webhook_retry_after(r#"{"retry_after":120}"#),
            Some(WEBHOOK_MAX_RETRY_DELAY)
        );
        assert_eq!(webhook_retry_after(r#"{"retry_after":"soon"}"#), None);
    }
}
