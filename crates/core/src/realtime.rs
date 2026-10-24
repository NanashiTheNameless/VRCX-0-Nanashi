use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RealtimeSessionContext {
    pub user_id: String,
    pub endpoint: String,
    pub websocket: String,
}

impl RealtimeSessionContext {
    pub fn new(user_id: String, endpoint: String, websocket: String) -> Self {
        Self {
            user_id: user_id.trim().to_string(),
            endpoint: endpoint.trim().to_string(),
            websocket: websocket.trim().to_string(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeWsMessagePayload {
    pub json: Value,
    pub raw: String,
    /// Epoch seconds.
    pub received_at: i64,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum RealtimeWsStatus {
    #[default]
    Idle,
    Connecting,
    Connected,
    Disconnected,
    Error,
    AuthFailure,
}

impl RealtimeWsStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Connecting => "connecting",
            Self::Connected => "connected",
            Self::Disconnected => "disconnected",
            Self::Error => "error",
            Self::AuthFailure => "authFailure",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeWsStatusPayload {
    pub status: RealtimeWsStatus,
    pub websocket_domain: String,
    pub at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_run_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generation: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_generation: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_code: Option<i32>,
}

#[derive(Default)]
pub struct RealtimeMessageParser {
    last_raw: Option<String>,
}

#[derive(Debug)]
pub enum RealtimeMessageParseOutcome {
    Duplicate,
    Invalid { error: serde_json::Error },
    Valid(RealtimeWsMessagePayload),
}

impl RealtimeMessageParser {
    pub fn parse_text(&mut self, raw: &str, received_at: i64) -> RealtimeMessageParseOutcome {
        if self.last_raw.as_deref() == Some(raw) {
            return RealtimeMessageParseOutcome::Duplicate;
        }

        let mut json: Value = match serde_json::from_str(raw) {
            Ok(json) => json,
            Err(error) => return RealtimeMessageParseOutcome::Invalid { error },
        };
        if let Some(content) = json
            .get("content")
            .and_then(Value::as_str)
            .map(ToString::to_string)
        {
            if let Ok(parsed_content) = serde_json::from_str::<Value>(&content) {
                if let Some(object) = json.as_object_mut() {
                    object.insert("content".to_string(), parsed_content);
                }
            }
        }

        self.last_raw = Some(raw.to_string());
        RealtimeMessageParseOutcome::Valid(RealtimeWsMessagePayload {
            json,
            raw: raw.to_string(),
            received_at,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{RealtimeMessageParseOutcome, RealtimeMessageParser};

    #[test]
    fn parses_nested_content_json_string() {
        let mut parser = RealtimeMessageParser::default();
        let RealtimeMessageParseOutcome::Valid(payload) = parser.parse_text(
            r#"{"type":"friend-online","content":"{\"userId\":\"usr_1\"}"}"#,
            1778716800,
        ) else {
            panic!("message should parse");
        };

        assert_eq!(payload.json["type"], "friend-online");
        assert_eq!(payload.json["content"]["userId"], "usr_1");
        assert_eq!(
            payload.raw,
            r#"{"type":"friend-online","content":"{\"userId\":\"usr_1\"}"}"#
        );
        assert_eq!(payload.received_at, 1778716800);
    }

    #[test]
    fn keeps_non_json_content_string() {
        let mut parser = RealtimeMessageParser::default();
        let RealtimeMessageParseOutcome::Valid(payload) =
            parser.parse_text(r#"{"type":"notification","content":"hello"}"#, 1778716800)
        else {
            panic!("message should parse");
        };

        assert_eq!(payload.json["content"], "hello");
    }

    #[test]
    fn invalid_json_returns_its_parse_error() {
        let mut parser = RealtimeMessageParser::default();

        let RealtimeMessageParseOutcome::Invalid { error } =
            parser.parse_text("not-json", 1778716800)
        else {
            panic!("invalid JSON should return its parse error");
        };

        assert_eq!(error.classify(), serde_json::error::Category::Syntax);
        assert!(matches!(
            parser.parse_text("not-json", 1778716801),
            RealtimeMessageParseOutcome::Invalid { .. }
        ));
    }

    #[test]
    fn duplicate_raw_messages_return_duplicate_outcome() {
        let mut parser = RealtimeMessageParser::default();
        let raw = r#"{"type":"friend-offline","content":{"userId":"usr_1"}}"#;

        assert!(matches!(
            parser.parse_text(raw, 1778716800),
            RealtimeMessageParseOutcome::Valid(_)
        ));
        assert!(matches!(
            parser.parse_text(raw, 1778716801),
            RealtimeMessageParseOutcome::Duplicate
        ));
    }
}
