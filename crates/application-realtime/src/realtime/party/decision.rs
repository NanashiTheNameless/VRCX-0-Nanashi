use vrcx_0_core::location::{parse_location, ParsedLocation};

use super::config::{FollowMode, Party, PartyRole};
use super::consent::ConsentBook;

/// Minimum gap between automatic follows, and after an own move, so two
/// members moving at once cannot bounce the party between instances.
pub const PARTY_FOLLOW_COOLDOWN_MS: i64 = 2 * 60 * 1000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SelfContext<'a> {
    pub user_id: &'a str,
    pub game_running: bool,
    pub location: &'a str,
    pub player_user_ids: &'a [String],
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FollowTiming {
    pub now_ms: i64,
    pub last_follow_at_ms: Option<i64>,
    pub last_own_move_at_ms: Option<i64>,
    pub consent_hours: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FollowAction {
    /// Ask VRChat to invite yourself; the in-game invite still needs a click.
    SelfInvite {
        party_id: String,
        world_id: String,
        instance_id: String,
    },
    /// The instance needs an invite; the member's app answers it.
    RequestInvite {
        party_id: String,
        user_id: String,
    },
    /// VRChat is closed and the party allows launching into the instance.
    Launch {
        party_id: String,
        location: String,
    },
    Skip(FollowSkip),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FollowSkip {
    NotFollowed,
    NotJoinable,
    AlreadyThere,
    Cooldown,
    GameNotRunning,
}

impl FollowSkip {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotFollowed => "not-followed",
            Self::NotJoinable => "not-joinable",
            Self::AlreadyThere => "already-there",
            Self::Cooldown => "cooldown",
            Self::GameNotRunning => "game-not-running",
        }
    }
}

/// A location VRChat lets you invite yourself into, subject to its own
/// checks (friendship, group membership, age gate).
pub fn is_self_joinable(parsed: &ParsedLocation) -> bool {
    parsed.is_real_instance
        && !parsed.world_id.is_empty()
        && !parsed.instance_id.is_empty()
        && matches!(
            parsed.access_type.as_str(),
            "public" | "group" | "friends" | "friends+"
        )
}

/// Decides what to do when a party member moves. Only confirmed members are
/// followed: they booped this user with the party emoji, so the party is
/// mutual. In leader mode only the leader is followed.
pub fn decide_follow(
    parties: &[Party],
    book: &ConsentBook,
    mover_user_id: &str,
    new_location: &str,
    me: &SelfContext<'_>,
    timing: &FollowTiming,
) -> FollowAction {
    let mover = mover_user_id.trim();
    let new_location = new_location.trim();
    if mover.is_empty() || mover == me.user_id.trim() {
        return FollowAction::Skip(FollowSkip::NotFollowed);
    }
    let Some(party) = parties.iter().find(|party| {
        party
            .member(mover)
            .is_some_and(|member| member.role == PartyRole::Member)
            && match party.follow_mode {
                FollowMode::Anyone => true,
                FollowMode::Leader => party.leader_user_id.as_deref() == Some(mover),
            }
            && book.party_consent_valid(party, mover, timing.now_ms / 1000, timing.consent_hours)
    }) else {
        return FollowAction::Skip(FollowSkip::NotFollowed);
    };
    let parsed = parse_location(new_location);
    if !parsed.is_real_instance || parsed.world_id.is_empty() || parsed.instance_id.is_empty() {
        return FollowAction::Skip(FollowSkip::NotJoinable);
    }
    if new_location == me.location.trim() {
        return FollowAction::Skip(FollowSkip::AlreadyThere);
    }
    let recent = |at: Option<i64>| {
        at.is_some_and(|at| timing.now_ms.saturating_sub(at) < PARTY_FOLLOW_COOLDOWN_MS)
    };
    if recent(timing.last_follow_at_ms) || recent(timing.last_own_move_at_ms) {
        return FollowAction::Skip(FollowSkip::Cooldown);
    }
    let joinable = is_self_joinable(&parsed);
    if !me.game_running {
        return if party.auto_launch && joinable {
            FollowAction::Launch {
                party_id: party.id.clone(),
                location: new_location.to_string(),
            }
        } else {
            FollowAction::Skip(FollowSkip::GameNotRunning)
        };
    }
    if joinable {
        FollowAction::SelfInvite {
            party_id: party.id.clone(),
            world_id: parsed.world_id,
            instance_id: parsed.instance_id,
        }
    } else {
        FollowAction::RequestInvite {
            party_id: party.id.clone(),
            user_id: mover.to_string(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OutboundReason {
    PartyGuest {
        party_id: String,
    },
    /// Still has to pass a follow link rule right before the invite.
    FollowLink,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OutboundCandidate {
    pub user_id: String,
    pub reason: OutboundReason,
}

/// People to invite unasked after an own move: party guests and follow link
/// users who opted in by boop and are not already here. Members are left
/// out because their own app follows. Without consent nobody is listed.
pub fn outbound_candidates(
    parties: &[Party],
    book: &ConsentBook,
    follow_emoji: Option<&str>,
    me: &SelfContext<'_>,
    now_secs: i64,
    consent_hours: i64,
) -> Vec<OutboundCandidate> {
    let me_id = me.user_id.trim();
    book.user_ids()
        .filter(|user_id| *user_id != me_id)
        .filter(|user_id| !me.player_user_ids.iter().any(|player| player == user_id))
        .filter_map(|user_id| {
            let guest_party = parties.iter().find(|party| {
                party
                    .member(user_id)
                    .is_some_and(|member| member.role == PartyRole::Guest)
                    && book.party_consent_valid(party, user_id, now_secs, consent_hours)
            });
            if let Some(party) = guest_party {
                return Some(OutboundCandidate {
                    user_id: user_id.to_string(),
                    reason: OutboundReason::PartyGuest {
                        party_id: party.id.clone(),
                    },
                });
            }
            book.follow_consent_valid(user_id, follow_emoji, now_secs, consent_hours)
                .then(|| OutboundCandidate {
                    user_id: user_id.to_string(),
                    reason: OutboundReason::FollowLink,
                })
        })
        .collect()
}

/// Whether someone who sent a request invite is on an enabled party roster.
/// Answering a request needs no consent beyond the request itself.
pub fn party_of_requester<'a>(parties: &'a [Party], user_id: &str) -> Option<&'a Party> {
    parties.iter().find(|party| party.member(user_id).is_some())
}

#[cfg(test)]
mod tests {
    use super::super::config::PartyMember;
    use super::super::consent::BoopInput;
    use super::*;

    fn party(mode: FollowMode, auto_launch: bool) -> Party {
        Party {
            id: "p1".into(),
            emoji: "default_fire".into(),
            follow_mode: mode,
            leader_user_id: Some("usr_lead".into()),
            auto_launch,
            members: vec![
                PartyMember {
                    user_id: "usr_lead".into(),
                    role: PartyRole::Member,
                },
                PartyMember {
                    user_id: "usr_other".into(),
                    role: PartyRole::Member,
                },
                PartyMember {
                    user_id: "usr_guest".into(),
                    role: PartyRole::Guest,
                },
            ],
        }
    }

    fn confirmed(parties: &[Party], users: &[&str], follow_emoji: Option<&str>) -> ConsentBook {
        let mut book = ConsentBook::default();
        for user in users {
            book.apply_boop(BoopInput {
                sender_user_id: user,
                emoji_id: follow_emoji.unwrap_or("default_fire"),
                now: 0,
                follow_emoji,
                parties,
            });
        }
        book
    }

    fn me(game_running: bool) -> SelfContext<'static> {
        SelfContext {
            user_id: "usr_me",
            game_running,
            location: "wrld_home:1",
            player_user_ids: &[],
        }
    }

    fn timing() -> FollowTiming {
        FollowTiming {
            now_ms: 10_000_000,
            last_follow_at_ms: None,
            last_own_move_at_ms: None,
            consent_hours: 24,
        }
    }

    #[test]
    fn follows_a_confirmed_member_into_a_joinable_instance() {
        let parties = [party(FollowMode::Anyone, false)];
        let book = confirmed(&parties, &["usr_other"], None);
        assert_eq!(
            decide_follow(
                &parties,
                &book,
                "usr_other",
                "wrld_a:123~friends(usr_other)",
                &me(true),
                &timing()
            ),
            FollowAction::SelfInvite {
                party_id: "p1".into(),
                world_id: "wrld_a".into(),
                instance_id: "123~friends(usr_other)".into(),
            }
        );
    }

    #[test]
    fn requests_an_invite_for_invite_only_instances() {
        let parties = [party(FollowMode::Anyone, false)];
        let book = confirmed(&parties, &["usr_other"], None);
        for location in [
            "wrld_a:1~private(usr_other)",
            "wrld_a:1~private(usr_x)~canRequestInvite",
        ] {
            assert_eq!(
                decide_follow(&parties, &book, "usr_other", location, &me(true), &timing()),
                FollowAction::RequestInvite {
                    party_id: "p1".into(),
                    user_id: "usr_other".into(),
                }
            );
        }
    }

    #[test]
    fn unconfirmed_members_guests_and_strangers_are_never_followed() {
        let parties = [party(FollowMode::Anyone, false)];
        let unconfirmed = ConsentBook::default();
        assert_eq!(
            decide_follow(
                &parties,
                &unconfirmed,
                "usr_other",
                "wrld_a:1",
                &me(true),
                &timing()
            ),
            FollowAction::Skip(FollowSkip::NotFollowed)
        );
        let book = confirmed(&parties, &["usr_guest"], None);
        assert_eq!(
            decide_follow(
                &parties,
                &book,
                "usr_guest",
                "wrld_a:1",
                &me(true),
                &timing()
            ),
            FollowAction::Skip(FollowSkip::NotFollowed)
        );
        assert_eq!(
            decide_follow(
                &parties,
                &book,
                "usr_stranger",
                "wrld_a:1",
                &me(true),
                &timing()
            ),
            FollowAction::Skip(FollowSkip::NotFollowed)
        );
    }

    #[test]
    fn leader_mode_follows_only_the_leader() {
        let parties = [party(FollowMode::Leader, false)];
        let book = confirmed(&parties, &["usr_lead", "usr_other"], None);
        assert!(matches!(
            decide_follow(
                &parties,
                &book,
                "usr_lead",
                "wrld_a:1",
                &me(true),
                &timing()
            ),
            FollowAction::SelfInvite { .. }
        ));
        assert_eq!(
            decide_follow(
                &parties,
                &book,
                "usr_other",
                "wrld_a:1",
                &me(true),
                &timing()
            ),
            FollowAction::Skip(FollowSkip::NotFollowed)
        );
    }

    #[test]
    fn loop_guards_skip_same_instance_and_recent_moves() {
        let parties = [party(FollowMode::Anyone, false)];
        let book = confirmed(&parties, &["usr_other"], None);
        assert_eq!(
            decide_follow(
                &parties,
                &book,
                "usr_other",
                "wrld_home:1",
                &me(true),
                &timing()
            ),
            FollowAction::Skip(FollowSkip::AlreadyThere)
        );
        let mut recent_follow = timing();
        recent_follow.last_follow_at_ms = Some(recent_follow.now_ms - 60_000);
        assert_eq!(
            decide_follow(
                &parties,
                &book,
                "usr_other",
                "wrld_a:1",
                &me(true),
                &recent_follow
            ),
            FollowAction::Skip(FollowSkip::Cooldown)
        );
        let mut recent_own_move = timing();
        recent_own_move.last_own_move_at_ms = Some(recent_own_move.now_ms - 1);
        assert_eq!(
            decide_follow(
                &parties,
                &book,
                "usr_other",
                "wrld_a:1",
                &me(true),
                &recent_own_move
            ),
            FollowAction::Skip(FollowSkip::Cooldown)
        );
        let mut later = timing();
        later.last_follow_at_ms = Some(later.now_ms - PARTY_FOLLOW_COOLDOWN_MS);
        assert!(matches!(
            decide_follow(&parties, &book, "usr_other", "wrld_a:1", &me(true), &later),
            FollowAction::SelfInvite { .. }
        ));
    }

    #[test]
    fn launches_only_when_opted_in_and_joinable() {
        let off = [party(FollowMode::Anyone, false)];
        let book = confirmed(&off, &["usr_other"], None);
        assert_eq!(
            decide_follow(&off, &book, "usr_other", "wrld_a:1", &me(false), &timing()),
            FollowAction::Skip(FollowSkip::GameNotRunning)
        );
        let on = [party(FollowMode::Anyone, true)];
        let book = confirmed(&on, &["usr_other"], None);
        assert_eq!(
            decide_follow(&on, &book, "usr_other", "wrld_a:1", &me(false), &timing()),
            FollowAction::Launch {
                party_id: "p1".into(),
                location: "wrld_a:1".into(),
            }
        );
        assert_eq!(
            decide_follow(
                &on,
                &book,
                "usr_other",
                "wrld_a:1~private(usr_other)",
                &me(false),
                &timing()
            ),
            FollowAction::Skip(FollowSkip::GameNotRunning)
        );
    }

    #[test]
    fn non_instances_are_not_followed() {
        let parties = [party(FollowMode::Anyone, false)];
        let book = confirmed(&parties, &["usr_other"], None);
        for location in ["private", "offline", "traveling", ""] {
            assert_eq!(
                decide_follow(&parties, &book, "usr_other", location, &me(true), &timing()),
                FollowAction::Skip(FollowSkip::NotJoinable)
            );
        }
    }

    #[test]
    fn outbound_lists_only_consenting_guests_and_follow_users_not_present() {
        let parties = [party(FollowMode::Anyone, false)];
        let mut book = confirmed(&parties, &["usr_guest", "usr_other"], None);
        book.apply_boop(BoopInput {
            sender_user_id: "usr_fan",
            emoji_id: "default_wow",
            now: 0,
            follow_emoji: Some("default_wow"),
            parties: &parties,
        });
        book.apply_boop(BoopInput {
            sender_user_id: "usr_here",
            emoji_id: "default_wow",
            now: 0,
            follow_emoji: Some("default_wow"),
            parties: &parties,
        });
        let players = vec!["usr_here".to_string()];
        let me = SelfContext {
            player_user_ids: &players,
            ..me(true)
        };
        assert_eq!(
            outbound_candidates(&parties, &book, Some("default_wow"), &me, 10, 24),
            vec![
                OutboundCandidate {
                    user_id: "usr_fan".into(),
                    reason: OutboundReason::FollowLink,
                },
                OutboundCandidate {
                    user_id: "usr_guest".into(),
                    reason: OutboundReason::PartyGuest {
                        party_id: "p1".into(),
                    },
                },
            ]
        );
        assert_eq!(
            outbound_candidates(&parties, &book, None, &me, 10, 24),
            vec![OutboundCandidate {
                user_id: "usr_guest".into(),
                reason: OutboundReason::PartyGuest {
                    party_id: "p1".into(),
                },
            }]
        );
        assert!(
            outbound_candidates(&parties, &book, Some("default_wow"), &me, 24 * 3600, 24)
                .is_empty()
        );
    }

    #[test]
    fn requesters_on_any_roster_are_recognized() {
        let parties = [party(FollowMode::Anyone, false)];
        assert_eq!(
            party_of_requester(&parties, "usr_guest").map(|party| party.id.as_str()),
            Some("p1")
        );
        assert!(party_of_requester(&parties, "usr_stranger").is_none());
    }
}
