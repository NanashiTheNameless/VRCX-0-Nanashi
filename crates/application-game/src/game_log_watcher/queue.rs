use vrcx_0_core::game_log_parser::GameLogEvent;

use crate::game_log_parser::GameLogParseSink;

use super::sink::GameLogEventOrigin;
use super::watcher::Inner;

pub(super) struct WatcherParseSink<'a> {
    pub(super) inner: &'a Inner,
}

impl GameLogParseSink for WatcherParseSink<'_> {
    fn push(&mut self, event: GameLogEvent) {
        if self.inner.event_sink.is_some() {
            self.inner.event_buffer.lock().unwrap().push(event);
        }
    }

    fn set_vrc_closed_gracefully(&mut self, value: bool) {
        *self.inner.vrc_closed_gracefully.lock().unwrap() = value;
    }
}

pub(super) fn flush_game_log_events(inner: &Inner, first_run: bool) {
    let Some(event_sink) = &inner.event_sink else {
        return;
    };

    let events = {
        let mut buffer = inner.event_buffer.lock().unwrap();
        if buffer.is_empty() {
            return;
        }
        std::mem::take(&mut *buffer)
    };

    let origin = if first_run {
        GameLogEventOrigin::InitialScan
    } else {
        GameLogEventOrigin::Live
    };
    if let Err(error) = event_sink.ingest_game_log_events_with_origin(&events, origin) {
        tracing::warn!("failed to ingest GameLog event batch in runtime: {error}");
    }
}
