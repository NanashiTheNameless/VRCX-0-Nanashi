use serde::Serialize;

pub trait RuntimeEventPayload: Serialize + specta::Type {
    const EVENT_NAME: &'static str;
}

#[macro_export]
macro_rules! runtime_event_payload {
    ($payload:ty, $event:literal) => {
        impl $crate::RuntimeEventPayload for $payload {
            const EVENT_NAME: &'static str = $event;
        }
    };
}

runtime_event_payload!(
    vrcx_0_core::realtime::RealtimeWsStatusPayload,
    "realtimeWsStatus"
);
runtime_event_payload!(
    vrcx_0_core::screenshots::ScreenshotLibraryScanStatus,
    "screenshotLibraryScanStatus"
);
runtime_event_payload!(
    vrcx_0_core::screenshots::ScreenshotExportProgress,
    "screenshotExportProgress"
);
