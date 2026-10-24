use vrcx_0_core::game_log_parser::{convert_log_time_to_epoch, GameLogEvent, GameLogEventKind};

pub(crate) trait GameLogParseSink {
    fn push(&mut self, event: GameLogEvent);

    fn set_vrc_closed_gracefully(&mut self, value: bool);

    fn push_event(&mut self, file_name: &str, line: &str, kind: GameLogEventKind) {
        self.push(GameLogEvent {
            file_name: file_name.to_string(),
            created_at: convert_log_time_to_epoch(line),
            kind,
        });
    }
}
