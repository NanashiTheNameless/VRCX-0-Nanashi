use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;

use crate::RuntimeOperationStatus;

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePhaseSnapshot {
    pub name: String,
    pub status: RuntimeOperationStatus,
    pub detail: String,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLifecycleSnapshot {
    pub started_at: i64,
    pub host_services_started: bool,
    pub phases: Vec<RuntimePhaseSnapshot>,
}

#[derive(Default)]
struct RuntimeLifecycleState {
    host_services_started: bool,
    phases: BTreeMap<String, RuntimePhaseSnapshot>,
}

#[derive(Clone)]
pub struct RuntimeLifecycle {
    started_at: i64,
    inner: Arc<Mutex<RuntimeLifecycleState>>,
}

impl RuntimeLifecycle {
    pub fn new() -> Self {
        Self {
            started_at: vrcx_0_core::time::now_epoch(),
            inner: Arc::new(Mutex::new(RuntimeLifecycleState::default())),
        }
    }

    pub fn record_phase(
        &self,
        name: impl Into<String>,
        status: RuntimeOperationStatus,
        detail: impl Into<String>,
    ) {
        let name = name.into();
        let detail = detail.into();
        match self.inner.lock() {
            Ok(mut state) => {
                state.phases.insert(
                    name.clone(),
                    RuntimePhaseSnapshot {
                        name,
                        status,
                        detail,
                        updated_at: vrcx_0_core::time::now_epoch(),
                    },
                );
            }
            Err(error) => tracing::warn!("failed to lock runtime lifecycle: {error}"),
        }
    }

    pub fn set_host_services_started(&self, started: bool, detail: impl Into<String>) {
        match self.inner.lock() {
            Ok(mut state) => {
                state.host_services_started = started;
            }
            Err(error) => tracing::warn!("failed to lock runtime lifecycle: {error}"),
        }
        self.record_phase(
            "hostServices",
            if started {
                RuntimeOperationStatus::Completed
            } else {
                RuntimeOperationStatus::Pending
            },
            detail,
        );
    }

    pub fn snapshot(&self) -> RuntimeLifecycleSnapshot {
        match self.inner.lock() {
            Ok(state) => RuntimeLifecycleSnapshot {
                started_at: self.started_at,
                host_services_started: state.host_services_started,
                phases: state.phases.values().cloned().collect(),
            },
            Err(error) => {
                tracing::warn!("failed to lock runtime lifecycle: {error}");
                RuntimeLifecycleSnapshot {
                    started_at: self.started_at,
                    host_services_started: false,
                    phases: Vec::new(),
                }
            }
        }
    }
}

impl Default for RuntimeLifecycle {
    fn default() -> Self {
        Self::new()
    }
}
