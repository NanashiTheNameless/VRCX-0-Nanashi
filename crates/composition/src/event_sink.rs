use vrcx_0_application_core::RuntimeEventSink;

pub struct RuntimeHostEventSink<S> {
    inner: S,
}

impl<S> RuntimeHostEventSink<S> {
    pub fn new(inner: S) -> Self {
        Self { inner }
    }
}

impl<S> RuntimeEventSink for RuntimeHostEventSink<S>
where
    S: RuntimeEventSink,
{
    fn emit(&self, event: &str, payload: serde_json::Value) {
        self.inner.emit(event, payload);
    }
}
