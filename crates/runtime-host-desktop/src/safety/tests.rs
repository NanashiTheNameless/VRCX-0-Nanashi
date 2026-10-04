use super::*;
use vrcx_0_application::remote::{VrchatApiFuture, VrchatApiPort};
use vrcx_0_application_core::{
    vrchat_api::{VrchatApiRequest, VrchatApiResponse},
    RemoteMutationGate,
};
use vrcx_0_contracts::activity::ActivityKind;

const USER: &str = "usr_11111111-1111-1111-1111-111111111111";
const SELF: &str = "usr_22222222-2222-2222-2222-222222222222";
const GROUP: &str = "grp_33333333-3333-3333-3333-333333333333";
const AVATAR: &str = "avtr_44444444-4444-4444-4444-444444444444";

struct Fixture {
    runtime: Arc<SafetyRuntime>,
    receiver: tokio::sync::mpsc::Receiver<SafetyJob>,
    dir: std::path::PathBuf,
}
impl Fixture {
    fn new() -> Self {
        // A counter keeps parallel tests apart: macOS clocks only resolve to
        // microseconds, so two fixtures could otherwise share one database
        // file and fail with "database is locked".
        static NEXT_FIXTURE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "vrcx-safety-{}-{}-{}",
            std::process::id(),
            NEXT_FIXTURE.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let db =
            Arc::new(vrcx_0_persistence::DatabaseService::new(&dir.join("test.sqlite3")).unwrap());
        let config = ConfigRepository::new(db.clone());
        config.ensure_table().unwrap();
        let auth = RuntimeAuthScope::new();
        auth.set(SELF, "https://api.vrchat.cloud/api/1");
        let (runtime, receiver) = SafetyRuntime::new(config, db, auth, ActivityRouter::new());
        Self {
            runtime,
            receiver,
            dir,
        }
    }
    fn observe(&self, kind: GameLogEventKind, origin: GameLogEventOrigin) {
        self.runtime.observe(
            &[GameLogEvent {
                file_name: "output_log.txt".into(),
                created_at: now(),
                kind,
            }],
            origin,
        );
    }
    fn join(&mut self) -> SafetyJob {
        self.observe(join(), GameLogEventOrigin::Live);
        self.receiver.try_recv().unwrap()
    }
    fn source(&self, format: SourceFormat, entries: &[&str], auto: bool, error: &str) {
        let source = SafetySource {
            id: "test".into(),
            name: "Test list".into(),
            url: "https://example.test/list".into(),
            enabled: true,
            format,
            block_users: auto,
            ..Default::default()
        };
        let mut settings = self.runtime.settings();
        settings.sources = vec![source.clone()];
        self.runtime.save_settings(settings).unwrap();
        self.runtime.state.lock().unwrap().caches = vec![SourceCache {
            source_id: source.id,
            url: source.url,
            format,
            entries: entries.iter().map(|s| s.to_string()).collect(),
            updated_at: now(),
            error: error.into(),
            ..Default::default()
        }];
    }
    fn api(&self, response: Value) -> (VrchatApiRuntime, Arc<Port>) {
        let port = Arc::new(Port {
            requests: Mutex::new(Vec::new()),
            response,
            post_status: std::sync::atomic::AtomicI32::new(200),
        });
        (
            VrchatApiRuntime::new(
                self.runtime.auth.clone(),
                Arc::new(RemoteMutationGate::default()),
                port.clone(),
            ),
            port,
        )
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}
fn join() -> GameLogEventKind {
    GameLogEventKind::PlayerJoined {
        user_id: USER.into(),
        display_name: "Visitor".into(),
    }
}
struct Port {
    requests: Mutex<Vec<VrchatApiRequest>>,
    response: Value,
    post_status: std::sync::atomic::AtomicI32,
}
impl VrchatApiPort for Port {
    fn execute(
        &self,
        _: String,
        _: String,
        input: VrchatApiRequest,
        _: VrchatScope,
    ) -> VrchatApiFuture<'_> {
        let status = if input.method.as_deref() == Some("POST") {
            self.post_status.load(std::sync::atomic::Ordering::SeqCst)
        } else {
            200
        };
        self.requests.lock().unwrap().push(input);
        Box::pin(async move {
            Ok(VrchatApiResponse {
                status,
                data: self.response.to_string(),
            })
        })
    }
}

#[test]
fn defaults_do_not_enable_sources_or_mutations() {
    let mut settings = SafetySettings::default();
    settings.validate().unwrap();
    assert!(settings
        .sources
        .iter()
        .all(|s| !s.enabled && s.warn && !s.block_users && s.ban_group_ids.is_empty()));
}
#[test]
fn url_matching_uses_actual_host_and_boundaries() {
    let blocked = vec!["grabify.link".into()];
    for raw in [
        "https://GRABIFY.link/token?secret=foo",
        "https://a.grabify.link./secret",
        "https://safe.test@grabify.link/token",
    ] {
        assert!(!suspicious_url(raw, &blocked, &[], false).unwrap().1);
    }
    for raw in [
        "https://grabify.link.safe.test/",
        "https://notgrabify.link",
        "https://grabify.link@safe.test",
        "https://safe.test/?url=https://grabify.link",
        "file://grabify.link/path",
        "nonsense",
    ] {
        assert!(suspicious_url(raw, &blocked, &[], false).is_none(), "{raw}");
    }
    assert!(suspicious_url(
        "https://a.grabify.link/x",
        &blocked,
        &["grabify.link".into()],
        true
    )
    .is_none());
    assert_eq!(
        suspicious_url("https://bit.ly/xyz", &[], &[], true),
        Some(("bit.ly".into(), true))
    );
    assert!(suspicious_url("https://bit.ly/xyz", &[], &[], false).is_none());
    assert_eq!(
        normalize_domain("BÜCHER.example."),
        Some("xn--bcher-kva.example".into())
    );
}
#[test]
fn list_formats_validate_every_entry_and_deduplicate() {
    assert_eq!(
        parse_source(
            &format!("{AVATAR}\n{AVATAR}\n# comment"),
            SourceFormat::AvatarIds
        )
        .unwrap()
        .len(),
        1
    );
    assert!(parse_source(
        &json!([{"UserId":USER,"UserName":"Visitor"}]).to_string(),
        SourceFormat::UserIds
    )
    .unwrap()
    .contains(USER));
    for raw in ["<html>error</html>", "[]", "[{}]", "[\"usr_bad\"]"] {
        assert!(parse_source(raw, SourceFormat::UserIds).is_err());
    }
    assert!(parse_source(&json!([USER, {}]).to_string(), SourceFormat::UserIds).is_err());
    assert!(parse_source("https://grabify.link/path", SourceFormat::Domains).is_err());
    assert!(
        parse_source("Grabify.link\n# comment", SourceFormat::Domains)
            .unwrap()
            .contains("grabify.link")
    );
}
#[test]
fn validation_rejects_unsafe_or_mistyped_settings() {
    let mut s = SafetySettings::default();
    s.sources[0].block_users = true;
    assert!(s.validate().is_err());
    s.sources[0].block_users = false;
    s.sources[0].url = "http://example.test/list".into();
    assert!(s.validate().is_err());
    s.sources[0].url = "https://name:secret@api.github.com/repos/test/list/contents".into();
    assert!(s.validate().is_err());
    s.sources.clear();
    s.groups.push(WatchEntry {
        id: USER.into(),
        label: String::new(),
        enabled: true,
    });
    assert!(s.validate().is_err());
}
#[test]
fn initial_scan_only_primes_roster_and_never_queues_actions() {
    let mut f = Fixture::new();
    f.observe(join(), GameLogEventOrigin::InitialScan);
    assert!(f.receiver.try_recv().is_err());
    assert!(f.runtime.state.lock().unwrap().players.contains_key(USER));
    f.observe(
        GameLogEventKind::AvatarChange {
            display_name: "Visitor".into(),
            avatar_name: "Watched".into(),
        },
        GameLogEventOrigin::Live,
    );
    assert_eq!(f.receiver.try_recv().unwrap().user_id, USER);
}
#[test]
fn account_instance_policy_and_rejoin_invalidate_old_jobs() {
    let mut f = Fixture::new();
    let job = f.join();
    let settings = f.runtime.settings();
    assert!(f.runtime.current(&job, &settings));
    f.observe(
        GameLogEventKind::PlayerLeft {
            display_name: "Visitor".into(),
            user_id: USER.into(),
        },
        GameLogEventOrigin::Live,
    );
    f.observe(join(), GameLogEventOrigin::Live);
    assert!(!f.runtime.current(&job, &settings));
    let job = f.receiver.try_recv().unwrap();
    f.runtime.save_settings(settings.clone()).unwrap();
    assert!(!f.runtime.current(&job, &settings));
    let job = f.join();
    f.observe(
        GameLogEventKind::Location {
            location: "wrld_new:1".into(),
            world_name: String::new(),
        },
        GameLogEventOrigin::Live,
    );
    assert!(!f.runtime.current(&job, &settings));
    let job = f.join();
    f.runtime
        .auth
        .set("usr_other", "https://api.vrchat.cloud/api/1");
    assert!(!f.runtime.current(&job, &settings));
}
#[tokio::test]
async fn suspicious_url_warns_without_any_network_request_or_secret_in_history() {
    let mut f = Fixture::new();
    let (api, port) = f.api(json!({}));
    f.observe(
        GameLogEventKind::VideoPlay {
            video_url: "https://grabify.link/secret?private=token".into(),
            display_name: "DJ".into(),
        },
        GameLogEventOrigin::Live,
    );
    let job = f.receiver.try_recv().unwrap();
    f.runtime
        .check(job.clone(), &api, &mut HashMap::new())
        .await;
    f.runtime.check(job, &api, &mut HashMap::new()).await;
    assert!(port.requests.lock().unwrap().is_empty());
    let status = f.runtime.status();
    assert_eq!(status.audit.len(), 1);
    assert!(!status.audit[0].message.contains("secret"));
    let entries = f.runtime.overlay.snapshot().entries;
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].kind, ActivityKind::SafetyUrl);
}
#[tokio::test]
async fn warn_only_source_never_mutates_and_disabled_source_never_matches() {
    let mut f = Fixture::new();
    f.source(SourceFormat::UserIds, &[USER], false, "");
    let (api, port) = f.api(json!({}));
    let job = f.join();
    f.runtime.check(job, &api, &mut HashMap::new()).await;
    assert_eq!(f.runtime.status().audit.len(), 1);
    assert!(port.requests.lock().unwrap().is_empty());
    let mut settings = f.runtime.settings();
    settings.sources[0].enabled = false;
    f.runtime.save_settings(settings).unwrap();
    let job = f.join();
    f.runtime.check(job, &api, &mut HashMap::new()).await;
    assert_eq!(f.runtime.status().audit.len(), 1);
}
#[tokio::test]
async fn exact_user_block_is_opt_in_deduplicated_and_logged() {
    let mut f = Fixture::new();
    f.source(SourceFormat::UserIds, &[USER], true, "");
    let (api, port) = f.api(json!({}));
    let job = f.join();
    f.runtime
        .check(job.clone(), &api, &mut HashMap::new())
        .await;
    f.runtime.check(job, &api, &mut HashMap::new()).await;
    assert_eq!(port.requests.lock().unwrap().len(), 1);
    let audit = f.runtime.status().audit;
    assert!(audit
        .iter()
        .any(|a| a.action == "block user" && a.outcome == "success"));
    assert!(audit.iter().any(|a| a.outcome == "attempting"));
}
#[tokio::test]
async fn failed_or_stale_refresh_retains_warning_but_disables_actions() {
    for error in ["server unavailable", ""] {
        let mut f = Fixture::new();
        f.source(SourceFormat::UserIds, &[USER], true, error);
        if error.is_empty() {
            f.runtime.state.lock().unwrap().caches[0].updated_at = "2020-01-01T00:00:00Z".into();
        }
        let (api, port) = f.api(json!({}));
        let job = f.join();
        f.runtime.check(job, &api, &mut HashMap::new()).await;
        assert!(port.requests.lock().unwrap().is_empty());
        assert!(f.runtime.status().audit.iter().any(|a| a.action == "warn"));
        assert!(f
            .runtime
            .status()
            .audit
            .iter()
            .any(|a| a.outcome.starts_with("skipped")));
    }
}
#[tokio::test]
async fn group_ban_requires_current_ownership() {
    for owned in [false, true] {
        let mut f = Fixture::new();
        f.source(SourceFormat::UserIds, &[USER], false, "");
        let mut s = f.runtime.settings();
        s.sources[0].ban_group_ids = vec![GROUP.into()];
        f.runtime.save_settings(s).unwrap();
        let (api, port) = f.api(json!({"ownerId": if owned { SELF } else { USER }}));
        let job = f.join();
        f.runtime.check(job, &api, &mut HashMap::new()).await;
        assert_eq!(
            port.requests
                .lock()
                .unwrap()
                .iter()
                .filter(|r| r.method.as_deref() == Some("POST"))
                .count(),
            usize::from(owned)
        );
    }
}
#[tokio::test]
async fn group_lookup_is_cached_and_warns() {
    let mut f = Fixture::new();
    f.runtime
        .set_watch("group", GROUP.into(), "Watched Group".into(), true)
        .unwrap();
    let (api, port) = f.api(json!([{"groupId":GROUP}]));
    let job = f.join();
    let mut cache = HashMap::new();
    f.runtime.check(job.clone(), &api, &mut cache).await;
    f.runtime.check(job, &api, &mut cache).await;
    assert_eq!(port.requests.lock().unwrap().len(), 1);
    assert_eq!(f.runtime.status().audit[0].event_type, "SafetyGroup");
}
#[tokio::test]
async fn avatar_before_join_is_matched_by_name_only_without_mutations() {
    let mut f = Fixture::new();
    f.runtime
        .set_watch("avatar", AVATAR.into(), "Watched".into(), true)
        .unwrap();
    f.observe(
        GameLogEventKind::AvatarChange {
            display_name: "Visitor".into(),
            avatar_name: "Watched".into(),
        },
        GameLogEventOrigin::Live,
    );
    assert!(f.receiver.try_recv().is_err());
    let job = f.join();
    let (api, port) = f.api(json!({}));
    f.runtime.check(job, &api, &mut HashMap::new()).await;
    assert!(port.requests.lock().unwrap().is_empty());
    assert!(f.runtime.status().audit[0].message.contains("unverified"));
}
#[tokio::test]
async fn avatar_id_embedded_in_name_is_not_identity() {
    let mut f = Fixture::new();
    f.source(SourceFormat::AvatarIds, &[AVATAR], false, "");
    f.observe(join(), GameLogEventOrigin::InitialScan);
    f.observe(
        GameLogEventKind::AvatarChange {
            display_name: "Visitor".into(),
            avatar_name: AVATAR.into(),
        },
        GameLogEventOrigin::Live,
    );
    let job = f.receiver.try_recv().unwrap();
    let (api, port) = f.api(json!({}));
    f.runtime.check(job, &api, &mut HashMap::new()).await;
    assert!(f.runtime.status().audit.is_empty());
    assert!(port.requests.lock().unwrap().is_empty());
}
#[tokio::test]
async fn cached_avatar_metadata_matches_community_ids_and_profile_flags() {
    let mut f = Fixture::new();
    f.source(SourceFormat::AvatarIds, &[AVATAR], false, "");
    vrcx_0_persistence::avatars::avatar_cache_upsert(
        &f.runtime.db,
        vrcx_0_persistence::cache_entities::CacheEntityInput {
            id: json!(AVATAR),
            name: json!("Cached Avatar"),
            author_id: json!(""),
            author_name: json!(""),
            created_at: json!(""),
            description: json!(""),
            image_url: json!(""),
            release_status: json!("public"),
            thumbnail_image_url: json!(""),
            updated_at: json!(""),
            version: json!(1),
        },
    )
    .unwrap();
    f.observe(join(), GameLogEventOrigin::InitialScan);
    f.observe(
        GameLogEventKind::AvatarChange {
            display_name: "Visitor".into(),
            avatar_name: "Cached Avatar".into(),
        },
        GameLogEventOrigin::Live,
    );
    let job = f.receiver.try_recv().unwrap();
    let (api, port) = f.api(json!({}));
    f.runtime.check(job, &api, &mut HashMap::new()).await;
    assert_eq!(f.runtime.status().audit[0].event_type, "SafetyCommunity");
    assert!(port.requests.lock().unwrap().is_empty());
    assert_eq!(f.runtime.entry_sources("avatar", AVATAR), vec!["Test list"]);
}
#[tokio::test]
async fn delayed_mutation_rechecks_policy_before_sending() {
    let mut f = Fixture::new();
    f.source(SourceFormat::UserIds, &[USER], true, "");
    let (api, port) = f.api(json!({}));
    let job = f.join();
    let change = async {
        tokio::time::sleep(Duration::from_millis(30)).await;
        let mut s = f.runtime.settings();
        s.enabled = false;
        f.runtime.save_settings(s).unwrap();
    };
    let mut memberships = HashMap::new();
    tokio::join!(f.runtime.check(job, &api, &mut memberships), change);
    assert!(port.requests.lock().unwrap().is_empty());
}
#[test]
fn changed_source_url_discards_old_matches() {
    let f = Fixture::new();
    f.source(SourceFormat::AvatarIds, &[AVATAR], false, "");
    let mut s = f.runtime.settings();
    s.sources[0].url = "https://different.test/list".into();
    f.runtime.save_settings(s).unwrap();
    assert!(f.runtime.entry_sources("avatar", AVATAR).is_empty());
}

#[test]
fn media_url_tokens_are_extracted_without_following_them() {
    assert_eq!(
        logged_urls(
            "VideoURL: [AVProVideo] Opening 'https://grabify.link/one' (https://bit.ly/two)"
        ),
        vec!["https://grabify.link/one", "https://bit.ly/two"]
    );
}

#[tokio::test]
async fn refreshed_source_removal_cancels_a_pending_mutation() {
    let mut f = Fixture::new();
    f.source(SourceFormat::UserIds, &[USER], true, "");
    let (api, port) = f.api(json!({}));
    let job = f.join();
    let remove = async {
        tokio::time::sleep(Duration::from_millis(30)).await;
        f.runtime.state.lock().unwrap().caches[0].entries.clear();
    };
    let mut memberships = HashMap::new();
    tokio::join!(f.runtime.check(job, &api, &mut memberships), remove);
    assert!(port.requests.lock().unwrap().is_empty());
}
#[tokio::test]
async fn self_is_never_automatically_moderated_and_expired_jobs_are_discarded() {
    let mut f = Fixture::new();
    f.source(SourceFormat::UserIds, &[SELF], true, "");
    f.observe(
        GameLogEventKind::PlayerJoined {
            user_id: SELF.into(),
            display_name: "Me".into(),
        },
        GameLogEventOrigin::Live,
    );
    let job = f.receiver.try_recv().unwrap();
    let (api, port) = f.api(json!({}));
    f.runtime.check(job, &api, &mut HashMap::new()).await;
    assert!(port.requests.lock().unwrap().is_empty());
    let mut expired = f.join();
    expired.queued_at = Instant::now() - Duration::from_secs(121);
    assert!(!f.runtime.current(&expired, &f.runtime.settings()));
}

fn log_row(f: &Fixture, kind: &str) -> SafetyLogRow {
    SafetyLogRow {
        account_user_id: f.runtime.auth.snapshot().current_user_id,
        kind: kind.into(),
        created_at: now(),
        user_id: USER.into(),
        location: "wrld_test:1".into(),
        url: String::new(),
        data: String::new(),
    }
}

#[test]
fn retrospective_badges_use_current_domain_rules_without_actions() {
    let f = Fixture::new();
    let mut row = log_row(&f, "VideoPlay");
    row.url = "https://grabify.link/private?token=hidden".into();
    let warnings = f.runtime.inspect_rows(vec![row.clone()]).unwrap();
    assert_eq!(warnings[0].len(), 1);
    assert!(!warnings[0][0].contains("private"));
    assert!(f.runtime.status().audit.is_empty());
    let mut s = f.runtime.settings();
    s.allowed_domains.push("grabify.link".into());
    f.runtime.save_settings(s).unwrap();
    assert!(f.runtime.inspect_rows(vec![row]).unwrap()[0].is_empty());
}
#[test]
fn row_badges_match_exact_account_location_event_and_respect_limits() {
    let mut f = Fixture::new();
    f.source(SourceFormat::UserIds, &[USER], true, "");
    let row = log_row(&f, "OnPlayerJoined");
    assert_eq!(
        f.runtime.inspect_rows(vec![row.clone()]).unwrap()[0].len(),
        1
    );
    assert!(f.runtime.status().audit.is_empty());
    let mut job = f.join();
    job.location = "wrld_test:1".into();
    f.runtime.record(
        &job,
        "SafetyGroup",
        GROUP,
        "Historical group warning",
        "warn",
        "shown",
    );
    let mut historic = log_row(&f, "OnPlayerLeft");
    historic.kind = job.log_kind.clone();
    historic.location = "another:1".into();
    historic.created_at = job.created_at.clone();
    assert!(!f.runtime.inspect_rows(vec![historic.clone()]).unwrap()[0]
        .iter()
        .any(|m| m.contains("Historical")));
    historic.location = job.location.clone();
    assert!(f.runtime.inspect_rows(vec![historic.clone()]).unwrap()[0]
        .iter()
        .any(|m| m.contains("Historical")));
    historic.account_user_id = "usr_other".into();
    assert!(f.runtime.inspect_rows(vec![historic]).unwrap()[0].is_empty());
    assert!(f.runtime.inspect_rows(vec![row; 201]).is_err());
}
#[tokio::test]
async fn own_avatar_is_confirmed_from_api_without_promoting_other_players_names() {
    let mut f = Fixture::new();
    f.runtime
        .set_watch("avatar", AVATAR.into(), "Same Name".into(), true)
        .unwrap();
    f.observe(
        GameLogEventKind::PlayerJoined {
            user_id: SELF.into(),
            display_name: "Me".into(),
        },
        GameLogEventOrigin::InitialScan,
    );
    f.observe(
        GameLogEventKind::AvatarChange {
            display_name: "Me".into(),
            avatar_name: "Same Name".into(),
        },
        GameLogEventOrigin::Live,
    );
    let job = f.receiver.try_recv().unwrap();
    let (api, port) = f.api(json!({"id":AVATAR,"name":"Same Name"}));
    f.runtime.check(job, &api, &mut HashMap::new()).await;
    let audit = f.runtime.status().audit;
    assert_eq!(audit[0].avatar_id, AVATAR);
    assert!(audit[0].message.contains("confirmed by VRChat API"));
    assert_eq!(port.requests.lock().unwrap().len(), 1);
    assert_eq!(
        port.requests.lock().unwrap()[0].path.as_deref(),
        Some(format!("users/{SELF}/avatar").as_str())
    );
}
#[tokio::test]
async fn mismatched_own_avatar_response_does_not_claim_verified_identity() {
    let mut f = Fixture::new();
    f.runtime
        .set_watch("avatar", AVATAR.into(), "Same Name".into(), true)
        .unwrap();
    f.observe(
        GameLogEventKind::PlayerJoined {
            user_id: SELF.into(),
            display_name: "Me".into(),
        },
        GameLogEventOrigin::InitialScan,
    );
    f.observe(
        GameLogEventKind::AvatarChange {
            display_name: "Me".into(),
            avatar_name: "Same Name".into(),
        },
        GameLogEventOrigin::Live,
    );
    let job = f.receiver.try_recv().unwrap();
    let (api, _) = f.api(json!({"id":AVATAR,"name":"Earlier Avatar"}));
    f.runtime.check(job, &api, &mut HashMap::new()).await;
    assert!(f.runtime.status().audit[0].avatar_id.is_empty());
    assert!(f.runtime.status().audit[0].message.contains("unverified"));
}
fn prepare_avatar_review(f: &Fixture, response: Value) -> (AvatarBlockPreview, Arc<Port>) {
    f.source(SourceFormat::AvatarIds, &[AVATAR], false, "");
    let (api, port) = f.api(response);
    assert!(f
        .runtime
        .api
        .set((
            api,
            vrcx_0_application::avatars::AvatarModerationRuntime::new()
        ))
        .is_ok());
    (f.runtime.avatar_block_preview("test", 0).unwrap(), port)
}
#[tokio::test]
async fn reviewed_avatar_block_requires_explicit_exact_ids_and_is_single_use() {
    let f = Fixture::new();
    let (preview, port) = prepare_avatar_review(&f, json!([]));
    assert!(port.requests.lock().unwrap().is_empty());
    assert!(f
        .runtime
        .block_reviewed_avatars(
            &preview.token,
            vec!["avtr_99999999-9999-9999-9999-999999999999".into()]
        )
        .await
        .is_err());
    assert!(port.requests.lock().unwrap().is_empty());
    let results = f
        .runtime
        .block_reviewed_avatars(&preview.token, vec![AVATAR.into()])
        .await
        .unwrap();
    assert_eq!(results[0].outcome, "success");
    {
        let requests = port.requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert_eq!(
            requests[1].path.as_deref(),
            Some("auth/user/avatarmoderations")
        );
        assert_eq!(requests[1].method.as_deref(), Some("POST"));
    }
    assert!(f
        .runtime
        .block_reviewed_avatars(&preview.token, vec![AVATAR.into()])
        .await
        .is_err());
    let audit = f.runtime.status().audit;
    assert!(audit.iter().any(|a| a.avatar_id == AVATAR
        && a.account_user_id == SELF
        && a.action == "block avatar"
        && a.outcome == "success"));
}
#[tokio::test]
async fn preview_expiry_account_policy_and_list_changes_prevent_avatar_blocks() {
    for change in ["expiry", "account", "policy", "list", "failure"] {
        let f = Fixture::new();
        let (preview, port) = prepare_avatar_review(&f, json!([]));
        match change {
            "expiry" => {
                f.runtime
                    .state
                    .lock()
                    .unwrap()
                    .avatar_review
                    .as_mut()
                    .unwrap()
                    .created = Instant::now() - Duration::from_secs(301)
            }
            "account" => {
                f.runtime.auth.set(USER, "https://api.vrchat.cloud/api/1");
            }
            "policy" => {
                f.runtime.save_settings(f.runtime.settings()).unwrap();
            }
            "list" => f.runtime.state.lock().unwrap().caches[0].entries.clear(),
            _ => f.runtime.state.lock().unwrap().caches[0].error = "HTTP 503".into(),
        }
        assert!(
            f.runtime
                .block_reviewed_avatars(&preview.token, vec![AVATAR.into()])
                .await
                .is_err(),
            "{change}"
        );
        assert!(port.requests.lock().unwrap().is_empty(), "{change}");
    }
}
#[tokio::test]
async fn already_blocked_avatars_are_not_posted_again() {
    let f = Fixture::new();
    let (preview, port) = prepare_avatar_review(
        &f,
        json!([{"targetAvatarId":AVATAR,"avatarModerationType":"block"}]),
    );
    assert_eq!(
        f.runtime
            .block_reviewed_avatars(&preview.token, vec![AVATAR.into()])
            .await
            .unwrap()[0]
            .outcome,
        "already blocked"
    );
    assert_eq!(port.requests.lock().unwrap().len(), 1);
}
#[tokio::test]
async fn cancel_during_rate_wait_stops_before_avatar_mutation() {
    let f = Fixture::new();
    let (preview, port) = prepare_avatar_review(&f, json!([]));
    let stop = async {
        tokio::time::sleep(Duration::from_millis(20)).await;
        f.runtime.cancel_avatar_blocks();
    };
    let (result, _) = tokio::join!(
        f.runtime
            .block_reviewed_avatars(&preview.token, vec![AVATAR.into()]),
        stop
    );
    assert!(result.unwrap()[0].outcome.contains("cancelled"));
    assert!(port
        .requests
        .lock()
        .unwrap()
        .iter()
        .all(|r| r.method.as_deref() == Some("GET")));
}

#[tokio::test]
async fn avatar_block_error_stops_remaining_reviewed_ids() {
    let f = Fixture::new();
    let (_, port) = prepare_avatar_review(&f, json!([]));
    let other = "avtr_55555555-5555-5555-5555-555555555555";
    f.source(SourceFormat::AvatarIds, &[AVATAR, other], false, "");
    let preview = f.runtime.avatar_block_preview("test", 0).unwrap();
    port.post_status
        .store(429, std::sync::atomic::Ordering::SeqCst);
    let results = f
        .runtime
        .block_reviewed_avatars(&preview.token, vec![AVATAR.into(), other.into()])
        .await
        .unwrap();
    assert!(results[0].outcome.contains("429"));
    assert!(results[1].outcome.contains("not attempted"));
    assert_eq!(
        port.requests
            .lock()
            .unwrap()
            .iter()
            .filter(|r| r.method.as_deref() == Some("POST"))
            .count(),
        1
    );
}

#[test]
fn recognises_github_hosted_sources_for_local_mirrors() {
    let defaults = SafetySettings::default();
    let crash = defaults
        .sources
        .iter()
        .find(|s| s.id == "crashavatars")
        .unwrap();
    assert_eq!(
        github_location(crash),
        Some(GithubLocation {
            owner: "minunn".into(),
            repo: "crashavatars".into(),
            path: String::new()
        })
    );
    let blacklist = defaults
        .sources
        .iter()
        .find(|s| s.id == "vrc-blacklist")
        .unwrap();
    assert_eq!(
        github_location(blacklist),
        Some(GithubLocation {
            owner: "notadork21".into(),
            repo: "VRC-Blacklist".into(),
            path: "targets.json".into()
        })
    );
    let other = SafetySource {
        url: "https://example.com/list.txt".into(),
        format: SourceFormat::AvatarIds,
        ..Default::default()
    };
    assert_eq!(github_location(&other), None);
    let traversal = SafetySource {
        url: "https://raw.githubusercontent.com/a/b/main/../secret".into(),
        format: SourceFormat::UserIds,
        ..Default::default()
    };
    // `url` normalises `..`, so the remaining path must still be a plain file path.
    assert!(github_location(&traversal).is_none_or(|location| !location.path.contains("..")));
}

#[test]
fn parses_avatar_lists_from_a_mirror_directory() {
    let dir = std::env::temp_dir().join(format!(
        "vrcx-0-nanashi-safety-mirror-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let a = "avtr_11111111-1111-1111-1111-111111111111";
    let b = "avtr_22222222-2222-2222-2222-222222222222";
    std::fs::write(dir.join("april2026.txt"), format!("{a}\n")).unwrap();
    std::fs::write(dir.join("march2026.txt"), format!("{b}\n{a}\n")).unwrap();
    std::fs::write(
        dir.join("README.md"),
        "avtr_33333333-3333-3333-3333-333333333333",
    )
    .unwrap();
    let location = GithubLocation {
        owner: "o".into(),
        repo: "r".into(),
        path: String::new(),
    };
    let entries = parse_mirror(&dir, &location, SourceFormat::GithubAvatars).unwrap();
    assert_eq!(entries.len(), 2);
    assert!(entries.contains(a) && entries.contains(b));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn global_hide_history_is_kept_apart_from_alerts() {
    let f = Fixture::new();
    let scope = f.runtime.auth.snapshot();
    let alert = f.runtime.global_hide_job(&scope, "");
    f.runtime
        .record(&alert, "SafetyUrl", "host", "alert", "warn", "shown");
    for _ in 0..(AUDIT_LIMIT + 10) {
        let job = f.runtime.global_hide_job(&scope, AVATAR);
        f.runtime
            .record_global_hide(&job, "list", "hide", "global hide avatar", "success");
    }
    let status = f.runtime.status();
    assert_eq!(status.audit.len(), 1);
    assert_eq!(status.audit[0].message, "alert");
    assert_eq!(status.global_hide_audit.len(), AUDIT_LIMIT);
}

#[test]
fn legacy_global_hide_entries_move_out_of_the_alert_history() {
    let f = Fixture::new();
    let scope = f.runtime.auth.snapshot();
    let entry = |action: &str| SafetyAuditEntry {
        account_user_id: scope.current_user_id.clone(),
        event_created_at: String::new(),
        location: String::new(),
        log_kind: String::new(),
        avatar_id: String::new(),
        created_at: now(),
        event_type: "SafetyCommunity".into(),
        user_id: String::new(),
        source: "list".into(),
        message: action.into(),
        action: action.into(),
        outcome: "success".into(),
    };
    let legacy = vec![
        entry("global hide avatar"),
        entry("warn"),
        entry("unblock avatar"),
    ];
    f.runtime
        .config
        .set_json(AUDIT_KEY, &serde_json::to_value(&legacy).unwrap())
        .unwrap();
    let (runtime, _) = SafetyRuntime::new(
        f.runtime.config.clone(),
        f.runtime.db.clone(),
        RuntimeAuthScope::new(),
        ActivityRouter::new(),
    );
    let status = runtime.status();
    assert_eq!(
        status
            .audit
            .iter()
            .map(|e| e.action.as_str())
            .collect::<Vec<_>>(),
        ["warn"]
    );
    assert_eq!(
        status
            .global_hide_audit
            .iter()
            .map(|e| e.action.as_str())
            .collect::<Vec<_>>(),
        ["unblock avatar", "global hide avatar"]
    );
    let stored: Vec<SafetyAuditEntry> =
        serde_json::from_value(f.runtime.config.get_json(AUDIT_KEY, json!([])).unwrap()).unwrap();
    assert_eq!(stored.len(), 1);
}
