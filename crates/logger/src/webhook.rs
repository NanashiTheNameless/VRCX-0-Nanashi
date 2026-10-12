use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use vrcx_0_logger_protocol::wire::{WebhookFormat, WebhookRequest};

use crate::app::now_unix;
use crate::runtime::lock;
use crate::store::{Store, WEBHOOK};

const SEND_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_DETAIL_CHARS: usize = 1500;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AlertKind {
    Login,
    Storage,
    Recovered,
    Test,
}

impl AlertKind {
    fn label(self) -> &'static str {
        match self {
            Self::Login => "login",
            Self::Storage => "storage",
            Self::Recovered => "recovered",
            Self::Test => "test",
        }
    }
}

struct Alert {
    kind: AlertKind,
    summary: &'static str,
    detail: Option<String>,
}

impl Alert {
    fn render(&self, format: WebhookFormat) -> (&'static str, String) {
        let detail = self.detail.as_deref().map(str::trim).map(|detail| {
            let mut shown: String = detail.chars().take(MAX_DETAIL_CHARS).collect();
            if shown.len() < detail.len() {
                shown.push('…');
            }
            shown
        });
        let label = self.kind.label();
        match format {
            WebhookFormat::Discord => {
                let mut content = format!("**VRCX-0 logger** `{label}`\n{}", self.summary);
                if let Some(detail) = detail {
                    content.push_str(&format!("\n```\n{}\n```", detail.replace("```", "'''")));
                }
                (
                    "application/json",
                    serde_json::json!({ "content": content }).to_string(),
                )
            }
            WebhookFormat::Text => {
                let mut text = format!("VRCX-0 logger [{label}]\n{}", self.summary);
                if let Some(detail) = detail {
                    text.push_str(&format!("\nDetails: {detail}"));
                }
                ("text/plain; charset=utf-8", text)
            }
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebhookConfig {
    url: String,
    format: WebhookFormat,
}

#[derive(Default)]
struct NotifierState {
    last_sent_at: Option<i64>,
    last_ok: Option<bool>,
    alerting: bool,
    dropped_alert_sent: bool,
}

pub struct WebhookStatus {
    pub configured: bool,
    pub target: Option<String>,
    pub format: Option<WebhookFormat>,
    pub last_sent_at: Option<i64>,
    pub last_ok: Option<bool>,
}

pub struct Notifier {
    store: Arc<Store>,
    client: reqwest::Client,
    state: Mutex<NotifierState>,
}

impl Notifier {
    pub fn new(store: Arc<Store>) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .timeout(SEND_TIMEOUT)
            .build()
            .map_err(|error| format!("webhook client: {error}"))?;
        Ok(Self {
            store,
            client,
            state: Mutex::new(NotifierState::default()),
        })
    }

    pub fn configure(&self, request: WebhookRequest) -> Result<(), String> {
        let url = request
            .url
            .map(|url| url.trim().to_string())
            .unwrap_or_default();
        if url.is_empty() {
            return self
                .store
                .delete_sealed(WEBHOOK)
                .map_err(|error| error.to_string());
        }
        let parsed =
            reqwest::Url::parse(&url).map_err(|error| format!("invalid webhook URL: {error}"))?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err("webhook URL must use http or https".into());
        }
        let config = WebhookConfig {
            url,
            format: request.format,
        };
        let json = serde_json::to_vec(&config).map_err(|error| error.to_string())?;
        self.store
            .put_sealed(WEBHOOK, &json)
            .map_err(|error| error.to_string())
    }

    pub fn status(&self) -> WebhookStatus {
        let config = self.config();
        let state = self.state();
        WebhookStatus {
            configured: config.is_some(),
            target: config.as_ref().map(|config| masked_target(&config.url)),
            format: config.as_ref().map(|config| config.format),
            last_sent_at: state.last_sent_at,
            last_ok: state.last_ok,
        }
    }

    pub fn session_stopped(self: &Arc<Self>, reason: &str) {
        self.raise(
            AlertKind::Login,
            "VRChat login stopped. Open VRCX-0 to log the recorder in again.",
            reason.to_string(),
        );
    }

    pub fn two_factor_required(self: &Arc<Self>, methods: &str) {
        self.raise(
            AlertKind::Login,
            "VRChat needs two-factor verification. Open VRCX-0 to enter the code.",
            format!("methods: {methods}"),
        );
    }

    pub fn storage_failed(self: &Arc<Self>, reason: &str) {
        self.raise(
            AlertKind::Storage,
            "Cannot save records. Check the disk and data directory.",
            reason.to_string(),
        );
    }

    fn raise(self: &Arc<Self>, kind: AlertKind, summary: &'static str, detail: String) {
        self.state().alerting = true;
        self.send(Alert {
            kind,
            summary,
            detail: Some(detail),
        });
    }

    pub fn recovered(self: &Arc<Self>) {
        let was_alerting = std::mem::replace(&mut self.state().alerting, false);
        if was_alerting {
            self.send(Alert {
                kind: AlertKind::Recovered,
                summary: "Recording again.",
                detail: None,
            });
        }
    }

    pub fn unsynced_dropped(self: &Arc<Self>, count: u64) {
        if std::mem::replace(&mut self.state().dropped_alert_sent, true) {
            return;
        }
        self.send(Alert {
            kind: AlertKind::Storage,
            summary: "Storage limit reached; records VRCX-0 has not filled in yet were deleted.",
            detail: Some(format!("deleted records: {count}")),
        });
    }

    pub fn desktop_pulled(&self) {
        self.state().dropped_alert_sent = false;
    }

    pub async fn send_test(&self) -> Result<(), String> {
        let config = self
            .config()
            .ok_or_else(|| String::from("no webhook is configured"))?;
        self.deliver(
            &config,
            &Alert {
                kind: AlertKind::Test,
                summary: "Test message. Webhook alerts are working.",
                detail: None,
            },
        )
        .await
    }

    fn send(self: &Arc<Self>, alert: Alert) {
        let Some(config) = self.config() else {
            return;
        };
        let notifier = self.clone();
        tokio::spawn(async move {
            let _ = notifier.deliver(&config, &alert).await;
        });
    }

    async fn deliver(&self, config: &WebhookConfig, alert: &Alert) -> Result<(), String> {
        let (content_type, body) = alert.render(config.format);
        let request = self
            .client
            .post(&config.url)
            .header(reqwest::header::CONTENT_TYPE, content_type)
            .body(body);
        let result = match request.send().await {
            Ok(response) if response.status().is_success() => Ok(()),
            Ok(response) => {
                tracing::warn!(status = %response.status(), "webhook delivery was rejected");
                Err(format!("webhook returned {}", response.status()))
            }
            Err(error) => {
                let error = error.without_url();
                tracing::warn!(error = %error, "webhook delivery failed");
                Err(format!("webhook delivery failed: {error}"))
            }
        };
        let mut state = self.state();
        state.last_sent_at = Some(now_unix());
        state.last_ok = Some(result.is_ok());
        result
    }

    fn config(&self) -> Option<WebhookConfig> {
        let json = self.store.get_sealed(WEBHOOK).ok()??;
        serde_json::from_slice(&json).ok()
    }

    fn state(&self) -> MutexGuard<'_, NotifierState> {
        lock(&self.state)
    }
}

fn masked_target(url: &str) -> String {
    const VISIBLE_TAIL: usize = 5;
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return String::new();
    };
    let origin = parsed.origin().ascii_serialization();
    let path = parsed.path().trim_end_matches('/');
    let hidden = path.chars().count().saturating_sub(VISIBLE_TAIL);
    if hidden == 0 {
        format!("{origin}{path}")
    } else {
        let tail: String = path.chars().skip(hidden).collect();
        format!("{origin}/…{tail}")
    }
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use vrcx_0_logger_protocol::wire::{ErrorResponse, OkResponse};

    use super::*;
    use crate::test_support::{fresh_app, webhook_receiver, Desktop};

    #[tokio::test]
    async fn a_test_message_reaches_the_configured_webhook_and_the_result_is_recorded() {
        let (base, mut inbox) = webhook_receiver().await;
        let desktop = Desktop::new(&fresh_app());
        desktop
            .save_webhook(&format!("{base}/hook"), WebhookFormat::Text)
            .await;

        let (status, OkResponse {}) = desktop.call("/webhook-test", &OkResponse {}).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            inbox.recv().await.as_deref(),
            Some(
                "VRCX-0 logger [test]
Test message. Webhook alerts are working."
            )
        );
        let status = desktop.status().await;
        assert_eq!(status.last_webhook_ok, Some(true));
        assert!(status.last_webhook_at.is_some());
    }

    #[test]
    fn an_alert_carries_its_type_summary_and_the_original_error() {
        let alert = Alert {
            kind: AlertKind::Login,
            summary: "VRChat login stopped. Open VRCX-0 to log the recorder in again.",
            detail: Some(" Invalid Username/Email or Password ".into()),
        };

        let (content_type, text) = alert.render(WebhookFormat::Text);
        assert_eq!(content_type, "text/plain; charset=utf-8");
        assert_eq!(
            text,
            "VRCX-0 logger [login]
VRChat login stopped. Open VRCX-0 to log the recorder in again.
Details: Invalid Username/Email or Password"
        );

        let (content_type, body) = alert.render(WebhookFormat::Discord);
        assert_eq!(content_type, "application/json");
        let content = serde_json::from_str::<serde_json::Value>(&body).unwrap()["content"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(
            content,
            "**VRCX-0 logger** `login`
VRChat login stopped. Open VRCX-0 to log the recorder in again.
```
Invalid Username/Email or Password
```"
        );
    }

    #[test]
    fn a_very_long_original_error_is_cut_short_so_discord_accepts_it() {
        let alert = Alert {
            kind: AlertKind::Storage,
            summary: "Cannot save records. Check the disk and data directory.",
            detail: Some("x".repeat(5000)),
        };

        let (_, text) = alert.render(WebhookFormat::Text);

        assert!(text.ends_with(&format!("{}…", "x".repeat(MAX_DETAIL_CHARS))));
    }

    #[tokio::test]
    async fn a_webhook_that_rejects_the_test_message_is_reported_and_recorded() {
        let (base, _inbox) = webhook_receiver().await;
        let desktop = Desktop::new(&fresh_app());
        desktop
            .save_webhook(&format!("{base}/broken"), WebhookFormat::Text)
            .await;

        let (status, error): (_, ErrorResponse) =
            desktop.call("/webhook-test", &OkResponse {}).await;

        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert!(error.message.contains("500"));
        assert_eq!(desktop.status().await.last_webhook_ok, Some(false));
    }

    #[tokio::test]
    async fn a_test_message_without_a_configured_webhook_is_refused() {
        let desktop = Desktop::new(&fresh_app());

        let (status, error): (_, ErrorResponse) =
            desktop.call("/webhook-test", &OkResponse {}).await;

        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert!(!error.message.is_empty());
        let status = desktop.status().await;
        assert!(!status.webhook_configured);
        assert_eq!(status.last_webhook_ok, None);
    }

    #[tokio::test]
    async fn the_status_shows_the_saved_webhook_and_its_format_without_the_secret() {
        let desktop = Desktop::new(&fresh_app());
        desktop
            .save_webhook(
                "https://discord.com/api/webhooks/123/abcdefghij",
                WebhookFormat::Discord,
            )
            .await;

        let status = desktop.status().await;

        assert!(status.webhook_configured);
        assert_eq!(status.webhook_format, Some(WebhookFormat::Discord));
        assert_eq!(
            status.webhook_target.as_deref(),
            Some("https://discord.com/…fghij")
        );
    }

    #[tokio::test]
    async fn a_webhook_without_a_secret_path_is_shown_in_full() {
        let desktop = Desktop::new(&fresh_app());
        desktop
            .save_webhook("http://127.0.0.1:9999/hook", WebhookFormat::Text)
            .await;

        let status = desktop.status().await;

        assert_eq!(
            status.webhook_target.as_deref(),
            Some("http://127.0.0.1:9999/hook")
        );
        assert_eq!(status.webhook_format, Some(WebhookFormat::Text));
    }
}
