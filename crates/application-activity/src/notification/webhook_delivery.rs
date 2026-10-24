use std::sync::{Arc, Mutex};

use serde::Serialize;
use vrcx_0_application_core::{RuntimeDiagnostics, RuntimeOperationStatus};
use vrcx_0_core::time::now_epoch;

use super::{WebhookDeliveryFailure, WebhookDeliveryOutcome};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WebhookDeliveryRecord {
    pub event: String,
    pub status: Option<i32>,
    pub attempts: u32,
    pub observed_at: i64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WebhookDeliveryChannelSnapshot {
    pub last_success: Option<WebhookDeliveryRecord>,
    pub last_failure: Option<WebhookDeliveryRecord>,
    pub dropped_count: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WebhookDeliverySnapshot {
    pub notification: WebhookDeliveryChannelSnapshot,
    pub auth: WebhookDeliveryChannelSnapshot,
}

#[derive(Clone, Copy)]
pub(crate) enum WebhookDeliveryChannel {
    Notification,
    Auth,
}

#[derive(Clone, Default)]
pub struct WebhookDeliveryMonitor {
    snapshot: Arc<Mutex<WebhookDeliverySnapshot>>,
}

impl WebhookDeliveryMonitor {
    pub fn snapshot(&self) -> WebhookDeliverySnapshot {
        self.snapshot
            .lock()
            .map(|snapshot| snapshot.clone())
            .unwrap_or_default()
    }

    pub(crate) fn record_result(
        &self,
        diagnostics: &RuntimeDiagnostics,
        diagnostics_key: &str,
        channel: WebhookDeliveryChannel,
        event: &str,
        result: &Result<WebhookDeliveryOutcome, WebhookDeliveryFailure>,
    ) {
        let observed_at = now_epoch();
        if let Ok(mut snapshot) = self.snapshot.lock() {
            let channel_snapshot = channel_snapshot_mut(&mut snapshot, channel);
            match result {
                Ok(outcome) => {
                    channel_snapshot.last_success = Some(WebhookDeliveryRecord {
                        event: event.to_string(),
                        status: Some(outcome.status),
                        attempts: outcome.attempts,
                        observed_at,
                    });
                }
                Err(failure) => {
                    channel_snapshot.last_failure = Some(WebhookDeliveryRecord {
                        event: event.to_string(),
                        status: failure.status,
                        attempts: failure.attempts,
                        observed_at,
                    });
                }
            }
        }
        if let Err(failure) = result {
            diagnostics.record_command(
                diagnostics_key,
                RuntimeOperationStatus::Error,
                format!("{event}: {failure}"),
            );
            tracing::warn!(
                event,
                status = ?failure.status,
                attempts = failure.attempts,
                kind = ?failure.kind,
                "webhook delivery failed"
            );
        }
    }

    pub(crate) fn record_drop(
        &self,
        diagnostics: &RuntimeDiagnostics,
        diagnostics_key: &str,
        channel: WebhookDeliveryChannel,
        event: &str,
        reason: &str,
    ) {
        if let Ok(mut snapshot) = self.snapshot.lock() {
            let channel_snapshot = channel_snapshot_mut(&mut snapshot, channel);
            channel_snapshot.dropped_count = channel_snapshot.dropped_count.saturating_add(1);
            channel_snapshot.last_failure = Some(WebhookDeliveryRecord {
                event: event.to_string(),
                status: None,
                attempts: 0,
                observed_at: vrcx_0_core::time::now_epoch(),
            });
        }
        diagnostics.record_command(
            diagnostics_key,
            RuntimeOperationStatus::Error,
            format!("{event}: {reason}"),
        );
        tracing::warn!(event, reason, "webhook delivery dropped");
    }
}

fn channel_snapshot_mut(
    snapshot: &mut WebhookDeliverySnapshot,
    channel: WebhookDeliveryChannel,
) -> &mut WebhookDeliveryChannelSnapshot {
    match channel {
        WebhookDeliveryChannel::Notification => &mut snapshot.notification,
        WebhookDeliveryChannel::Auth => &mut snapshot.auth,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn monitor_keeps_latest_outcomes_and_counts_drops() {
        let monitor = WebhookDeliveryMonitor::default();
        let diagnostics = RuntimeDiagnostics::new();
        monitor.record_result(
            &diagnostics,
            "notificationWebhook",
            WebhookDeliveryChannel::Notification,
            "invite",
            &Ok(WebhookDeliveryOutcome {
                status: 204,
                attempts: 2,
            }),
        );
        monitor.record_drop(
            &diagnostics,
            "authWebhook",
            WebhookDeliveryChannel::Auth,
            "auth.relogin.failed",
            "queue full",
        );

        let snapshot = monitor.snapshot();
        assert_eq!(
            snapshot.notification.last_success.unwrap().status,
            Some(204)
        );
        assert_eq!(snapshot.auth.dropped_count, 1);
        assert_eq!(snapshot.auth.last_failure.unwrap().attempts, 0);
    }
}
