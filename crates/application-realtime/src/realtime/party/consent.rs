//! Who has agreed to receive invites they did not ask for.
//!
//! Consent is only ever granted by a VRChat boop, whose sender VRChat
//! authenticates, carrying the emoji the host currently shows. A boop with
//! Stop removes everything for that sender at once. Every grant remembers its
//! emoji, so rotating the emoji resets everyone who used the old one.

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

use super::config::{Party, PartyRole, STOP_EMOJI_ID};

const MAX_CONSENT_ENTRIES: usize = 500;
const SECONDS_PER_HOUR: i64 = 60 * 60;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Grant {
    pub at: i64,
    pub emoji: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ConsentEntry {
    pub follow: Option<Grant>,
    pub parties: BTreeMap<String, Grant>,
    pub last_invite_at: Option<i64>,
}

impl ConsentEntry {
    fn is_empty(&self) -> bool {
        self.follow.is_none() && self.parties.is_empty()
    }

    fn latest_at(&self) -> i64 {
        self.follow
            .iter()
            .map(|grant| grant.at)
            .chain(self.parties.values().map(|grant| grant.at))
            .chain(self.last_invite_at)
            .max()
            .unwrap_or(0)
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ConsentBook {
    entries: BTreeMap<String, ConsentEntry>,
}

pub struct BoopInput<'a> {
    pub sender_user_id: &'a str,
    pub emoji_id: &'a str,
    pub now: i64,
    /// The host's follow link consent emoji, only while a follow link rule is
    /// enabled.
    pub follow_emoji: Option<&'a str>,
    pub parties: &'a [Party],
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BoopEffect {
    pub revoked: bool,
    pub granted_follow: bool,
    pub granted_parties: Vec<String>,
}

impl BoopEffect {
    pub fn granted_anything(&self) -> bool {
        self.granted_follow || !self.granted_parties.is_empty()
    }
}

impl ConsentBook {
    pub fn from_json(value: &Value) -> Self {
        let mut entries = BTreeMap::new();
        for (user_id, entry) in value.as_object().into_iter().flatten() {
            if !user_id.starts_with("usr_") {
                continue;
            }
            let follow = entry.get("follow").and_then(grant_from_json);
            let parties = entry
                .get("parties")
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
                .filter_map(|(party_id, grant)| {
                    grant_from_json(grant).map(|grant| (party_id.clone(), grant))
                })
                .collect();
            let entry = ConsentEntry {
                follow,
                parties,
                last_invite_at: entry.get("lastInviteAt").and_then(Value::as_i64),
            };
            if !entry.is_empty() {
                entries.insert(user_id.clone(), entry);
            }
        }
        Self { entries }
    }

    pub fn to_json(&self) -> Value {
        let mut object = Map::new();
        for (user_id, entry) in &self.entries {
            let mut value = json!({
                "parties": entry
                    .parties
                    .iter()
                    .map(|(party_id, grant)| (party_id.clone(), grant_to_json(grant)))
                    .collect::<Map<String, Value>>(),
            });
            if let Some(follow) = &entry.follow {
                value["follow"] = grant_to_json(follow);
            }
            if let Some(last_invite_at) = entry.last_invite_at {
                value["lastInviteAt"] = Value::from(last_invite_at);
            }
            object.insert(user_id.clone(), value);
        }
        Value::Object(object)
    }

    pub fn apply_boop(&mut self, input: BoopInput<'_>) -> BoopEffect {
        let sender = input.sender_user_id.trim();
        let emoji = input.emoji_id.trim();
        let mut effect = BoopEffect::default();
        if !sender.starts_with("usr_") || emoji.is_empty() {
            return effect;
        }
        if emoji == STOP_EMOJI_ID {
            effect.revoked = self.entries.remove(sender).is_some();
            return effect;
        }
        let grant = Grant {
            at: input.now,
            emoji: emoji.to_string(),
        };
        let mut entry = self.entries.get(sender).cloned().unwrap_or_default();
        if input.follow_emoji.map(str::trim) == Some(emoji) {
            entry.follow = Some(grant.clone());
            effect.granted_follow = true;
        }
        for party in input.parties {
            if party.emoji == emoji && party.member(sender).is_some() {
                entry.parties.insert(party.id.clone(), grant.clone());
                effect.granted_parties.push(party.id.clone());
            }
        }
        if effect.granted_anything() {
            self.entries.insert(sender.to_string(), entry);
            self.trim();
        }
        effect
    }

    pub fn follow_consent_valid(
        &self,
        user_id: &str,
        current_emoji: Option<&str>,
        now: i64,
        hours: i64,
    ) -> bool {
        let Some(entry) = self.entries.get(user_id.trim()) else {
            return false;
        };
        let Some(grant) = &entry.follow else {
            return false;
        };
        current_emoji.map(str::trim) == Some(grant.emoji.as_str())
            && not_expired(grant, entry.last_invite_at, now, hours)
    }

    /// A member's confirmation lasts until Stop or removal; a guest's
    /// consent to unasked invites also expires.
    pub fn party_consent_valid(&self, party: &Party, user_id: &str, now: i64, hours: i64) -> bool {
        let user_id = user_id.trim();
        let Some(member) = party.member(user_id) else {
            return false;
        };
        let Some(entry) = self.entries.get(user_id) else {
            return false;
        };
        let Some(grant) = entry.parties.get(&party.id) else {
            return false;
        };
        if grant.emoji != party.emoji {
            return false;
        }
        match member.role {
            PartyRole::Member => true,
            PartyRole::Guest => not_expired(grant, entry.last_invite_at, now, hours),
        }
    }

    pub fn record_invite(&mut self, user_id: &str, now: i64) {
        if let Some(entry) = self.entries.get_mut(user_id.trim()) {
            entry.last_invite_at = Some(now);
        }
    }

    pub fn user_ids(&self) -> impl Iterator<Item = &str> {
        self.entries.keys().map(String::as_str)
    }

    fn trim(&mut self) {
        while self.entries.len() > MAX_CONSENT_ENTRIES {
            let Some(oldest) = self
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.latest_at())
                .map(|(user_id, _)| user_id.clone())
            else {
                return;
            };
            self.entries.remove(&oldest);
        }
    }
}

fn not_expired(grant: &Grant, last_invite_at: Option<i64>, now: i64, hours: i64) -> bool {
    let last_activity = last_invite_at.map_or(grant.at, |at| at.max(grant.at));
    now.saturating_sub(last_activity) < hours.saturating_mul(SECONDS_PER_HOUR)
}

fn grant_from_json(value: &Value) -> Option<Grant> {
    Some(Grant {
        at: value.get("at")?.as_i64()?,
        emoji: value.get("emoji")?.as_str()?.trim().to_string(),
    })
    .filter(|grant| !grant.emoji.is_empty())
}

fn grant_to_json(grant: &Grant) -> Value {
    json!({ "at": grant.at, "emoji": grant.emoji })
}

#[cfg(test)]
mod tests {
    use super::super::config::{FollowMode, PartyMember};
    use super::*;

    const HOUR: i64 = SECONDS_PER_HOUR;

    fn party() -> Party {
        Party {
            id: "p1".into(),
            emoji: "default_fire".into(),
            follow_mode: FollowMode::Anyone,
            leader_user_id: None,
            auto_launch: false,
            members: vec![
                PartyMember {
                    user_id: "usr_member".into(),
                    role: PartyRole::Member,
                },
                PartyMember {
                    user_id: "usr_guest".into(),
                    role: PartyRole::Guest,
                },
            ],
        }
    }

    fn boop<'a>(
        sender: &'a str,
        emoji: &'a str,
        now: i64,
        follow_emoji: Option<&'a str>,
        parties: &'a [Party],
    ) -> BoopInput<'a> {
        BoopInput {
            sender_user_id: sender,
            emoji_id: emoji,
            now,
            follow_emoji,
            parties,
        }
    }

    #[test]
    fn matching_boop_grants_and_other_emojis_do_nothing() {
        let parties = [party()];
        let mut book = ConsentBook::default();

        let effect = book.apply_boop(boop(
            "usr_guest",
            "default_go",
            100,
            Some("default_wow"),
            &parties,
        ));
        assert_eq!(effect, BoopEffect::default());

        let effect = book.apply_boop(boop(
            "usr_guest",
            "default_fire",
            100,
            Some("default_wow"),
            &parties,
        ));
        assert_eq!(effect.granted_parties, vec!["p1".to_string()]);
        assert!(!effect.granted_follow);
        assert!(book.party_consent_valid(&parties[0], "usr_guest", 100, 24));

        let effect = book.apply_boop(boop(
            "usr_stranger",
            "default_wow",
            100,
            Some("default_wow"),
            &parties,
        ));
        assert!(effect.granted_follow);
        assert!(book.follow_consent_valid("usr_stranger", Some("default_wow"), 100, 24));
    }

    #[test]
    fn party_emoji_from_someone_outside_the_roster_grants_nothing() {
        let parties = [party()];
        let mut book = ConsentBook::default();
        let effect = book.apply_boop(boop("usr_other", "default_fire", 1, None, &parties));
        assert!(!effect.granted_anything());
        assert!(book.user_ids().next().is_none());
    }

    #[test]
    fn follow_emoji_only_counts_while_follow_links_are_on() {
        let mut book = ConsentBook::default();
        let effect = book.apply_boop(boop("usr_a", "default_wow", 1, None, &[]));
        assert!(!effect.granted_follow);
        assert!(!book.follow_consent_valid("usr_a", Some("default_wow"), 1, 24));
    }

    #[test]
    fn stop_always_cancels_everything_for_that_sender_only() {
        let parties = [party()];
        let mut book = ConsentBook::default();
        book.apply_boop(boop(
            "usr_guest",
            "default_fire",
            1,
            Some("default_fire"),
            &parties,
        ));
        book.apply_boop(boop("usr_member", "default_fire", 1, None, &parties));
        assert!(book.follow_consent_valid("usr_guest", Some("default_fire"), 2, 24));

        let effect = book.apply_boop(boop("usr_guest", STOP_EMOJI_ID, 2, None, &parties));
        assert!(effect.revoked);
        assert!(!book.follow_consent_valid("usr_guest", Some("default_fire"), 2, 24));
        assert!(!book.party_consent_valid(&parties[0], "usr_guest", 2, 24));
        assert!(book.party_consent_valid(&parties[0], "usr_member", 2, 24));

        let effect = book.apply_boop(boop("usr_nobody", STOP_EMOJI_ID, 2, None, &parties));
        assert!(!effect.revoked);

        let effect = book.apply_boop(boop("usr_guest", "default_fire", 3, None, &parties));
        assert_eq!(effect.granted_parties, vec!["p1".to_string()]);
        assert!(book.party_consent_valid(&parties[0], "usr_guest", 3, 24));
    }

    #[test]
    fn guest_and_follow_consent_expire_without_invites_but_members_do_not() {
        let parties = [party()];
        let mut book = ConsentBook::default();
        book.apply_boop(boop(
            "usr_guest",
            "default_fire",
            0,
            Some("default_fire"),
            &parties,
        ));
        book.apply_boop(boop("usr_member", "default_fire", 0, None, &parties));

        assert!(book.party_consent_valid(&parties[0], "usr_guest", 24 * HOUR - 1, 24));
        assert!(!book.party_consent_valid(&parties[0], "usr_guest", 24 * HOUR, 24));
        assert!(!book.follow_consent_valid("usr_guest", Some("default_fire"), 24 * HOUR, 24));
        assert!(book.party_consent_valid(&parties[0], "usr_member", 1000 * HOUR, 24));

        book.record_invite("usr_guest", 20 * HOUR);
        assert!(book.party_consent_valid(&parties[0], "usr_guest", 43 * HOUR, 24));
        assert!(book.follow_consent_valid("usr_guest", Some("default_fire"), 43 * HOUR, 24));
    }

    #[test]
    fn rotating_an_emoji_resets_consent() {
        let parties = [party()];
        let mut book = ConsentBook::default();
        book.apply_boop(boop(
            "usr_member",
            "default_fire",
            0,
            Some("default_fire"),
            &parties,
        ));
        assert!(!book.follow_consent_valid("usr_member", Some("default_go"), 1, 24));

        let mut rotated = party();
        rotated.emoji = "default_go".into();
        assert!(!book.party_consent_valid(&rotated, "usr_member", 1, 24));
    }

    #[test]
    fn round_trips_through_json_and_ignores_garbage() {
        let parties = [party()];
        let mut book = ConsentBook::default();
        book.apply_boop(boop(
            "usr_guest",
            "default_fire",
            5,
            Some("default_fire"),
            &parties,
        ));
        book.record_invite("usr_guest", 9);
        let restored = ConsentBook::from_json(&book.to_json());
        assert_eq!(restored, book);

        let garbage = ConsentBook::from_json(&json!({
            "not_a_user": {"follow": {"at": 1, "emoji": "default_go"}},
            "usr_x": {"follow": {"at": "1", "emoji": "default_go"}},
            "usr_y": 5
        }));
        assert_eq!(garbage, ConsentBook::default());
    }

    #[test]
    fn keeps_a_bounded_number_of_entries() {
        let mut book = ConsentBook::default();
        for index in 0..(MAX_CONSENT_ENTRIES + 5) {
            let user = format!("usr_{index}");
            book.apply_boop(boop(
                &user,
                "default_go",
                index as i64,
                Some("default_go"),
                &[],
            ));
        }
        assert_eq!(book.user_ids().count(), MAX_CONSENT_ENTRIES);
        assert!(!book.follow_consent_valid("usr_0", Some("default_go"), 10, 24));
    }
}
