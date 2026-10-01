use serde_json::json;
use vrcx_0_core::friends::{FriendBaselinePresence, FriendRecord};
use vrcx_0_core::presence::{LeaveTarget, Place, PresenceView};

use super::evidence::{Claim, Evidence, FriendEventKind, Source};
use super::feed::{joining_feed, presence_feed};
use super::model::{OnlineState, Phase, Stay};
use super::reduce::{reduce, wake, Step, BASELINE_CONFLICT_WINDOW_MS};
use super::view::presence_view;
use crate::realtime::runtime_types::PENDING_OFFLINE_DELAY_MS;

const T: i64 = 1_800_000_000_000;
const PLATFORM: &str = "standalonewindows";

fn inst(tag: &str) -> Place {
    Place::Instance(tag.into())
}

fn online(place: Place, since_ms: i64) -> Phase {
    Phase::Online(OnlineState::arrive(
        place,
        PLATFORM.into(),
        since_ms,
        true,
        Some(T),
    ))
}

fn seen_online(place: Place) -> Claim {
    Claim::Online {
        place,
        platform: PLATFORM.into(),
    }
}

fn ev(source: Source, claim: Claim) -> Evidence {
    Evidence::new(source, claim)
}

fn feed_types(prev: &Phase, step: &Step, now_ms: i64) -> Vec<String> {
    feed(prev, step, now_ms)
        .iter()
        .map(|entry| entry["type"].as_str().unwrap_or("").to_string())
        .collect()
}

fn feed(prev: &Phase, step: &Step, now_ms: i64) -> Vec<serde_json::Value> {
    let record = FriendRecord {
        id: "usr_friend".into(),
        display_name: "Friend".into(),
        ..FriendRecord::default()
    };
    presence_feed("usr_friend", &record, prev, &step.next, now_ms, "at")
        .into_iter()
        .chain(joining_feed("usr_friend", &record, prev, &step.next, "at"))
        .map(|entry| entry.to_json())
        .collect()
}

fn pending(held: Phase, target: LeaveTarget, deadline_ms: i64) -> Phase {
    let Phase::Online(held) = held else {
        panic!("pending needs an online state");
    };
    Phase::PendingOffline {
        held,
        target,
        deadline_ms,
    }
}

fn place_of(phase: &Phase) -> &Place {
    &phase.online_state().expect("online section").place
}

fn stay(phase: &Phase) -> (&Place, i64) {
    let state = phase.online_state().expect("online section");
    (&state.place, state.since_ms)
}

#[test]
fn offline_or_active_friend_coming_online_writes_online() {
    for prev in [
        Phase::offline(),
        Phase::Active {
            changed_ms: None,
            platform: "web".into(),
        },
    ] {
        for source in [
            Source::Ws,
            Source::Api,
            Source::TrustedAdd,
            Source::Baseline,
        ] {
            let step = reduce(&prev, &ev(source, seen_online(inst("wrld_a:1"))), T);
            assert_eq!(
                stay(&step.next),
                (&inst("wrld_a:1"), T),
                "{prev:?} {source:?}"
            );
            assert_eq!(feed_types(&prev, &step, T), ["Online"]);
            assert_eq!(feed(&prev, &step, T)[0]["location"], "wrld_a:1");
            assert!(!step.refetch);
            assert_eq!(step.wake_at_ms, None);
        }
    }
}

#[test]
fn the_online_clock_starts_at_the_transition_and_survives_moves_and_pending() {
    let online_since = |phase: &Phase| phase.online_state().and_then(|state| state.online_since_ms);
    let came_online = reduce(
        &Phase::offline(),
        &ev(Source::Ws, seen_online(inst("wrld_a:1"))),
        T,
    )
    .next;
    assert_eq!(online_since(&came_online), Some(T));
    let moved = reduce(
        &came_online,
        &ev(
            Source::Ws,
            Claim::Place {
                place: inst("wrld_b:2"),
            },
        ),
        T + 1_000,
    )
    .next;
    assert_eq!(online_since(&moved), Some(T));
    let left = reduce(&moved, &ev(Source::Ws, Claim::Offline), T + 2_000).next;
    assert_eq!(online_since(&left), Some(T));
    let back = reduce(
        &left,
        &ev(Source::Ws, seen_online(inst("wrld_b:2"))),
        T + 3_000,
    )
    .next;
    assert_eq!(online_since(&back), Some(T));
    let rebuilt = Phase::initial(&seen_online(inst("wrld_a:1")), T, false);
    assert_eq!(online_since(&rebuilt), None);
}

#[test]
fn coming_online_without_a_location_requests_a_refetch() {
    let step = reduce(
        &Phase::offline(),
        &ev(Source::Ws, seen_online(Place::Unknown)),
        T,
    );
    assert_eq!(step.next, online(Place::Unknown, T));
    assert!(step.refetch);
    assert_eq!(feed(&Phase::offline(), &step, T)[0]["location"], "");
}

#[test]
fn offline_and_active_move_between_each_other_without_records() {
    let active = reduce(
        &Phase::offline(),
        &ev(
            Source::Ws,
            Claim::Active {
                platform: "web".into(),
            },
        ),
        T,
    );
    assert_eq!(
        active.next,
        Phase::Active {
            changed_ms: Some(T),
            platform: "web".into()
        }
    );
    assert!(feed_types(&Phase::offline(), &active, T).is_empty());

    let offline = reduce(&active.next, &ev(Source::Ws, Claim::Offline), T + 1);
    assert_eq!(
        offline.next,
        Phase::Offline {
            changed_ms: Some(T + 1)
        }
    );
    assert!(feed_types(&active.next, &offline, T + 1).is_empty());

    let again = reduce(&offline.next, &ev(Source::Ws, Claim::Offline), T + 2);
    assert_eq!(again.next, offline.next);
}

#[test]
fn not_in_game_and_place_only_evidence_never_bring_a_friend_online() {
    for prev in [
        Phase::offline(),
        Phase::Active {
            changed_ms: None,
            platform: "web".into(),
        },
    ] {
        for claim in [
            Claim::NotInGame,
            Claim::Place {
                place: Place::Private,
            },
            Claim::Nothing,
        ] {
            let step = reduce(&prev, &ev(Source::Ws, claim.clone()), T);
            assert_eq!(step.next, prev, "{claim:?}");
            assert!(!step.refetch, "{claim:?}");
        }
        let impossible = reduce(
            &prev,
            &ev(
                Source::Ws,
                Claim::Place {
                    place: inst("wrld_a:1"),
                },
            ),
            T,
        );
        assert_eq!(impossible.next, prev);
        assert!(impossible.refetch);
    }
}

#[test]
fn baseline_online_list_yields_to_a_recent_live_offline() {
    let recent = Phase::Offline {
        changed_ms: Some(T - BASELINE_CONFLICT_WINDOW_MS + 1),
    };
    let step = reduce(
        &recent,
        &ev(Source::Baseline, seen_online(inst("wrld_a:1"))),
        T,
    );
    assert_eq!(step.next, recent);
    assert!(step.refetch);

    let stale = Phase::Offline {
        changed_ms: Some(T - BASELINE_CONFLICT_WINDOW_MS),
    };
    let step = reduce(
        &stale,
        &ev(Source::Baseline, seen_online(inst("wrld_a:1"))),
        T,
    );
    assert_eq!(stay(&step.next), (&inst("wrld_a:1"), T));
    assert!(!step.refetch);
}

#[test]
fn online_friend_leaving_enters_pending_unless_the_add_is_trusted() {
    let prev = online(inst("wrld_a:1"), T - 60_000);
    for (source, claim, target) in [
        (Source::Ws, Claim::Offline, LeaveTarget::Offline),
        (Source::Ws, Claim::NotInGame, LeaveTarget::Offline),
        (
            Source::Ws,
            Claim::Active {
                platform: "web".into(),
            },
            LeaveTarget::Active,
        ),
        (Source::Api, Claim::Offline, LeaveTarget::Offline),
        (Source::Baseline, Claim::Offline, LeaveTarget::Offline),
    ] {
        let step = reduce(&prev, &ev(source, claim.clone()), T);
        assert_eq!(
            step.next,
            pending(prev.clone(), target, T + PENDING_OFFLINE_DELAY_MS),
            "{source:?} {claim:?}"
        );
        assert_eq!(step.wake_at_ms, Some(T + PENDING_OFFLINE_DELAY_MS));
        assert!(feed_types(&prev, &step, T).is_empty());
    }

    let trusted = reduce(&prev, &ev(Source::TrustedAdd, Claim::Offline), T);
    assert_eq!(
        trusted.next,
        Phase::Offline {
            changed_ms: Some(T)
        }
    );
    let entries = feed(&prev, &trusted, T);
    assert_eq!(entries[0]["type"], "Offline");
    assert_eq!(entries[0]["location"], "wrld_a:1");
    assert_eq!(entries[0]["time"], 60_000);
}

#[test]
fn pending_waits_for_its_deadline_whatever_source_reports_leaving() {
    let prev = pending(online(inst("wrld_a:1"), T), LeaveTarget::Offline, T + 10);
    for source in [
        Source::Ws,
        Source::Api,
        Source::Baseline,
        Source::TrustedAdd,
    ] {
        for claim in [
            Claim::Offline,
            Claim::NotInGame,
            Claim::Active {
                platform: "web".into(),
            },
        ] {
            let step = reduce(&prev, &ev(source, claim), T + 5);
            assert_eq!(step.next, prev, "{source:?}");
            assert_eq!(step.wake_at_ms, None);
        }
    }
}

#[test]
fn pending_is_cancelled_by_live_online_without_an_online_record() {
    let prev = pending(
        online(inst("wrld_a:1"), T - 10),
        LeaveTarget::Offline,
        T + 100,
    );
    let back = reduce(&prev, &ev(Source::Ws, seen_online(inst("wrld_a:1"))), T);
    assert_eq!(stay(&back.next), (&inst("wrld_a:1"), T - 10));
    assert!(feed_types(&prev, &back, T).is_empty());

    let moved = reduce(&prev, &ev(Source::Api, seen_online(inst("wrld_b:2"))), T);
    assert_eq!(place_of(&moved.next), &inst("wrld_b:2"));
    assert_eq!(feed_types(&prev, &moved, T), ["GPS"]);
}

#[test]
fn baseline_online_list_does_not_cancel_a_live_pending() {
    let prev = pending(online(inst("wrld_a:1"), T), LeaveTarget::Offline, T + 100);
    let step = reduce(
        &prev,
        &ev(Source::Baseline, seen_online(inst("wrld_a:1"))),
        T + 1,
    );
    assert_eq!(step.next, prev);
    assert!(step.refetch);
}

#[test]
fn place_only_evidence_updates_the_held_place_while_pending() {
    let prev = pending(online(inst("wrld_a:1"), T), LeaveTarget::Offline, T + 100);
    let step = reduce(
        &prev,
        &ev(
            Source::Ws,
            Claim::Place {
                place: inst("wrld_b:2"),
            },
        ),
        T + 1,
    );
    assert_eq!(place_of(&step.next), &inst("wrld_b:2"));
    assert!(
        matches!(step.next, Phase::PendingOffline { deadline_ms, .. } if deadline_ms == T + 100)
    );
}

#[test]
fn timer_finalizes_pending_only_at_its_deadline() {
    let prev = pending(
        online(inst("wrld_a:1"), T - 50),
        LeaveTarget::Offline,
        T + 100,
    );
    let early = wake(&prev, T + 99);
    assert_eq!(early.next, prev);

    let due = wake(&prev, T + 100);
    assert_eq!(
        due.next,
        Phase::Offline {
            changed_ms: Some(T + 100)
        }
    );
    let entries = feed(&prev, &due, T + 100);
    assert_eq!(entries[0]["type"], "Offline");
    assert_eq!(entries[0]["time"], 150);

    let to_active = pending(online(inst("wrld_a:1"), T), LeaveTarget::Active, T + 100);
    assert_eq!(
        wake(&to_active, T + 100).next,
        Phase::Active {
            changed_ms: Some(T + 100),
            platform: PLATFORM.into()
        }
    );
}

#[test]
fn pending_wakes_at_its_deadline() {
    let prev = pending(online(inst("wrld_a:1"), T), LeaveTarget::Offline, T + 100);
    assert_eq!(prev.wake_at(), Some(T + 100));
    assert_eq!(Phase::offline().wake_at(), None);
}

#[test]
fn moving_between_instances_writes_gps_with_the_stay_duration() {
    let prev = online(inst("wrld_a:1"), T - 90_000);
    let step = reduce(&prev, &ev(Source::Ws, seen_online(inst("wrld_b:2"))), T);
    assert_eq!(step.next, online(inst("wrld_b:2"), T));
    let entries = feed(&prev, &step, T);
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["type"], "GPS");
    assert_eq!(entries[0]["previousLocation"], "wrld_a:1");
    assert_eq!(entries[0]["location"], "wrld_b:2");
    assert_eq!(entries[0]["time"], 90_000);
}

#[test]
fn private_boundaries_write_gps_and_unknown_places_do_not() {
    let private = online(Place::Private, T - 10);
    let step = reduce(&private, &ev(Source::Ws, seen_online(inst("wrld_a:1"))), T);
    assert_eq!(feed_types(&private, &step, T), ["GPS"]);

    let unknown = online(Place::Unknown, T - 10);
    let step = reduce(&unknown, &ev(Source::Ws, seen_online(inst("wrld_a:1"))), T);
    assert_eq!(place_of(&step.next), &inst("wrld_a:1"));
    assert!(feed_types(&unknown, &step, T).is_empty());
}

#[test]
fn repeated_or_unknown_locations_keep_the_stay_start() {
    let prev = online(inst("wrld_a:1"), T - 5_000);
    for place in [inst("wrld_a:1"), Place::Unknown] {
        let step = reduce(&prev, &ev(Source::Ws, seen_online(place)), T);
        assert_eq!(stay(&step.next), stay(&prev));
        assert!(feed_types(&prev, &step, T).is_empty());
    }
}

#[test]
fn traveling_announces_joining_and_arrival_writes_gps_from_the_origin() {
    let prev = online(inst("wrld_a:1"), T - 60_000);
    let traveling = reduce(
        &prev,
        &ev(
            Source::Ws,
            seen_online(Place::Traveling {
                to: Some("wrld_b:2".into()),
            }),
        ),
        T,
    );
    let Phase::Online(state) = &traveling.next else {
        panic!("still online");
    };
    assert_eq!(state.since_ms, T);
    assert_eq!(
        state.travel_from,
        Some(Stay {
            tag: "wrld_a:1".into(),
            since_ms: T - 60_000
        })
    );
    assert_eq!(feed_types(&prev, &traveling, T), ["OnPlayerJoining"]);

    let retarget = reduce(
        &traveling.next,
        &ev(
            Source::Ws,
            seen_online(Place::Traveling {
                to: Some("wrld_c:3".into()),
            }),
        ),
        T + 1,
    );
    assert_eq!(retarget.next.online_state().unwrap().since_ms, T);
    assert!(feed_types(&traveling.next, &retarget, T + 1).is_empty());

    let arrived = reduce(
        &traveling.next,
        &ev(Source::Ws, seen_online(inst("wrld_b:2"))),
        T + 5_000,
    );
    assert_eq!(arrived.next, online(inst("wrld_b:2"), T + 5_000));
    let entries = feed(&traveling.next, &arrived, T + 5_000);
    assert_eq!(entries[0]["type"], "GPS");
    assert_eq!(entries[0]["previousLocation"], "wrld_a:1");
    assert_eq!(entries[0]["time"], 60_000);
}

#[test]
fn returning_to_the_origin_restores_the_stay_start_without_gps() {
    let prev = online(inst("wrld_a:1"), T - 60_000);
    let traveling = reduce(
        &prev,
        &ev(Source::Ws, seen_online(Place::Traveling { to: None })),
        T,
    );
    let back = reduce(
        &traveling.next,
        &ev(Source::Ws, seen_online(inst("wrld_a:1"))),
        T + 5_000,
    );
    assert_eq!(stay(&back.next), (&inst("wrld_a:1"), T - 60_000));
    assert!(feed_types(&traveling.next, &back, T + 5_000).is_empty());
}

#[test]
fn coming_online_while_traveling_announces_joining() {
    let step = reduce(
        &Phase::offline(),
        &ev(
            Source::Ws,
            seen_online(Place::Traveling {
                to: Some("wrld_b:2".into()),
            }),
        ),
        T,
    );
    assert_eq!(
        feed_types(&Phase::offline(), &step, T),
        ["Online", "OnPlayerJoining"]
    );
}

#[test]
fn baseline_location_yields_to_a_recent_live_location() {
    let recent = online(inst("wrld_a:1"), T - BASELINE_CONFLICT_WINDOW_MS + 1);
    let step = reduce(
        &recent,
        &ev(Source::Baseline, seen_online(inst("wrld_b:2"))),
        T,
    );
    assert_eq!(step.next, recent);
    assert!(!step.refetch);

    let stale = online(inst("wrld_a:1"), T - BASELINE_CONFLICT_WINDOW_MS);
    let step = reduce(
        &stale,
        &ev(Source::Baseline, seen_online(inst("wrld_b:2"))),
        T,
    );
    assert_eq!(place_of(&step.next), &inst("wrld_b:2"));
    assert_eq!(feed_types(&stale, &step, T), ["GPS"]);
}

#[test]
fn baseline_arrival_at_the_travel_destination_is_not_a_conflict() {
    let traveling = online(
        Place::Traveling {
            to: Some("wrld_b:2".into()),
        },
        T - 1_000,
    );
    let step = reduce(
        &traveling,
        &ev(Source::Baseline, seen_online(inst("wrld_b:2"))),
        T,
    );
    assert_eq!(place_of(&step.next), &inst("wrld_b:2"));

    let elsewhere = reduce(
        &traveling,
        &ev(Source::Baseline, seen_online(inst("wrld_c:3"))),
        T,
    );
    assert_eq!(elsewhere.next, traveling);
}

#[test]
fn baseline_location_replaces_a_place_that_came_from_an_earlier_baseline() {
    let from_baseline = reduce(
        &Phase::offline(),
        &ev(Source::Baseline, seen_online(inst("wrld_a:1"))),
        T - 1_000,
    );
    let step = reduce(
        &from_baseline.next,
        &ev(Source::Baseline, seen_online(inst("wrld_b:2"))),
        T,
    );
    assert_eq!(place_of(&step.next), &inst("wrld_b:2"));

    let confirmed_live = reduce(
        &from_baseline.next,
        &ev(Source::Ws, seen_online(inst("wrld_a:1"))),
        T - 500,
    );
    let step = reduce(
        &confirmed_live.next,
        &ev(Source::Baseline, seen_online(inst("wrld_b:2"))),
        T,
    );
    assert_eq!(place_of(&step.next), &inst("wrld_a:1"));
}

#[test]
fn location_events_map_to_claims_by_identity_and_location_proof() {
    let with_user = |location: &str| {
        json!({
            "userId": "usr_friend",
            "location": location,
            "platform": PLATFORM,
            "user": { "id": "usr_friend", "location": "wrld_stale:9" }
        })
    };
    let online_event = Evidence::from_ws(FriendEventKind::Location, &with_user("wrld_a:1"));
    assert_eq!(online_event.claim, seen_online(inst("wrld_a:1")));
    assert!(!online_event.refetch_hint);

    let offline_event = Evidence::from_ws(FriendEventKind::Location, &with_user("offline"));
    assert_eq!(offline_event.claim, Claim::NotInGame);
    assert!(offline_event.refetch_hint);

    let anonymous = Evidence::from_ws(
        FriendEventKind::Location,
        &json!({ "userId": "usr_friend", "location": "wrld_a:1" }),
    );
    assert_eq!(
        anonymous.claim,
        Claim::Place {
            place: inst("wrld_a:1")
        }
    );

    let embedded_only = Evidence::from_ws(
        FriendEventKind::Location,
        &json!({ "user": { "id": "usr_friend", "location": "private" } }),
    );
    assert_eq!(
        embedded_only.claim,
        Claim::Online {
            place: Place::Private,
            platform: String::new()
        }
    );
}

#[test]
fn online_active_offline_and_update_events_map_to_claims() {
    assert_eq!(
        Evidence::from_ws(
            FriendEventKind::Online,
            &json!({ "location": "traveling", "travelingToLocation": "wrld_b:2", "platform": PLATFORM }),
        )
        .claim,
        seen_online(Place::Traveling {
            to: Some("wrld_b:2".into())
        })
    );
    assert_eq!(
        Evidence::from_ws(FriendEventKind::Active, &json!({ "platform": "web" })).claim,
        Claim::Active {
            platform: "web".into()
        }
    );
    assert_eq!(
        Evidence::from_ws(FriendEventKind::Offline, &json!({ "userId": "usr_friend" })).claim,
        Claim::Offline
    );
    assert_eq!(
        Evidence::from_ws(
            FriendEventKind::Update,
            &json!({ "user": { "displayName": "Friend" } })
        )
        .claim,
        Claim::Nothing
    );
    assert_eq!(
        Evidence::from_ws(
            FriendEventKind::Update,
            &json!({ "user": { "location": "private" } })
        )
        .claim,
        Claim::Place {
            place: Place::Private
        }
    );
}

#[test]
fn profiles_and_baseline_records_map_state_buckets() {
    let profile = |state: &str| {
        Evidence::from_profile(
            Source::Api,
            &json!({ "state": state, "location": "wrld_a:1", "platform": PLATFORM }),
        )
        .claim
    };
    assert_eq!(profile("online"), seen_online(inst("wrld_a:1")));
    assert_eq!(
        profile("active"),
        Claim::Active {
            platform: PLATFORM.into()
        }
    );
    assert_eq!(profile("offline"), Claim::Offline);
    assert_eq!(profile(""), Claim::Nothing);

    let baseline = Evidence::from_baseline(&FriendBaselinePresence {
        state: "online".into(),
        location: "private".into(),
        ..FriendBaselinePresence::default()
    });
    assert_eq!(baseline.source, Source::Baseline);
    assert_eq!(
        baseline.claim,
        Claim::Online {
            place: Place::Private,
            platform: String::new()
        }
    );
    assert_eq!(
        Evidence::from_baseline(&FriendBaselinePresence::default()).claim,
        Claim::Offline
    );
}

#[test]
fn views_expose_the_held_place_while_pending() {
    let held = online(inst("wrld_a:1"), T);
    let view = presence_view(&pending(held, LeaveTarget::Active, T + 100));
    let PresenceView::PendingOffline {
        place,
        target,
        deadline_ms,
        ..
    } = view
    else {
        panic!("pending view");
    };
    assert_eq!(place.location.tag, "wrld_a:1");
    assert_eq!(target, LeaveTarget::Active);
    assert_eq!(deadline_ms, T + 100);
    assert_eq!(presence_view(&Phase::offline()), PresenceView::Offline);
}
