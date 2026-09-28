use futures_util::future::BoxFuture;

use std::sync::Arc;
use std::time::Duration;

use vrcx_0_application_core::vrchat_api::{VrchatApiRequest, VrchatApiResponse, VrchatScope};
use vrcx_0_application_core::{
    is_remote_mutation_request, AuthenticatedMutationContext, RemoteMutationGate, Result,
    RuntimeAuthScope,
};

const VRCHAT_REMOTE_MUTATION_INTERVAL: Duration = Duration::from_millis(250);

pub type VrchatApiFuture<'a> = BoxFuture<'a, Result<VrchatApiResponse>>;
pub type VrchatRequestFuture<'a> = BoxFuture<'a, Result<VrchatApiResponse>>;

pub trait VrchatRequestPort: Send + Sync {
    fn send(&self, input: VrchatApiRequest, scope: VrchatScope) -> VrchatRequestFuture<'_>;
}

#[cfg(test)]
pub(crate) struct TestVrchatRequestPort;

#[cfg(test)]
impl VrchatRequestPort for TestVrchatRequestPort {
    fn send(&self, _input: VrchatApiRequest, _scope: VrchatScope) -> VrchatRequestFuture<'_> {
        Box::pin(async {
            Ok(VrchatApiResponse {
                status: 200,
                data: "{}".into(),
            })
        })
    }
}

pub trait VrchatApiPort: Send + Sync {
    fn execute(
        &self,
        command: String,
        detail: String,
        input: VrchatApiRequest,
        scope: VrchatScope,
    ) -> VrchatApiFuture<'_>;
}

#[derive(Clone)]
pub struct VrchatApiRuntime {
    auth_scope: RuntimeAuthScope,
    remote_mutations: Arc<RemoteMutationGate>,
    port: Arc<dyn VrchatApiPort>,
}

impl VrchatApiRuntime {
    /// Background actions must still belong to the initiating account and policy
    /// after the mutation throttle has finished waiting.
    pub async fn execute_guarded(
        &self,
        expected: &vrcx_0_application_core::RuntimeAuthScopeSnapshot,
        input: VrchatApiRequest,
        scope: VrchatScope,
        authorized: impl Fn() -> bool,
    ) -> Result<VrchatApiResponse> {
        let denied = || {
            vrcx_0_application_core::Error::Custom(
                "Background action cancelled: account or policy changed".into(),
            )
        };
        if !self.auth_scope.snapshot().generation_matches(expected) || !authorized() {
            return Err(denied());
        }
        if !is_remote_mutation_request(&input) {
            return self
                .port
                .execute(
                    "safety".into(),
                    "Checking safety watchlists".into(),
                    input,
                    scope,
                )
                .await;
        }
        let mutation = AuthenticatedMutationContext::capture(
            &self.auth_scope,
            &self.remote_mutations,
            "Safety action",
        )?;
        if !mutation.scope().generation_matches(expected) {
            return Err(denied());
        }
        let mut input = input;
        mutation.apply_scope_to_request(&mut input);
        mutation
            .run_after_wait(VRCHAT_REMOTE_MUTATION_INTERVAL, || async {
                if !authorized() {
                    return Err(denied());
                }
                self.port
                    .execute(
                        "safety".into(),
                        "Applying an opted-in safety action".into(),
                        input,
                        scope,
                    )
                    .await
            })
            .await
    }

    pub fn new(
        auth_scope: RuntimeAuthScope,
        remote_mutations: Arc<RemoteMutationGate>,
        port: Arc<dyn VrchatApiPort>,
    ) -> Self {
        Self {
            auth_scope,
            remote_mutations,
            port,
        }
    }

    pub async fn execute(
        &self,
        command: impl Into<String>,
        detail: impl Into<String>,
        mut input: VrchatApiRequest,
        scope: VrchatScope,
    ) -> Result<VrchatApiResponse> {
        let command = command.into();
        let detail = detail.into();
        if !is_remote_mutation_request(&input) {
            return self.port.execute(command, detail, input, scope).await;
        }
        let mutation = AuthenticatedMutationContext::capture(
            &self.auth_scope,
            &self.remote_mutations,
            "VRChat mutation",
        )?;
        mutation.apply_scope_to_request(&mut input);
        mutation
            .run_after_wait(VRCHAT_REMOTE_MUTATION_INTERVAL, || {
                self.port.execute(command, detail, input, scope)
            })
            .await
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    #[derive(Default)]
    struct RecordingPort {
        requests: Mutex<Vec<VrchatApiRequest>>,
    }

    impl VrchatApiPort for RecordingPort {
        fn execute(
            &self,
            _command: String,
            _detail: String,
            input: VrchatApiRequest,
            _scope: VrchatScope,
        ) -> VrchatApiFuture<'_> {
            self.requests.lock().unwrap().push(input);
            Box::pin(async {
                Ok(VrchatApiResponse {
                    status: 200,
                    data: "{}".into(),
                })
            })
        }
    }

    #[tokio::test]
    async fn read_request_executes_without_an_authenticated_scope() {
        let port = Arc::new(RecordingPort::default());
        let runtime = VrchatApiRuntime::new(
            RuntimeAuthScope::new(),
            Arc::new(RemoteMutationGate::default()),
            port.clone(),
        );

        runtime
            .execute(
                "read",
                "read",
                VrchatApiRequest {
                    method: Some("GET".into()),
                    ..Default::default()
                },
                VrchatScope::Vrchat,
            )
            .await
            .unwrap();

        assert_eq!(port.requests.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn mutation_rejects_before_the_port_when_scope_is_inactive() {
        let port = Arc::new(RecordingPort::default());
        let runtime = VrchatApiRuntime::new(
            RuntimeAuthScope::new(),
            Arc::new(RemoteMutationGate::default()),
            port.clone(),
        );

        let error = runtime
            .execute(
                "write",
                "write",
                VrchatApiRequest {
                    method: Some("POST".into()),
                    ..Default::default()
                },
                VrchatScope::Vrchat,
            )
            .await
            .unwrap_err();

        assert_eq!(
            error.to_string(),
            "VRChat mutation requires an authenticated session."
        );
        assert!(port.requests.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn mutation_uses_the_captured_endpoint() {
        let auth_scope = RuntimeAuthScope::new();
        auth_scope.set("usr_current", "https://api.example.test/api/1");
        let port = Arc::new(RecordingPort::default());
        let runtime = VrchatApiRuntime::new(
            auth_scope,
            Arc::new(RemoteMutationGate::default()),
            port.clone(),
        );

        runtime
            .execute(
                "write",
                "write",
                VrchatApiRequest {
                    endpoint: Some("https://stale.example.test/api/1".into()),
                    method: Some("POST".into()),
                    ..Default::default()
                },
                VrchatScope::Vrchat,
            )
            .await
            .unwrap();

        assert_eq!(
            port.requests.lock().unwrap()[0].endpoint.as_deref(),
            Some("https://api.example.test/api/1")
        );
    }
    #[tokio::test]
    async fn guarded_mutation_rechecks_account_and_policy_after_throttle() {
        use std::sync::atomic::{AtomicBool, Ordering};
        for change_account in [false, true] {
            let auth = RuntimeAuthScope::new();
            auth.set("usr_current", "https://api.vrchat.cloud/api/1");
            let expected = auth.snapshot();
            let gate = Arc::new(RemoteMutationGate::default());
            gate.wait(&expected, VRCHAT_REMOTE_MUTATION_INTERVAL).await;
            let port = Arc::new(RecordingPort::default());
            let runtime = VrchatApiRuntime::new(auth.clone(), gate, port.clone());
            let allowed = AtomicBool::new(true);
            let change = async {
                tokio::time::sleep(Duration::from_millis(20)).await;
                if change_account {
                    auth.set("usr_other", "https://api.vrchat.cloud/api/1");
                } else {
                    allowed.store(false, Ordering::SeqCst);
                }
            };
            let request = VrchatApiRequest {
                method: Some("POST".into()),
                ..Default::default()
            };
            let (result, _) = tokio::join!(
                runtime.execute_guarded(&expected, request, VrchatScope::Vrchat, || allowed
                    .load(Ordering::SeqCst)),
                change
            );
            assert!(result.is_err());
            assert!(port.requests.lock().unwrap().is_empty());
        }
    }
}
