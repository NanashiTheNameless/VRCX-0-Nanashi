use vrcx_0_core::game_log_parser::{GameLogEvent, GameLogEventKind};
use vrcx_0_core::game_process::GameProcessEvent;

use super::{
    GameLogAvatarChange, GameLogIngestEngine, GameLogIngestOptions, GameLogIngestOutput,
    GameLogProcessEvent, GameLogSideEffect,
};

fn event(created_at: i64, kind: GameLogEventKind) -> GameLogEvent {
    GameLogEvent {
        file_name: "output_log.txt".into(),
        created_at,
        kind,
    }
}

#[test]
fn reports_an_instance_avatar_change_only_after_the_first_avatar_seen() {
    let mut engine = GameLogIngestEngine::default();
    let avatar = |created_at: i64, avatar_name: &str| {
        event(
            created_at,
            GameLogEventKind::AvatarChange {
                display_name: "Alice".into(),
                avatar_name: avatar_name.into(),
            },
        )
    };
    let output = engine.ingest_events(
        &[
            event(
                1788709924,
                GameLogEventKind::Location {
                    location: "wrld_room:1".into(),
                    world_name: "Room".into(),
                },
            ),
            event(
                1788709925,
                GameLogEventKind::PlayerJoined {
                    display_name: "Alice".into(),
                    user_id: "usr_alice".into(),
                },
            ),
            avatar(1788709926, "First"),
            avatar(1788709927, "First"),
            avatar(1788709928, "Second"),
            event(
                1788709980,
                GameLogEventKind::Location {
                    location: "wrld_next:2".into(),
                    world_name: "Next".into(),
                },
            ),
            avatar(1788709981, "Third"),
        ],
        GameLogIngestOptions::default(),
    );

    assert_eq!(
        output.avatar_changes,
        [GameLogAvatarChange {
            created_at: 1788709928,
            user_id: "usr_alice".into(),
            display_name: "Alice".into(),
            avatar_name: "Second".into(),
            location: "wrld_room:1".into(),
            world_name: "Room".into(),
        }]
    );
}

#[test]
fn room_exit_cleanup_does_not_report_friends_as_departed() {
    for batched in [false, true] {
        let mut engine = GameLogIngestEngine::default();
        let mut initial = vec![event(
            1788709924,
            GameLogEventKind::Location {
                location: "wrld_old:1".into(),
                world_name: "Old".into(),
            },
        )];
        for user_id in ["usr_staying", "usr_leaving"] {
            initial.push(event(
                1788709949,
                GameLogEventKind::PlayerJoined {
                    display_name: user_id.into(),
                    user_id: user_id.into(),
                },
            ));
        }
        engine.ingest_events(&initial, GameLogIngestOptions::default());
        let events = [
            event(
                1788709981,
                GameLogEventKind::PlayerLeft {
                    display_name: "usr_leaving".into(),
                    user_id: "usr_leaving".into(),
                },
            ),
            event(
                1788709981,
                GameLogEventKind::LocationDestination {
                    location: "wrld_next:2".into(),
                },
            ),
            event(
                1788709981,
                GameLogEventKind::PlayerLeft {
                    display_name: "usr_staying".into(),
                    user_id: "usr_staying".into(),
                },
            ),
            event(
                1788709982,
                GameLogEventKind::Location {
                    location: "wrld_next:2".into(),
                    world_name: "Next".into(),
                },
            ),
            event(
                1788709992,
                GameLogEventKind::PlayerJoined {
                    display_name: "usr_next".into(),
                    user_id: "usr_next".into(),
                },
            ),
            event(
                1788709993,
                GameLogEventKind::PlayerLeft {
                    display_name: "usr_next".into(),
                    user_id: "usr_next".into(),
                },
            ),
        ];
        let mut output = GameLogIngestOutput::default();
        for chunk in events.chunks(if batched { events.len() } else { 1 }) {
            output.append(engine.ingest_events(chunk, GameLogIngestOptions::default()));
        }

        assert_eq!(output.departed_user_ids, ["usr_leaving", "usr_next"]);
        let staying_rows = output
            .batch
            .join_leave
            .iter()
            .filter(|row| row.user_id == "usr_staying")
            .collect::<Vec<_>>();
        assert_eq!(staying_rows.len(), 2);
        assert_eq!(staying_rows[0].location, "wrld_old:1");
        assert_eq!(staying_rows[0].time, 32_000);
        assert_eq!(staying_rows[1].location, "traveling");
        assert_eq!(staying_rows[1].time, 0);
        assert_eq!(engine.runtime_snapshot().location, "wrld_next:2");
        assert!(engine.runtime_snapshot().players.is_empty());
    }
}

#[test]
fn resource_load_without_write_does_not_emit_runtime_persisted_mirror() {
    let mut engine = GameLogIngestEngine::default();
    let output = engine.ingest_events(
        &[event(
            1778716800,
            GameLogEventKind::ResourceLoad {
                resource_type: "ImageLoad".into(),
                resource_url: "https://example.test/image.png".into(),
            },
        )],
        GameLogIngestOptions {
            log_resource_load: false,
        },
    );

    assert!(output.batch.is_empty());
    assert!(output.runtime_persisted_mirrors.is_empty());
}

#[test]
fn provider_video_vrcx_event_does_not_emit_core_persisted_mirror() {
    let mut engine = GameLogIngestEngine::default();
    let output = engine.ingest_events(
        &[event(
            1778716800,
            GameLogEventKind::Vrcx {
                data: "VideoPlay(PyPyDance) \"https://example.test\",0,10,\"Song (Alpha)\"".into(),
            },
        )],
        GameLogIngestOptions::default(),
    );

    assert!(output.batch.is_empty());
    assert_eq!(output.side_effects.len(), 1);
    assert!(output.runtime_persisted_mirrors.is_empty());
}

#[test]
fn pypy_dance_provider_event_enriches_video_after_generic_playback_log() {
    let mut engine = GameLogIngestEngine::default();
    let video_url = "http://api.pypy.dance/video?id=1234";
    let output = engine.ingest_events(
        &[
            event(
                1778716800,
                GameLogEventKind::Location {
                    location: "wrld_f20326da-f1ac-45fc-a062-609723b097b1:1".into(),
                    world_name: "PyPyDance".into(),
                },
            ),
            event(
                1778716801,
                GameLogEventKind::VideoPlay {
                    video_url: video_url.into(),
                    display_name: String::new(),
                },
            ),
            event(
                1778716802,
                GameLogEventKind::Vrcx {
                    data: format!(
                        "VideoPlay(PyPyDance) \"{video_url}\",0,180,\"1234 : Song Title (Alpha)\""
                    ),
                },
            ),
        ],
        GameLogIngestOptions::default(),
    );

    let [GameLogSideEffect::Video(input)] = output.side_effects.as_slice() else {
        panic!("expected one enriched video side effect");
    };
    assert_eq!(input.video_url, video_url);
    assert_eq!(input.video_id, "1234");
    assert_eq!(input.video_name, "Song Title");
    assert_eq!(input.display_name, "Alpha");
}

#[test]
fn leaving_room_resets_now_playing_for_world_switch_and_rejoin() {
    for destination in ["wrld_next:2", "wrld_current:1"] {
        let mut engine = GameLogIngestEngine::default();
        engine.ingest_events(
            &[
                event(
                    1778716800,
                    GameLogEventKind::Location {
                        location: "wrld_current:1".into(),
                        world_name: "Current World".into(),
                    },
                ),
                event(
                    1778716860,
                    GameLogEventKind::VideoPlay {
                        video_url: "https://example.test/video.mp4".into(),
                        display_name: "Player".into(),
                    },
                ),
            ],
            GameLogIngestOptions::default(),
        );

        let leave_output = engine.ingest_events(
            &[event(
                1778716920,
                GameLogEventKind::LocationDestination {
                    location: destination.into(),
                },
            )],
            GameLogIngestOptions::default(),
        );

        assert_eq!(
            leave_output.side_effects,
            vec![GameLogSideEffect::NowPlayingReset]
        );

        let next_video_output = engine.ingest_events(
            &[event(
                1778716980,
                GameLogEventKind::VideoPlay {
                    video_url: "https://example.test/video.mp4".into(),
                    display_name: "Player".into(),
                },
            )],
            GameLogIngestOptions::default(),
        );

        assert!(matches!(
            next_video_output.side_effects.as_slice(),
            [GameLogSideEffect::Video(_)]
        ));
    }
}

#[test]
fn videos_from_a_closed_game_never_stay_now_playing() {
    let video = |at: i64| {
        event(
            at,
            GameLogEventKind::VideoPlay {
                video_url: format!("https://example.test/{at}.mp4"),
                display_name: "Player".into(),
            },
        )
    };
    let game_closed = GameLogProcessEvent {
        process: GameProcessEvent {
            is_game_running: false,
            is_steamvr_running: false,
            game_changed: false,
        },
        changed_at: 1778717400,
    };

    let mut scanned_first = GameLogIngestEngine::default();
    scanned_first.ingest_events(&[video(1778716860)], GameLogIngestOptions::default());
    assert_eq!(
        scanned_first
            .handle_process_event(game_closed.clone())
            .side_effects,
        vec![GameLogSideEffect::NowPlayingReset]
    );

    let mut closed_first = GameLogIngestEngine::default();
    closed_first.handle_process_event(game_closed);
    let output = closed_first.ingest_events(&[video(1778716860)], GameLogIngestOptions::default());
    assert!(matches!(
        output.side_effects.as_slice(),
        [
            GameLogSideEffect::Video(_),
            GameLogSideEffect::NowPlayingReset
        ]
    ));
}

#[test]
fn player_left_tolerates_missing_join_user_id_when_display_name_is_unique() {
    let mut engine = GameLogIngestEngine::default();
    let output = engine.ingest_events(
        &[
            event(
                1778731200,
                GameLogEventKind::Location {
                    location: "wrld_ingest:1".into(),
                    world_name: "Ingest World".into(),
                },
            ),
            event(
                1778731210,
                GameLogEventKind::PlayerJoined {
                    display_name: "Left Player".into(),
                    user_id: String::new(),
                },
            ),
            event(
                1778731240,
                GameLogEventKind::PlayerLeft {
                    display_name: "Left Player".into(),
                    user_id: "usr_left".into(),
                },
            ),
        ],
        GameLogIngestOptions::default(),
    );

    assert_eq!(output.batch.join_leave.len(), 2);
    assert_eq!(output.batch.join_leave[1].event_type, "OnPlayerLeft");
    assert_eq!(output.batch.join_leave[1].time, 30000);
    assert!(output
        .projection
        .unwrap()
        .current_location_players
        .is_empty());
}

#[test]
fn external_vrcx_event_emits_mirror_when_external_row_is_written() {
    let mut engine = GameLogIngestEngine::default();
    let output = engine.ingest_events(
        &[event(
            1778716800,
            GameLogEventKind::Vrcx {
                data: "UnknownProvider payload".into(),
            },
        )],
        GameLogIngestOptions::default(),
    );

    assert_eq!(output.batch.externals.len(), 1);
    assert_eq!(output.runtime_persisted_mirrors.len(), 1);
    assert_eq!(output.runtime_persisted_mirrors[0][2], "vrcx");
}
