use std::collections::HashSet;

use serde_json::Value;

pub const PARTY_GROUPS_CONFIG_KEY: &str = "partyGroups";
pub const CONSENT_EMOJI_CONFIG_KEY: &str = "autoInviteConsentEmoji";
pub const CONSENT_BOOP_BACK_CONFIG_KEY: &str = "autoInviteConsentBoopBack";
pub const CONSENT_HOURS_CONFIG_KEY: &str = "autoInviteConsentHours";
pub const CONSENT_STATE_CONFIG_KEY: &str = "autoInviteConsents";

pub const STOP_EMOJI_ID: &str = "default_stop";
pub const BOOP_BACK_EMOJI_ID: &str = "default_thumbs_up";
pub const DEFAULT_CONSENT_HOURS: i64 = 24;
const MIN_CONSENT_HOURS: i64 = 1;
const MAX_CONSENT_HOURS: i64 = 168;
const MAX_PARTIES: usize = 16;
const MAX_PARTY_MEMBERS: usize = 32;

/// Permanent VRChat default emojis that may be picked as a consent emoji.
/// Seasonal emojis can disappear, everyday boops (wave, smile, heart, thumbs
/// up, laugh, kiss, in love, portal) would grant consent by accident, and
/// Stop is reserved for withdrawing it. Keep in step with
/// `src/shared/constants/autoInviteConsent.ts`.
pub const CONSENT_EMOJI_IDS: &[&str] = &[
    "default_angry",
    "default_blushing",
    "default_crying",
    "default_frown",
    "default_stoic",
    "default_sunglasses",
    "default_thinking",
    "default_thumbs_down",
    "default_tongue_out",
    "default_wow",
    "default_arrow_point",
    "default_hourglass",
    "default_keyboard",
    "default_cloud",
    "default_fire",
    "default_money",
    "default_broken_heart",
    "default_exclamation",
    "default_go",
    "default_music_note",
    "default_question",
    "default_zzz",
    "default_beer",
    "default_pizza",
    "default_tomato",
    "default_gift",
    "default_life_ring",
];

pub fn is_consent_emoji(emoji_id: &str) -> bool {
    let emoji_id = emoji_id.trim();
    emoji_id != STOP_EMOJI_ID && CONSENT_EMOJI_IDS.contains(&emoji_id)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FollowMode {
    Leader,
    Anyone,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PartyRole {
    /// Has the app and is followed automatically.
    Member,
    /// May not have the app: their request invites are answered, and they
    /// get invites unasked only after opting in with the party emoji.
    Guest,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PartyMember {
    pub user_id: String,
    pub role: PartyRole,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Party {
    pub id: String,
    pub emoji: String,
    pub follow_mode: FollowMode,
    pub leader_user_id: Option<String>,
    pub auto_launch: bool,
    pub members: Vec<PartyMember>,
}

impl Party {
    pub fn member(&self, user_id: &str) -> Option<&PartyMember> {
        let user_id = user_id.trim();
        self.members.iter().find(|member| member.user_id == user_id)
    }
}

fn is_user_id(value: &str) -> bool {
    value.starts_with("usr_") && value.len() > 4 && !value.contains(char::is_whitespace)
}

/// Enabled, well-formed parties. A party with an unknown emoji, a leader
/// mode without a valid leader, or no members is dropped, so a broken config
/// only ever does less.
pub fn parse_parties(value: &Value) -> Vec<Party> {
    let mut seen_ids = HashSet::new();
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter(|party| party.get("enabled").and_then(Value::as_bool) == Some(true))
        .filter_map(|party| {
            let id = party.get("id").and_then(Value::as_str)?.trim();
            let emoji = party.get("emoji").and_then(Value::as_str)?.trim();
            if id.is_empty() || !is_consent_emoji(emoji) {
                return None;
            }
            let mut member_ids = HashSet::new();
            let members: Vec<PartyMember> = party
                .get("members")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|member| {
                    let user_id = member.get("userId").and_then(Value::as_str)?.trim();
                    let role = match member.get("role").and_then(Value::as_str) {
                        Some("member") => PartyRole::Member,
                        Some("guest") => PartyRole::Guest,
                        _ => return None,
                    };
                    (is_user_id(user_id) && member_ids.insert(user_id.to_string())).then(|| {
                        PartyMember {
                            user_id: user_id.to_string(),
                            role,
                        }
                    })
                })
                .take(MAX_PARTY_MEMBERS)
                .collect();
            if members.is_empty() {
                return None;
            }
            let follow_mode = match party.get("followMode").and_then(Value::as_str) {
                Some("leader") => FollowMode::Leader,
                Some("anyone") => FollowMode::Anyone,
                _ => return None,
            };
            let leader_user_id = party
                .get("leaderUserId")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|leader| is_user_id(leader))
                .map(str::to_string);
            if follow_mode == FollowMode::Leader && leader_user_id.is_none() {
                return None;
            }
            if !seen_ids.insert(id.to_string()) {
                return None;
            }
            Some(Party {
                id: id.to_string(),
                emoji: emoji.to_string(),
                follow_mode,
                leader_user_id,
                auto_launch: party.get("autoLaunch").and_then(Value::as_bool) == Some(true),
                members,
            })
        })
        .take(MAX_PARTIES)
        .collect()
}

pub fn normalize_consent_hours(value: &Value) -> i64 {
    value
        .as_i64()
        .or_else(|| value.as_str().and_then(|text| text.trim().parse().ok()))
        .map(|hours| hours.clamp(MIN_CONSENT_HOURS, MAX_CONSENT_HOURS))
        .unwrap_or(DEFAULT_CONSENT_HOURS)
}

pub fn normalize_consent_emoji(value: &str) -> Option<String> {
    let value = value.trim();
    is_consent_emoji(value).then(|| value.to_string())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn consent_emojis_never_include_stop_or_everyday_boops() {
        for reserved in [
            STOP_EMOJI_ID,
            "default_hand_wave",
            "default_smile",
            "default_heart",
            "default_thumbs_up",
            "default_laugh",
            "default_kiss",
            "default_in_love",
            "default_snowball",
            "default_skull",
            "default_portal",
            "",
        ] {
            assert!(!is_consent_emoji(reserved), "{reserved}");
        }
        assert!(is_consent_emoji(" default_fire "));
        let unique: HashSet<_> = CONSENT_EMOJI_IDS.iter().collect();
        assert_eq!(unique.len(), CONSENT_EMOJI_IDS.len());
    }

    #[test]
    fn parses_enabled_parties_and_drops_broken_ones() {
        let parties = parse_parties(&json!([
            {
                "id": "p1", "enabled": true, "emoji": "default_fire", "followMode": "leader",
                "leaderUserId": "usr_lead", "autoLaunch": true,
                "members": [
                    {"userId": "usr_lead", "role": "member"},
                    {"userId": "usr_guest", "role": "guest"},
                    {"userId": "usr_lead", "role": "guest"},
                    {"userId": "bad", "role": "member"},
                    {"userId": "usr_x", "role": "owner"}
                ]
            },
            {"id": "off", "enabled": false, "emoji": "default_fire", "followMode": "anyone",
             "members": [{"userId": "usr_a", "role": "member"}]},
            {"id": "stop", "enabled": true, "emoji": "default_stop", "followMode": "anyone",
             "members": [{"userId": "usr_a", "role": "member"}]},
            {"id": "noleader", "enabled": true, "emoji": "default_go", "followMode": "leader",
             "members": [{"userId": "usr_a", "role": "member"}]},
            {"id": "empty", "enabled": true, "emoji": "default_go", "followMode": "anyone",
             "members": []},
            {"id": "p1", "enabled": true, "emoji": "default_go", "followMode": "anyone",
             "members": [{"userId": "usr_a", "role": "member"}]}
        ]));
        assert_eq!(
            parties,
            vec![Party {
                id: "p1".into(),
                emoji: "default_fire".into(),
                follow_mode: FollowMode::Leader,
                leader_user_id: Some("usr_lead".into()),
                auto_launch: true,
                members: vec![
                    PartyMember {
                        user_id: "usr_lead".into(),
                        role: PartyRole::Member,
                    },
                    PartyMember {
                        user_id: "usr_guest".into(),
                        role: PartyRole::Guest,
                    },
                ],
            }]
        );
    }

    #[test]
    fn consent_hours_are_clamped_with_a_default() {
        assert_eq!(normalize_consent_hours(&json!(null)), DEFAULT_CONSENT_HOURS);
        assert_eq!(
            normalize_consent_hours(&json!("abc")),
            DEFAULT_CONSENT_HOURS
        );
        assert_eq!(normalize_consent_hours(&json!(0)), 1);
        assert_eq!(normalize_consent_hours(&json!("500")), 168);
        assert_eq!(normalize_consent_hours(&json!(12)), 12);
    }
}
