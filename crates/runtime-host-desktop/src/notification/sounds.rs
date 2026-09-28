//! Fork: custom sound per notification event type.
//!
//! Config key `notificationSounds` (JSON):
//! `{ "version": 1, "rules": { "<activityType>[@friend|@favorite]": { "enabled": true, "path": "...", "volume": 0.8 } } }`
//! The most specific rule for the actor wins: `@favorite`, then `@friend`,
//! then the plain type (anyone). Plays in the backend so it also works in
//! background mode, independent of the desktop/VR/TTS channels.

use std::collections::HashMap;
use std::path::PathBuf;

use serde::Deserialize;
use vrcx_0_application_activity::{OverlayActivityActorRelation, OverlayActivityEntry};
use vrcx_0_persistence::config::ConfigRepository;

pub const NOTIFICATION_SOUNDS_CONFIG_KEY: &str = "notificationSounds";

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NotificationSoundRule {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub path: String,
    #[serde(default = "default_volume")]
    pub volume: f32,
}

fn default_enabled() -> bool {
    true
}

fn default_volume() -> f32 {
    0.8
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct NotificationSoundConfig {
    #[serde(default)]
    pub rules: HashMap<String, NotificationSoundRule>,
}

impl NotificationSoundConfig {
    pub fn parse(raw: &str) -> Self {
        serde_json::from_str(raw).unwrap_or_default()
    }

    /// Sound file and volume for this entry, if a matching enabled rule exists.
    pub fn resolve(&self, entry: &OverlayActivityEntry) -> Option<(PathBuf, f32)> {
        let activity_type = entry.activity_type.as_str();
        let mut candidates = Vec::with_capacity(3);
        match entry.actor_relation {
            OverlayActivityActorRelation::Favorite => {
                candidates.push(format!("{activity_type}@favorite"));
                candidates.push(format!("{activity_type}@friend"));
            }
            OverlayActivityActorRelation::Friend => {
                candidates.push(format!("{activity_type}@friend"));
            }
            OverlayActivityActorRelation::None => {}
        }
        candidates.push(activity_type.to_string());
        candidates.iter().find_map(|key| {
            let rule = self.rules.get(key)?;
            let path = rule.path.trim();
            (rule.enabled && !path.is_empty()).then(|| (PathBuf::from(path), rule.volume))
        })
    }
}

pub fn load_notification_sounds(config: &ConfigRepository) -> NotificationSoundConfig {
    config
        .get_string(NOTIFICATION_SOUNDS_CONFIG_KEY, "")
        .map(|raw| NotificationSoundConfig::parse(&raw))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(activity_type: &str, relation: OverlayActivityActorRelation) -> OverlayActivityEntry {
        OverlayActivityEntry {
            sequence: 1,
            source_id: "s".into(),
            activity_type: activity_type.into(),
            category: Default::default(),
            created_at: String::new(),
            actor_user_id: "usr_a".into(),
            actor_display_name: "Ada".into(),
            content: Default::default(),
            actor_relation: relation,
            payload: Default::default(),
        }
    }

    #[test]
    fn most_specific_enabled_rule_wins() {
        let config = NotificationSoundConfig::parse(
            r#"{"version":1,"rules":{
                "OnPlayerJoined":{"path":"/s/any.wav","volume":0.5},
                "OnPlayerJoined@friend":{"path":"/s/friend.wav"},
                "OnPlayerJoined@favorite":{"path":"/s/fav.wav","enabled":false},
                "Online":{"path":"  "}
            }}"#,
        );
        let resolve = |kind, relation| {
            config
                .resolve(&entry(kind, relation))
                .map(|(path, volume)| (path.to_string_lossy().into_owned(), volume))
        };
        assert_eq!(
            resolve("OnPlayerJoined", OverlayActivityActorRelation::None),
            Some(("/s/any.wav".into(), 0.5))
        );
        assert_eq!(
            resolve("OnPlayerJoined", OverlayActivityActorRelation::Friend),
            Some(("/s/friend.wav".into(), 0.8))
        );
        // Favorite rule disabled -> falls back to the friend rule.
        assert_eq!(
            resolve("OnPlayerJoined", OverlayActivityActorRelation::Favorite),
            Some(("/s/friend.wav".into(), 0.8))
        );
        assert_eq!(resolve("Online", OverlayActivityActorRelation::None), None);
        assert_eq!(resolve("GPS", OverlayActivityActorRelation::None), None);
        assert_eq!(
            NotificationSoundConfig::parse("not json"),
            NotificationSoundConfig::default()
        );
    }
}
