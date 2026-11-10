use std::collections::{HashSet, VecDeque};

// Fixed limits, deliberately not settings (Terms of Service 13.2(i)).
pub(crate) const PARTY_OUTBOUND_INVITES_PER_HOUR: usize = 20;
pub(crate) const PARTY_BOOP_BACKS_PER_HOUR: usize = 10;
const HOUR_MS: i64 = 60 * 60 * 1000;

#[derive(Clone, Debug, Default)]
pub(crate) struct PartyRuntimeState {
    last_follow_at_ms: Option<i64>,
    last_own_location: String,
    last_own_move_at_ms: Option<i64>,
    invited_this_move: HashSet<String>,
    outbound_invites: VecDeque<i64>,
    boop_backs: VecDeque<i64>,
}

impl PartyRuntimeState {
    pub(crate) fn last_follow_at_ms(&self) -> Option<i64> {
        self.last_follow_at_ms
    }

    pub(crate) fn last_own_move_at_ms(&self) -> Option<i64> {
        self.last_own_move_at_ms
    }

    pub(crate) fn record_follow(&mut self, now_ms: i64) {
        self.last_follow_at_ms = Some(now_ms);
    }

    /// Returns true when the own location really changed, which starts a new
    /// move: everyone may get one invite for it.
    pub(crate) fn observe_own_location(&mut self, location: &str, now_ms: i64) -> bool {
        let location = location.trim();
        if location.is_empty() || location == "traveling" || location == self.last_own_location {
            return false;
        }
        let first_observation = self.last_own_location.is_empty();
        self.last_own_location = location.to_string();
        self.invited_this_move.clear();
        if first_observation {
            return false;
        }
        self.last_own_move_at_ms = Some(now_ms);
        true
    }

    /// Reserves the one invite a person may get for the current move, within
    /// the hourly outbound cap.
    pub(crate) fn take_outbound_invite(&mut self, user_id: &str, now_ms: i64) -> bool {
        prune_hour(&mut self.outbound_invites, now_ms);
        if self.outbound_invites.len() >= PARTY_OUTBOUND_INVITES_PER_HOUR
            || self.invited_this_move.contains(user_id)
        {
            return false;
        }
        self.invited_this_move.insert(user_id.to_string());
        self.outbound_invites.push_back(now_ms);
        true
    }

    pub(crate) fn take_boop_back(&mut self, now_ms: i64) -> bool {
        prune_hour(&mut self.boop_backs, now_ms);
        if self.boop_backs.len() >= PARTY_BOOP_BACKS_PER_HOUR {
            return false;
        }
        self.boop_backs.push_back(now_ms);
        true
    }
}

fn prune_hour(window: &mut VecDeque<i64>, now_ms: i64) {
    while window
        .front()
        .is_some_and(|at_ms| now_ms.saturating_sub(*at_ms) >= HOUR_MS)
    {
        window.pop_front();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_location_is_a_baseline_not_a_move() {
        let mut state = PartyRuntimeState::default();
        assert!(!state.observe_own_location("wrld_a:1", 10));
        assert_eq!(state.last_own_move_at_ms(), None);
        assert!(!state.observe_own_location("wrld_a:1", 20));
        assert!(!state.observe_own_location("traveling", 25));
        assert!(state.observe_own_location("wrld_b:1", 30));
        assert_eq!(state.last_own_move_at_ms(), Some(30));
        assert_eq!(state.last_own_location, "wrld_b:1");
    }

    #[test]
    fn one_invite_per_person_per_move_within_the_hourly_cap() {
        let mut state = PartyRuntimeState::default();
        state.observe_own_location("wrld_a:1", 0);
        assert!(state.take_outbound_invite("usr_a", 1));
        assert!(!state.take_outbound_invite("usr_a", 2));
        state.observe_own_location("wrld_b:1", 3);
        assert!(state.take_outbound_invite("usr_a", 4));

        let mut capped = PartyRuntimeState::default();
        for index in 0..PARTY_OUTBOUND_INVITES_PER_HOUR {
            assert!(capped.take_outbound_invite(&format!("usr_{index}"), index as i64));
        }
        assert!(!capped.take_outbound_invite("usr_late", 100));
        assert!(capped.take_outbound_invite("usr_late", HOUR_MS));
    }

    #[test]
    fn boop_backs_are_capped_per_hour() {
        let mut state = PartyRuntimeState::default();
        for index in 0..PARTY_BOOP_BACKS_PER_HOUR {
            assert!(state.take_boop_back(index as i64));
        }
        assert!(!state.take_boop_back(100));
        assert!(state.take_boop_back(HOUR_MS + 1));
    }
}
