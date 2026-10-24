//! Absolute dates cross every boundary as signed Unix epoch seconds (UTC).
//! These serde helpers also read the forms older versions wrote (ISO text,
//! epoch milliseconds), for values that come back from stored JSON or from an
//! older peer.

use serde::{Deserialize, Deserializer};
use serde_json::Value;
use vrcx_0_core::time::epoch_from_json;

pub use vrcx_0_core::time::EpochSeconds;

/// A required date. Unreadable or missing values become 0.
pub fn de<'de, D: Deserializer<'de>>(deserializer: D) -> Result<EpochSeconds, D::Error> {
    Ok(epoch_from_json(&Value::deserialize(deserializer)?).unwrap_or(0))
}

/// An optional date. Null, empty text and unreadable values become `None`.
pub fn de_opt<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<EpochSeconds>, D::Error> {
    Ok(epoch_from_json(&Value::deserialize(deserializer)?))
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Stored {
        #[serde(deserialize_with = "super::de")]
        at: i64,
        #[serde(default, deserialize_with = "super::de_opt")]
        until: Option<i64>,
    }

    #[test]
    fn reads_seconds_milliseconds_and_iso_text() {
        for text in [
            r#"{"at": 1784629815}"#,
            r#"{"at": 1784629815250}"#,
            r#"{"at": "2026-07-21T10:30:15.250Z"}"#,
        ] {
            let stored: Stored = serde_json::from_str(text).unwrap();
            assert_eq!(stored.at, 1784629815, "{text}");
            assert_eq!(stored.until, None);
        }
        let stored: Stored =
            serde_json::from_str(r#"{"at": "", "until": "2026-07-21T10:30:15Z"}"#).unwrap();
        assert_eq!(stored.at, 0);
        assert_eq!(stored.until, Some(1784629815));
    }
}
