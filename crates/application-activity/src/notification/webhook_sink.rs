use std::sync::Arc;

use crate::{OverlayActivityDelivery, OverlayActivitySink, OverlayActivitySnapshot};
use vrcx_0_application_core::{
    HostSessionRuntime, RuntimeDiagnostics, TaskStopToken, TaskSupervisor,
};

use super::discord::{build_discord_payload, DiscordDeps};
use super::generic_webhook::generic_webhook_payload;
use super::preferences::{load_webhook_preferences, NotificationWebhookPreferences};
use super::webhook::{discord_webhook_url_with_wait, wait_for_webhook_stop};
use super::webhook_delivery::{WebhookDeliveryChannel, WebhookDeliveryMonitor};
use super::{
    load_notification_locale, render_delivery, resolve_delivery_world_name,
    send_json_webhook_with_retry, NotificationConfig, NotificationRemote,
    NotificationWebhookFormat, NotificationWebhookTransport, UserImageCache,
};

const NOTIFICATION_WEBHOOK_QUEUE_CAPACITY: usize = 64;

fn select_notification_webhook_format(
    preferences: &NotificationWebhookPreferences,
) -> Option<NotificationWebhookFormat> {
    if !preferences.enabled || preferences.url.trim().is_empty() {
        return None;
    }
    Some(preferences.format)
}

pub struct NotificationWebhookSink {
    session: HostSessionRuntime,
    config: Arc<dyn NotificationConfig>,
    diagnostics: RuntimeDiagnostics,
    monitor: WebhookDeliveryMonitor,
    queue: tokio::sync::mpsc::Sender<NotificationWebhookJob>,
}

struct NotificationWebhookJob {
    delivery: OverlayActivityDelivery,
    preferences: NotificationWebhookPreferences,
    format: NotificationWebhookFormat,
    locale: super::OverlayLocale,
    vrchat_endpoint: String,
}

struct NotificationWebhookWorkerDeps {
    remote: Arc<dyn NotificationRemote>,
    webhook_transport: Arc<dyn NotificationWebhookTransport>,
    user_image_cache: Arc<UserImageCache>,
    diagnostics: RuntimeDiagnostics,
    monitor: WebhookDeliveryMonitor,
}

pub struct NotificationWebhookSinkDeps {
    pub session: HostSessionRuntime,
    pub config: Arc<dyn NotificationConfig>,
    pub remote: Arc<dyn NotificationRemote>,
    pub webhook_transport: Arc<dyn NotificationWebhookTransport>,
    pub user_image_cache: Arc<UserImageCache>,
    pub diagnostics: RuntimeDiagnostics,
    pub monitor: WebhookDeliveryMonitor,
    pub tasks: TaskSupervisor,
}

impl NotificationWebhookSink {
    pub fn new(deps: NotificationWebhookSinkDeps) -> Self {
        let (queue, receiver) = tokio::sync::mpsc::channel(NOTIFICATION_WEBHOOK_QUEUE_CAPACITY);
        let worker_deps = NotificationWebhookWorkerDeps {
            remote: deps.remote,
            webhook_transport: deps.webhook_transport,
            user_image_cache: deps.user_image_cache,
            diagnostics: deps.diagnostics.clone(),
            monitor: deps.monitor.clone(),
        };
        deps.tasks.spawn_cancellable(move |stop_token| {
            run_notification_webhook_worker(receiver, worker_deps, stop_token)
        });
        Self {
            session: deps.session,
            config: deps.config,
            diagnostics: deps.diagnostics,
            monitor: deps.monitor,
            queue,
        }
    }
}

impl OverlayActivitySink for NotificationWebhookSink {
    fn emit_overlay_activity_snapshot(&self, _snapshot: OverlayActivitySnapshot) {}

    fn emit_overlay_activity_delivery(&self, delivery: OverlayActivityDelivery) {
        if !delivery.webhook {
            return;
        }
        let preferences = load_webhook_preferences(self.config.as_ref());
        let Some(format) = select_notification_webhook_format(&preferences) else {
            return;
        };
        let locale = load_notification_locale(self.config.as_ref());
        let endpoint = self
            .session
            .snapshot()
            .realtime_context
            .map(|context| context.endpoint)
            .unwrap_or_default();
        let event_label = delivery.entry.activity_type.clone();
        let job = NotificationWebhookJob {
            delivery,
            preferences,
            format,
            locale,
            vrchat_endpoint: endpoint,
        };
        if let Err(error) = self.queue.try_send(job) {
            let reason = match error {
                tokio::sync::mpsc::error::TrySendError::Full(_) => "queue full",
                tokio::sync::mpsc::error::TrySendError::Closed(_) => "worker stopped",
            };
            self.monitor.record_drop(
                &self.diagnostics,
                "notificationWebhook",
                WebhookDeliveryChannel::Notification,
                &event_label,
                reason,
            );
        }
    }
}

async fn run_notification_webhook_worker(
    mut receiver: tokio::sync::mpsc::Receiver<NotificationWebhookJob>,
    deps: NotificationWebhookWorkerDeps,
    stop_token: TaskStopToken,
) {
    loop {
        let job = tokio::select! {
            job = receiver.recv() => job,
            _ = wait_for_webhook_stop(&stop_token) => return,
        };
        let Some(job) = job else {
            return;
        };
        tokio::select! {
            _ = deliver_notification_webhook(&deps, job) => {}
            _ = wait_for_webhook_stop(&stop_token) => return,
        }
    }
}

async fn deliver_notification_webhook(
    deps: &NotificationWebhookWorkerDeps,
    mut job: NotificationWebhookJob,
) {
    if let Some((world_name, display_location)) =
        resolve_delivery_world_name(deps.remote.as_ref(), &job.vrchat_endpoint, &job.delivery).await
    {
        job.delivery.entry.content.world_name = world_name;
        if !display_location.trim().is_empty() {
            job.delivery.entry.content.display_location = display_location;
        }
    }
    let render = render_delivery(
        &job.delivery,
        job.locale,
        job.preferences.show_instance_id_in_location,
    );
    let payload = match job.format {
        NotificationWebhookFormat::Generic => {
            generic_webhook_payload(&job.delivery, &render, &job.preferences.fields)
        }
        NotificationWebhookFormat::Discord => {
            build_discord_payload(
                &DiscordDeps {
                    user_image_cache: deps.user_image_cache.as_ref(),
                    remote: deps.remote.as_ref(),
                    endpoint: &job.vrchat_endpoint,
                },
                &job.delivery,
                &render,
                job.locale,
            )
            .await
        }
    };
    let url = match job.format {
        NotificationWebhookFormat::Generic => job.preferences.url.trim().to_string(),
        NotificationWebhookFormat::Discord => {
            discord_webhook_url_with_wait(job.preferences.url.trim())
        }
    };
    let result = send_json_webhook_with_retry(deps.webhook_transport.as_ref(), &url, payload).await;
    deps.monitor.record_result(
        &deps.diagnostics,
        "notificationWebhook",
        WebhookDeliveryChannel::Notification,
        &job.delivery.entry.activity_type,
        &result,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webhook_format_is_selected_only_when_enabled_with_a_url() {
        let mut preferences = enabled_preferences();
        preferences.format = NotificationWebhookFormat::Discord;
        assert_eq!(
            select_notification_webhook_format(&preferences),
            Some(NotificationWebhookFormat::Discord)
        );

        preferences.enabled = false;
        assert_eq!(select_notification_webhook_format(&preferences), None);

        preferences.enabled = true;
        preferences.url = "  ".into();
        assert_eq!(select_notification_webhook_format(&preferences), None);
    }

    fn enabled_preferences() -> NotificationWebhookPreferences {
        NotificationWebhookPreferences {
            enabled: true,
            url: "https://example.com/webhook".into(),
            format: NotificationWebhookFormat::Generic,
            fields: Vec::new(),
            show_instance_id_in_location: false,
        }
    }
}
