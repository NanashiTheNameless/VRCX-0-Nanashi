use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;

use crate::RuntimeOperationStatus;

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSyncDomainSnapshot {
    pub domain: String,
    pub status: RuntimeOperationStatus,
    pub detail: String,
    pub updated_at: i64,
    pub revision: u64,
    pub pending_count: u64,
    pub failure_count: u64,
}

#[derive(Clone, Debug, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSyncSnapshot {
    pub domains: Vec<RuntimeSyncDomainSnapshot>,
}

#[derive(Clone, Default)]
pub struct RuntimeSyncEngine {
    inner: Arc<Mutex<BTreeMap<String, RuntimeSyncDomainSnapshot>>>,
}

impl RuntimeSyncEngine {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record(
        &self,
        domain: impl Into<String>,
        status: RuntimeOperationStatus,
        detail: impl Into<String>,
        pending_count: u64,
    ) {
        self.upsert(domain, status, detail, pending_count, false);
    }

    pub fn record_failure(&self, domain: impl Into<String>, detail: impl Into<String>) {
        self.upsert(domain, RuntimeOperationStatus::Error, detail, 0, true);
    }

    pub fn snapshot(&self) -> RuntimeSyncSnapshot {
        let domains = match self.inner.lock() {
            Ok(domains) => domains.values().cloned().collect(),
            Err(error) => {
                tracing::warn!("failed to lock runtime sync engine: {error}");
                Vec::new()
            }
        };
        RuntimeSyncSnapshot { domains }
    }

    fn upsert(
        &self,
        domain: impl Into<String>,
        status: RuntimeOperationStatus,
        detail: impl Into<String>,
        pending_count: u64,
        failed: bool,
    ) {
        let domain = domain.into();
        let detail = detail.into();
        match self.inner.lock() {
            Ok(mut domains) => {
                let entry =
                    domains
                        .entry(domain.clone())
                        .or_insert_with(|| RuntimeSyncDomainSnapshot {
                            domain,
                            status: RuntimeOperationStatus::Pending,
                            detail: String::new(),
                            updated_at: 0,
                            revision: 0,
                            pending_count: 0,
                            failure_count: 0,
                        });
                entry.status = status;
                entry.detail = detail;
                entry.updated_at = vrcx_0_core::time::now_epoch();
                entry.revision = entry.revision.saturating_add(1);
                entry.pending_count = pending_count;
                if failed {
                    entry.failure_count = entry.failure_count.saturating_add(1);
                }
            }
            Err(error) => tracing::warn!("failed to lock runtime sync engine: {error}"),
        }
    }
}
