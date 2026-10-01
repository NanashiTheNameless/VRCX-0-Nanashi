use vrcx_0_core::presence::{LeaveTarget, Place};

use super::evidence::Claim;

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Phase {
    Offline {
        changed_ms: Option<i64>,
    },
    Active {
        changed_ms: Option<i64>,
        platform: String,
    },
    Online(OnlineState),
    PendingOffline {
        held: OnlineState,
        target: LeaveTarget,
        deadline_ms: i64,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct OnlineState {
    pub(crate) place: Place,
    pub(crate) since_ms: i64,
    pub(crate) travel_from: Option<Stay>,
    pub(crate) platform: String,
    pub(crate) online_since_ms: Option<i64>,
    pub(crate) live_ms: Option<i64>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Stay {
    pub(crate) tag: String,
    pub(crate) since_ms: i64,
}

impl Phase {
    pub(crate) fn offline() -> Self {
        Self::Offline { changed_ms: None }
    }

    pub(crate) fn initial(claim: &Claim, now_ms: i64, live: bool) -> Self {
        match claim {
            Claim::Online { place, platform } => Self::Online(OnlineState::arrive(
                place.clone(),
                platform.clone(),
                now_ms,
                live,
                live.then_some(now_ms),
            )),
            Claim::Active { platform } => Self::Active {
                changed_ms: None,
                platform: platform.clone(),
            },
            _ => Self::offline(),
        }
    }

    pub(crate) fn wake_at(&self) -> Option<i64> {
        match self {
            Self::PendingOffline { deadline_ms, .. } => Some(*deadline_ms),
            _ => None,
        }
    }

    pub(crate) fn is_online_section(&self) -> bool {
        matches!(self, Self::Online(_) | Self::PendingOffline { .. })
    }

    pub(crate) fn online_state(&self) -> Option<&OnlineState> {
        match self {
            Self::Online(state) | Self::PendingOffline { held: state, .. } => Some(state),
            _ => None,
        }
    }

    pub(crate) fn left(target: LeaveTarget, platform: String, now_ms: i64) -> Self {
        match target {
            LeaveTarget::Offline => Self::Offline {
                changed_ms: Some(now_ms),
            },
            LeaveTarget::Active => Self::Active {
                changed_ms: Some(now_ms),
                platform,
            },
        }
    }
}

impl OnlineState {
    pub(crate) fn arrive(
        place: Place,
        platform: String,
        now_ms: i64,
        live: bool,
        online_since_ms: Option<i64>,
    ) -> Self {
        Self {
            place,
            since_ms: now_ms,
            travel_from: None,
            platform,
            online_since_ms,
            live_ms: live.then_some(now_ms),
        }
    }
}
