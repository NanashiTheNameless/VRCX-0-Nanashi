use serde::{Deserialize, Serialize};
use specta::Type;

use crate::IntegrationApiError;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum IntegrationApiStartFailureReason {
    PortInUse,
    Bind,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationApiStartFailedPayload {
    pub port: u16,
    pub reason: IntegrationApiStartFailureReason,
}

impl IntegrationApiStartFailedPayload {
    pub fn from_error(error: &IntegrationApiError, fallback_port: u16) -> Self {
        match error {
            IntegrationApiError::PortInUse { port } => Self {
                port: *port,
                reason: IntegrationApiStartFailureReason::PortInUse,
            },
            IntegrationApiError::Bind { port, .. } => Self {
                port: *port,
                reason: IntegrationApiStartFailureReason::Bind,
            },
            _ => Self {
                port: fallback_port,
                reason: IntegrationApiStartFailureReason::Bind,
            },
        }
    }
}

vrcx_0_runtime_event::runtime_event_payload!(
    IntegrationApiStartFailedPayload,
    "integrationApiStartFailed"
);
