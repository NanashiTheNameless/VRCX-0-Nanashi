use super::*;

use chrono::Weekday;
use std::{collections::HashMap, sync::atomic::AtomicUsize};

#[derive(Default)]
struct FakeEnvironment {
    values: Mutex<HashMap<String, String>>,
    errors: Mutex<Vec<TelemetryClientErrorInput>>,
    unavailable: AtomicBool,
    scale: Mutex<TelemetryDatabaseScale>,
    legacy_vrcx_detected: AtomicBool,
}

impl FakeEnvironment {
    fn set(&self, key: &str, value: &str) {
        self.values
            .lock()
            .unwrap()
            .insert(key.to_string(), value.to_string());
    }
}

impl TelemetryEnvironment for FakeEnvironment {
    fn get_bool(&self, key: &str, default_value: bool) -> vrcx_0_application_core::Result<bool> {
        if self.unavailable.load(Ordering::Acquire) {
            return Err(vrcx_0_application_core::Error::Database(
                "unavailable".into(),
            ));
        }
        Ok(self
            .values
            .lock()
            .unwrap()
            .get(key)
            .and_then(|value| value.parse().ok())
            .unwrap_or(default_value))
    }

    fn get_string(
        &self,
        key: &str,
        default_value: &str,
    ) -> vrcx_0_application_core::Result<String> {
        if self.unavailable.load(Ordering::Acquire) {
            return Err(vrcx_0_application_core::Error::Database(
                "unavailable".into(),
            ));
        }
        Ok(self
            .values
            .lock()
            .unwrap()
            .get(key)
            .cloned()
            .unwrap_or_else(|| default_value.to_string()))
    }

    fn set_string(&self, key: &str, value: &str) -> vrcx_0_application_core::Result<()> {
        self.set(key, value);
        Ok(())
    }

    fn drain_client_errors(
        &self,
        since: Option<&str>,
        limit: usize,
    ) -> Vec<TelemetryClientErrorInput> {
        self.errors
            .lock()
            .unwrap()
            .iter()
            .filter(|entry| since.is_none_or(|since| entry.ts_iso.as_str() > since))
            .take(limit)
            .cloned()
            .collect()
    }

    fn platform(&self) -> String {
        "windows".into()
    }

    fn arch(&self) -> String {
        "x86_64".into()
    }

    fn system_locale(&self) -> Option<String> {
        Some("en-US".into())
    }

    fn timezone(&self) -> Option<String> {
        Some("UTC".into())
    }

    fn database_scale(&self) -> TelemetryDatabaseScale {
        *self.scale.lock().unwrap()
    }

    fn system_theme_category(&self) -> String {
        "dark".into()
    }

    fn legacy_vrcx_detected(&self) -> bool {
        self.legacy_vrcx_detected.load(Ordering::Acquire)
    }
}

struct FakeTransport {
    attempts: AtomicUsize,
    fail_attempt: Option<usize>,
    payloads: Mutex<Vec<(String, serde_json::Value)>>,
}

impl FakeTransport {
    fn new(fail_attempt: Option<usize>) -> Self {
        Self {
            attempts: AtomicUsize::new(0),
            fail_attempt,
            payloads: Mutex::new(Vec::new()),
        }
    }
}

impl TelemetryTransport for FakeTransport {
    fn is_enabled(&self) -> bool {
        true
    }

    fn post<'a>(&'a self, path: &'a str, payload: serde_json::Value) -> TelemetryPostFuture<'a> {
        Box::pin(async move {
            self.payloads
                .lock()
                .unwrap()
                .push((path.to_string(), payload));
            let attempt = self.attempts.fetch_add(1, Ordering::SeqCst) + 1;
            if self.fail_attempt == Some(attempt) {
                Err("rejected".into())
            } else {
                Ok(())
            }
        })
    }
}

fn runtime(environment: Arc<FakeEnvironment>, transport: Arc<FakeTransport>) -> TelemetryRuntime {
    runtime_with_version(environment, transport, "2.2.0")
}

fn runtime_with_version(
    environment: Arc<FakeEnvironment>,
    transport: Arc<FakeTransport>,
    app_version: &str,
) -> TelemetryRuntime {
    runtime_with_auth_scope(environment, transport, app_version, RuntimeAuthScope::new())
}

fn runtime_with_auth_scope(
    environment: Arc<FakeEnvironment>,
    transport: Arc<FakeTransport>,
    app_version: &str,
    auth_scope: RuntimeAuthScope,
) -> TelemetryRuntime {
    TelemetryRuntime::new(TelemetryRuntimeDeps {
        environment,
        transport,
        tasks: TaskSupervisor::new(),
        backend_runtime: BackendRuntime::new(vrcx_0_application_core::RuntimeHostProfile::Desktop),
        auth_scope,
        app_version: app_version.into(),
    })
}

fn config_payloads(transport: &FakeTransport) -> Vec<serde_json::Value> {
    transport
        .payloads
        .lock()
        .unwrap()
        .iter()
        .filter(|(path, _)| path == "/api/v1/telemetry/config")
        .map(|(_, payload)| payload["config"].clone())
        .collect()
}

fn set_friend_count(environment: &FakeEnvironment, friend_count: Option<i64>) {
    environment.scale.lock().unwrap().friend_count = friend_count;
}

fn clear_account_snapshot_backoff(runtime: &TelemetryRuntime) {
    runtime
        .inner
        .state
        .lock()
        .unwrap()
        .account_config_snapshot_attempted_at = None;
}

#[tokio::test]
async fn fresh_install_resends_config_once_friends_are_stored_after_sign_in() {
    let environment = Arc::new(FakeEnvironment::default());
    let transport = Arc::new(FakeTransport::new(None));
    let auth_scope = RuntimeAuthScope::new();
    let runtime = runtime_with_auth_scope(
        environment.clone(),
        transport.clone(),
        "2.31.0",
        auth_scope.clone(),
    );

    runtime.tick().await;
    runtime.tick().await;
    assert_eq!(config_payloads(&transport).len(), 1);
    assert_eq!(
        config_payloads(&transport)[0]["friendCountBucket"],
        "unknown"
    );

    auth_scope.set("usr_new", "");
    set_friend_count(&environment, Some(0));
    runtime.tick().await;
    assert_eq!(config_payloads(&transport).len(), 1);

    set_friend_count(&environment, Some(3));
    clear_account_snapshot_backoff(&runtime);
    runtime.tick().await;
    let payloads = config_payloads(&transport);
    assert_eq!(payloads.len(), 2);
    assert_eq!(payloads[1]["friendCountBucket"], "lt100");
    assert_eq!(
        environment
            .get_string(TELEMETRY_ACCOUNT_CONFIG_REPORTED_VERSION_CONFIG_KEY, "")
            .unwrap(),
        "2.31.0"
    );

    clear_account_snapshot_backoff(&runtime);
    runtime.tick().await;
    assert_eq!(config_payloads(&transport).len(), 2);
}

#[tokio::test]
async fn startup_config_with_stored_friends_skips_the_sign_in_resend() {
    let environment = Arc::new(FakeEnvironment::default());
    set_friend_count(&environment, Some(250));
    let transport = Arc::new(FakeTransport::new(None));
    let auth_scope = RuntimeAuthScope::new();
    let runtime = runtime_with_auth_scope(
        environment.clone(),
        transport.clone(),
        "2.31.0",
        auth_scope.clone(),
    );

    runtime.tick().await;
    auth_scope.set("usr_existing", "");
    runtime.tick().await;

    let payloads = config_payloads(&transport);
    assert_eq!(payloads.len(), 1);
    assert_eq!(payloads[0]["friendCountBucket"], "100_500");
}

#[test]
fn account_snapshot_waits_for_friends_until_the_grace_period() {
    assert!(!account_snapshot_ready(None, Duration::ZERO));
    assert!(!account_snapshot_ready(Some(0), Duration::from_secs(60)));
    assert!(account_snapshot_ready(Some(1), Duration::ZERO));
    assert!(account_snapshot_ready(None, ACCOUNT_SNAPSHOT_FRIEND_GRACE));
}

#[tokio::test]
async fn vrcx_origin_prefers_migrated_markers_over_detected_legacy_data() {
    let environment = Arc::new(FakeEnvironment::default());
    let telemetry = runtime(environment.clone(), Arc::new(FakeTransport::new(None)));
    assert_eq!(telemetry.vrcx_origin(), TelemetryVrcxOrigin::Fresh);

    environment
        .legacy_vrcx_detected
        .store(true, Ordering::Release);
    assert_eq!(telemetry.vrcx_origin(), TelemetryVrcxOrigin::VrcxDetected);

    environment.set("VRCX_lastVRCXVersion", "2025.12.01");
    assert_eq!(telemetry.vrcx_origin(), TelemetryVrcxOrigin::Migrated);

    let environment = Arc::new(FakeEnvironment::default());
    environment.set("VRCX_id", "legacy-install");
    let telemetry = runtime(environment, Arc::new(FakeTransport::new(None)));
    assert_eq!(telemetry.vrcx_origin(), TelemetryVrcxOrigin::Migrated);
}

fn instant_past_epoch_safe(headroom: Duration) -> Instant {
    Instant::now() + headroom
}

#[test]
fn local_weekday_uses_sunday_zero() {
    assert_eq!(local_weekday_number(Weekday::Sun), 0);
    assert_eq!(local_weekday_number(Weekday::Mon), 1);
    assert_eq!(local_weekday_number(Weekday::Sat), 6);
}

#[test]
fn send_attempts_back_off_between_retries() {
    let now = instant_past_epoch_safe(SEND_RETRY_BACKOFF);
    assert!(attempt_due(None, now));
    assert!(!attempt_due(Some(now), now));
    assert!(!attempt_due(
        Some(now - SEND_RETRY_BACKOFF + Duration::from_secs(1)),
        now
    ));
    assert!(attempt_due(Some(now - SEND_RETRY_BACKOFF), now));
}

#[test]
fn heartbeat_waits_for_interval_after_initial_baseline() {
    let now = instant_past_epoch_safe(HEARTBEAT_INTERVAL);
    assert!(!is_heartbeat_due(None, now));
    assert!(!is_heartbeat_due(Some(now), now));
    assert!(!is_heartbeat_due(
        Some(now - HEARTBEAT_INTERVAL + Duration::from_secs(1)),
        now
    ));
    assert!(is_heartbeat_due(Some(now - HEARTBEAT_INTERVAL), now));
}

#[test]
fn theme_mode_category_resolves_system_without_unknown() {
    assert_eq!(theme_mode_category("dark", ""), "dark");
    assert_eq!(theme_mode_category("midnight", ""), "dark");
    assert_eq!(theme_mode_category("light", ""), "light");
    assert_eq!(theme_mode_category("system", "dark"), "dark");
    assert_eq!(theme_mode_category("system", "light"), "light");
    assert_eq!(theme_mode_category("system", ""), "light");
    assert_eq!(theme_mode_category("other", ""), "unknown");
}

#[test]
fn helpers_normalize_config_and_dimension_values() {
    assert_eq!(normalize_enum_value(" On Demand "), "on_demand");
    assert_eq!(normalize_enum_value(""), "unknown");
    assert_eq!(normalize_locale("zh_CN"), "zh-CN");
    assert_eq!(normalize_app_version(""), "unknown");
}

#[tokio::test]
async fn feedback_includes_the_full_beta_app_version() {
    let environment = Arc::new(FakeEnvironment::default());
    let transport = Arc::new(FakeTransport::new(None));
    let runtime = runtime_with_version(environment, transport.clone(), "2.3.0-beta.12");

    runtime.submit_feedback("Beta feedback").await.unwrap();

    let payloads = transport.payloads.lock().unwrap();
    assert_eq!(payloads.len(), 1);
    assert_eq!(payloads[0].0, "/api/v1/telemetry/feedback");
    assert_eq!(payloads[0].1["appVersion"], "2.3.0-beta.12");
}

#[test]
fn cursor_acknowledgement_only_clears_the_matching_snapshot() {
    let mut pending = Some("2026-07-13T10:00:00Z".to_string());
    clear_committed_error_cursor(&mut pending, "2026-07-13T09:00:00Z");
    assert_eq!(pending.as_deref(), Some("2026-07-13T10:00:00Z"));
    clear_committed_error_cursor(&mut pending, "2026-07-13T10:00:00Z");
    assert!(pending.is_none());
}

#[tokio::test]
async fn client_error_flush_retries_before_advancing_versioned_log_cursor() {
    let environment = Arc::new(FakeEnvironment::default());
    environment.set(
        TELEMETRY_CLIENT_ERROR_CURSOR_CONFIG_KEY,
        "2026-06-30T00:00:00.000Z",
    );
    *environment.errors.lock().unwrap() = (1..=21)
        .map(|day| TelemetryClientErrorInput {
            ts_iso: format!("2026-07-{day:02}T00:00:00.000Z"),
            app_version: Some(if day == 1 { "2.0.0" } else { "2.1.0" }.into()),
            source: "rust:tracing".into(),
            fingerprint_message: format!("release failure {day}"),
            telemetry_message: format!("release failure {day}"),
        })
        .collect();
    let transport = Arc::new(FakeTransport::new(Some(2)));
    let runtime = runtime(environment.clone(), transport.clone());
    let session = TelemetrySession {
        install_id: "install".into(),
        session_id: "session".into(),
        is_new_install: false,
    };

    runtime.drain_rust_errors();
    runtime.flush_collectors_locked(&session).await;
    assert_eq!(
        environment
            .get_string(TELEMETRY_CLIENT_ERROR_CURSOR_CONFIG_KEY, "")
            .unwrap(),
        "2026-06-30T00:00:00.000Z"
    );
    assert_eq!(transport.attempts.load(Ordering::SeqCst), 2);

    runtime.flush_collectors_locked(&session).await;
    assert_eq!(transport.attempts.load(Ordering::SeqCst), 4);
    assert_eq!(
        environment
            .get_string(TELEMETRY_CLIENT_ERROR_CURSOR_CONFIG_KEY, "")
            .unwrap(),
        "2026-07-21T00:00:00.000Z"
    );
    assert!(runtime
        .inner
        .state
        .lock()
        .unwrap()
        .pending_error_cursor
        .is_none());
}

#[tokio::test]
async fn immediate_rust_error_flush_only_sends_sanitized_client_errors() {
    let environment = Arc::new(FakeEnvironment::default());
    environment
        .errors
        .lock()
        .unwrap()
        .push(TelemetryClientErrorInput {
            ts_iso: "2026-07-01T00:00:00.000Z".into(),
            app_version: Some("2.2.0-beta.3".into()),
            source: "rust:tracing".into(),
            fingerprint_message:
                "database upgrade failed: C:\\Users\\alice\\AppData\\secret.sqlite3".into(),
            telemetry_message: "database upgrade failed: C:\\Users\\alice\\AppData\\secret.sqlite3"
                .into(),
        });
    let transport = Arc::new(FakeTransport::new(None));
    let runtime = runtime(environment.clone(), transport.clone());

    runtime.flush_pending_rust_errors().await;

    let payloads = transport.payloads.lock().unwrap();
    assert_eq!(payloads.len(), 1);
    assert_eq!(payloads[0].0, "/api/v1/telemetry/client-error");
    let encoded = payloads[0].1.to_string();
    assert!(encoded.contains("database upgrade failed"));
    assert!(encoded.contains("2.2.0-beta.3"));
    assert!(!encoded.contains("alice"));
    assert!(!encoded.contains("secret.sqlite3"));
    assert_eq!(
        environment
            .get_string(TELEMETRY_CLIENT_ERROR_CURSOR_CONFIG_KEY, "")
            .unwrap(),
        "2026-07-01T00:00:00.000Z"
    );
}

#[tokio::test]
async fn immediate_rust_error_flush_fails_closed_when_consent_is_unavailable() {
    let environment = Arc::new(FakeEnvironment::default());
    environment.unavailable.store(true, Ordering::Release);
    let transport = Arc::new(FakeTransport::new(None));
    let runtime = runtime(environment, transport.clone());

    runtime.flush_pending_rust_errors().await;

    assert_eq!(transport.attempts.load(Ordering::SeqCst), 0);
}
