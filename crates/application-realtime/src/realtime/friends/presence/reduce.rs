use vrcx_0_core::presence::{LeaveTarget, Place};

use crate::realtime::runtime_types::PENDING_OFFLINE_DELAY_MS;

use super::evidence::{Claim, Evidence, Source};
use super::model::{OnlineState, Phase, Stay};

pub(crate) const BASELINE_CONFLICT_WINDOW_MS: i64 = 300_000;

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Step {
    pub(crate) next: Phase,
    pub(crate) wake_at_ms: Option<i64>,
    pub(crate) refetch: bool,
}

pub(crate) fn reduce(prev: &Phase, evidence: &Evidence, now_ms: i64) -> Step {
    let next = observe(prev, evidence, now_ms);
    let refetch = evidence.refetch_hint || needs_refetch(evidence, &next);
    step(prev, next, refetch)
}

pub(crate) fn wake(prev: &Phase, now_ms: i64) -> Step {
    step(prev, fire_due(prev, now_ms), false)
}

fn step(prev: &Phase, next: Phase, refetch: bool) -> Step {
    let wake_at_ms = next.wake_at().filter(|at| prev.wake_at() != Some(*at));
    Step {
        next,
        wake_at_ms,
        refetch,
    }
}

fn observe(prev: &Phase, evidence: &Evidence, now_ms: i64) -> Phase {
    let baseline = evidence.source == Source::Baseline;
    match (prev, &evidence.claim) {
        (_, Claim::Nothing) => prev.clone(),
        (Phase::Offline { .. } | Phase::Active { .. }, Claim::Online { place, platform }) => {
            if baseline && changed_recently(prev, now_ms) {
                return prev.clone();
            }
            Phase::Online(OnlineState::arrive(
                place.clone(),
                platform.clone(),
                now_ms,
                !baseline,
                Some(now_ms),
            ))
        }
        (Phase::Active { changed_ms, .. }, Claim::Active { platform }) => Phase::Active {
            changed_ms: *changed_ms,
            platform: platform.clone(),
        },
        (Phase::Offline { .. }, Claim::Active { platform }) => {
            Phase::left(LeaveTarget::Active, platform.clone(), now_ms)
        }
        (Phase::Active { .. }, Claim::Offline) => {
            Phase::left(LeaveTarget::Offline, String::new(), now_ms)
        }
        (Phase::Offline { .. }, Claim::Offline)
        | (Phase::Offline { .. } | Phase::Active { .. }, Claim::NotInGame | Claim::Place { .. }) => {
            prev.clone()
        }
        (Phase::Online(state), Claim::Online { place, platform }) => {
            let arrived = place.instance_tag().is_some()
                && place.instance_tag() == state.place.traveling_to();
            let live_recently = state
                .live_ms
                .is_some_and(|live_ms| now_ms - live_ms < BASELINE_CONFLICT_WINDOW_MS);
            if baseline && *place != state.place && !arrived && live_recently {
                return prev.clone();
            }
            let mut next = observe_place(state, place, evidence.source, now_ms);
            next.platform = platform.clone();
            Phase::Online(next)
        }
        (Phase::Online(state), Claim::Place { place }) => {
            Phase::Online(observe_place(state, place, evidence.source, now_ms))
        }
        (Phase::Online(state), Claim::Active { platform }) => leave(
            state,
            LeaveTarget::Active,
            platform.clone(),
            evidence.source,
            now_ms,
        ),
        (Phase::Online(state), Claim::Offline | Claim::NotInGame) => leave(
            state,
            LeaveTarget::Offline,
            String::new(),
            evidence.source,
            now_ms,
        ),
        (Phase::PendingOffline { held, .. }, Claim::Online { place, platform }) => {
            if baseline {
                return prev.clone();
            }
            let mut next = observe_place(held, place, evidence.source, now_ms);
            next.platform = platform.clone();
            Phase::Online(next)
        }
        (
            Phase::PendingOffline {
                held,
                target,
                deadline_ms,
            },
            Claim::Place { place },
        ) => Phase::PendingOffline {
            held: observe_place(held, place, evidence.source, now_ms),
            target: *target,
            deadline_ms: *deadline_ms,
        },
        (
            Phase::PendingOffline { .. },
            Claim::NotInGame | Claim::Active { .. } | Claim::Offline,
        ) => prev.clone(),
    }
}

fn leave(
    state: &OnlineState,
    target: LeaveTarget,
    platform: String,
    source: Source,
    now_ms: i64,
) -> Phase {
    if source == Source::TrustedAdd {
        return Phase::left(target, platform, now_ms);
    }
    Phase::PendingOffline {
        held: state.clone(),
        target,
        deadline_ms: now_ms + PENDING_OFFLINE_DELAY_MS,
    }
}

fn fire_due(prev: &Phase, now_ms: i64) -> Phase {
    match prev {
        Phase::PendingOffline {
            held,
            target,
            deadline_ms,
        } if now_ms >= *deadline_ms => Phase::left(*target, held.platform.clone(), now_ms),
        _ => prev.clone(),
    }
}

fn changed_recently(phase: &Phase, now_ms: i64) -> bool {
    match phase {
        Phase::Offline { changed_ms } | Phase::Active { changed_ms, .. } => {
            changed_ms.is_some_and(|changed_ms| now_ms - changed_ms < BASELINE_CONFLICT_WINDOW_MS)
        }
        _ => false,
    }
}

fn needs_refetch(evidence: &Evidence, next: &Phase) -> bool {
    let claimed_place = match &evidence.claim {
        Claim::Online { place, .. } | Claim::Place { place } => Some(place),
        _ => None,
    };
    let online = next.is_online_section();
    match next {
        Phase::Online(state) if evidence.source == Source::Ws && state.place == Place::Unknown => {
            return true;
        }
        _ => {}
    }
    if !online && claimed_place.is_some_and(|place| place.instance_tag().is_some()) {
        return true;
    }
    evidence.source == Source::Baseline
        && matches!(evidence.claim, Claim::Online { .. })
        && !matches!(next, Phase::Online(_))
}

fn observe_place(state: &OnlineState, place: &Place, source: Source, now_ms: i64) -> OnlineState {
    let mut next = advance(state, place, now_ms);
    next.live_ms = if source != Source::Baseline {
        Some(now_ms)
    } else if next.place != state.place {
        None
    } else {
        state.live_ms
    };
    next
}

fn advance(state: &OnlineState, place: &Place, now_ms: i64) -> OnlineState {
    let mut next = state.clone();
    if *place == Place::Unknown || *place == state.place {
        return next;
    }
    match (&state.place, place) {
        (Place::Traveling { .. }, Place::Traveling { .. }) => {
            next.place = place.clone();
            return next;
        }
        (_, Place::Traveling { .. }) => {
            next.travel_from = state.place.instance_tag().map(|tag| Stay {
                tag: tag.to_string(),
                since_ms: state.since_ms,
            });
            next.place = place.clone();
            next.since_ms = now_ms;
            return next;
        }
        _ => {}
    }
    let restored = next
        .travel_from
        .take()
        .filter(|stay| place.instance_tag() == Some(stay.tag.as_str()))
        .map(|stay| stay.since_ms);
    next.place = place.clone();
    next.since_ms = restored.unwrap_or(now_ms);
    next
}
