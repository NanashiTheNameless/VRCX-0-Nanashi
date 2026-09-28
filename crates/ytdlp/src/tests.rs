use super::*;
use std::fs;
struct Fixture {
    dir: PathBuf,
    tools: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "vrcx-ytdlp-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        let tools = dir.join("VRChat/Tools");
        fs::create_dir_all(&tools).unwrap();
        Self { dir, tools }
    }
    fn installation(&self) -> Manifest {
        let m = Manifest {
            version: "test-master".into(),
            game_node_dir: "node".into(),
            ..Default::default()
        };
        files::private_dir(&self.dir.join("versions/test-master")).unwrap();
        fs::write(self.dir.join("versions/test-master/yt-dlp.exe"), b"managed").unwrap();
        m
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}
#[test]
fn disabled_and_no_browser_or_cookies_by_default() {
    let s = Settings::default();
    assert!(!s.enabled);
    assert!(!s.use_cookies);
    assert!(s.browser.is_empty());
}
#[test]
fn browser_profiles_are_single_arguments_and_validated() {
    let mut s = Settings {
        browser: "firefox".into(),
        profile: "a profile with spaces".into(),
        ..Default::default()
    };
    s.validate().unwrap();
    assert_eq!(s.browser_spec(), "firefox:a profile with spaces");
    s.browser = "--exec".into();
    assert!(s.validate().is_err());
    s.browser = "firefox".into();
    s.profile = "x\ny".into();
    assert!(s.validate().is_err());
}
#[test]
fn cookies_retain_only_unexpired_youtube_domains() {
    let raw="# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t9999999999\tSID\tsecret\n.example.com\tTRUE\t/\tTRUE\t0\tAUTH\tother\n.youtube.com.evil.test\tTRUE\t/\tTRUE\t0\tSID\tbad\n.youtube.com\tTRUE\t/\tTRUE\t1\tOLD\told\n";
    let (text, n, _) = cookies::filter(raw, 100).unwrap();
    assert_eq!(n, 1);
    assert!(text.contains("secret"));
    assert!(!text.contains("other"));
    assert!(!text.contains("bad"));
    assert!(!text.contains("old"));
}
#[test]
fn cookies_are_obfuscated_on_disk() {
    let f = Fixture::new();
    cookies::store(
        &f.dir,
        "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tvery-private-cookie\n",
    )
    .unwrap();
    let data = fs::read_to_string(f.dir.join("cookies.obf.json")).unwrap();
    assert!(!data.contains("very-private-cookie"));
    assert!(!f.dir.join("cookies.txt").exists());
}
#[test]
fn installation_and_restore_preserve_originals() {
    let f = Fixture::new();
    let m = f.installation();
    fs::write(f.tools.join("yt-dlp.exe"), b"original").unwrap();
    fs::write(f.tools.join("yt-dlp.conf"), b"original config").unwrap();
    deploy::install(&f.dir, &f.tools, &Settings::default(), &m).unwrap();
    assert_eq!(fs::read(f.tools.join("yt-dlp.exe")).unwrap(), b"managed");
    deploy::restore(&f.tools).unwrap();
    assert_eq!(fs::read(f.tools.join("yt-dlp.exe")).unwrap(), b"original");
    assert_eq!(
        fs::read(f.tools.join("yt-dlp.conf")).unwrap(),
        b"original config"
    );
    deploy::restore(&f.tools).unwrap();
}
#[test]
fn reapply_preserves_a_new_vrchat_executable() {
    let f = Fixture::new();
    let m = f.installation();
    fs::write(f.tools.join("yt-dlp.exe"), b"original").unwrap();
    deploy::install(&f.dir, &f.tools, &Settings::default(), &m).unwrap();
    fs::write(f.tools.join("yt-dlp.exe"), b"vrchat updated original").unwrap();
    deploy::install(&f.dir, &f.tools, &Settings::default(), &m).unwrap();
    deploy::restore(&f.tools).unwrap();
    assert_eq!(
        fs::read(f.tools.join("yt-dlp.exe")).unwrap(),
        b"vrchat updated original"
    );
    assert!(!f.tools.join("yt-dlp.conf").exists());
}
#[test]
fn restore_refuses_to_overwrite_external_changes() {
    let f = Fixture::new();
    let m = f.installation();
    deploy::install(&f.dir, &f.tools, &Settings::default(), &m).unwrap();
    fs::write(f.tools.join("yt-dlp.conf"), b"user changes").unwrap();
    assert!(deploy::restore(&f.tools).is_err());
    assert_eq!(
        fs::read(f.tools.join("yt-dlp.conf")).unwrap(),
        b"user changes"
    );
}
#[test]
fn config_does_not_use_cookies_without_opt_in() {
    let f = Fixture::new();
    let m = f.installation();
    fs::write(f.dir.join("cookies.obf.json"), b"old cookies").unwrap();
    let mut s = Settings::default();
    let config = String::from_utf8(deploy::config(&f.dir, &s, &m).unwrap()).unwrap();
    assert!(!config.contains("nanashi_cookie_file"));
    assert!(!config.contains("cookies-from-browser"));
    s.use_cookies = true;
    let config = String::from_utf8(deploy::config(&f.dir, &s, &m).unwrap()).unwrap();
    assert!(config.contains("player_client=mweb;nanashi_cookie_file="));
}
#[test]
fn checksums_fail_closed() {
    assert!(download::verify(b"bad", "abcd").is_err());
    assert!(download::verify(b"ok", &files::hash(b"ok")).is_ok());
}
#[tokio::test]
async fn cookie_reads_require_both_opt_ins() {
    let f = Fixture::new();
    let r = Runtime::new(f.dir.clone(), f.tools.to_string_lossy().into());
    assert!(r
        .refresh_cookies("firefox".into(), "".into())
        .await
        .unwrap_err()
        .contains("opt in"));
    assert!(r
        .import_cookies("/never/read/me".into())
        .await
        .unwrap_err()
        .contains("opt in"));
    assert!(!f.dir.join("ytdlp").exists());
    r.maintain().await;
    assert!(!f.dir.join("ytdlp").exists());
}

#[test]
fn uninstall_restores_without_network_or_browser_access() {
    let f = Fixture::new();
    let root = f.dir.join("ytdlp");
    files::private_dir(&root).unwrap();
    let m = Manifest {
        version: "test".into(),
        ..Default::default()
    };
    files::private_dir(&root.join("versions/test")).unwrap();
    files::write(&root.join("versions/test/yt-dlp.exe"), b"managed").unwrap();
    fs::write(f.tools.join("yt-dlp.exe"), b"original").unwrap();
    let s = Settings {
        enabled: true,
        tools_path: f.tools.to_string_lossy().into(),
        ..Default::default()
    };
    files::json(&root.join("settings.json"), &s).unwrap();
    deploy::install(&root, &f.tools, &s, &m).unwrap();
    files::write(&root.join("cookies.obf.json"), b"obfuscated").unwrap();
    restore_for_uninstall(&f.dir).unwrap();
    assert_eq!(fs::read(f.tools.join("yt-dlp.exe")).unwrap(), b"original");
    assert!(!root.join("cookies.obf.json").exists());
    assert!(
        !files::read_json::<Settings>(&root.join("settings.json"))
            .unwrap()
            .enabled
    );
}
#[tokio::test]
#[ignore = "Downloads upstream components into an isolated temporary fixture; never reads cookies or touches a real VRChat installation"]
async fn managed_components_smoke() {
    let f = Fixture::new();
    let runtime = Runtime::new(f.dir.clone(), f.tools.to_string_lossy().into());
    let status = runtime
        .configure(Settings {
            enabled: true,
            tools_path: f.tools.to_string_lossy().into(),
            ..Default::default()
        })
        .await
        .unwrap();
    assert!(status.provider_running);
    assert!(!status.settings.use_cookies);
    assert_eq!(status.cookie_count, 0);
    let (_, m) = runtime.snapshot();
    let fixture = f.dir.join("offline-video.json");
    files::json(&fixture, &serde_json::json!({"id":"test", "title":"Offline metadata fixture", "url":"https://example.invalid/not-requested.mp4", "ext":"mp4", "extractor":"test"})).unwrap();
    // --list-extractors exits before plugin loading. Simulate a local metadata file instead.
    let output = process::command(&download::native_yt(&runtime.root, &m))
        .args(["--ignore-config", "--no-plugin-dirs", "--plugin-dirs"])
        .arg(runtime.root.join("plugins"))
        .args([
            "--simulate",
            "--skip-download",
            "--verbose",
            "--load-info-json",
        ])
        .arg(fixture)
        .output()
        .await
        .unwrap();
    assert!(output.status.success());
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("nanashi_cookies"),
        "Custom cookie plugin must load without reading cookies"
    );
    runtime
        .configure(Settings {
            tools_path: f.tools.to_string_lossy().into(),
            ..Default::default()
        })
        .await
        .unwrap();
    assert!(!runtime.status().provider_running);
    assert!(!f.tools.join("yt-dlp.exe").exists());
}

#[tokio::test]
async fn cookie_opt_in_is_enforced_even_when_integration_is_enabled() {
    let f = Fixture::new();
    let r = Runtime::new(f.dir.clone(), f.tools.to_string_lossy().into());
    for (enabled, use_cookies) in [(true, false), (false, true)] {
        {
            let mut state = r.state.lock().unwrap();
            state.settings.enabled = enabled;
            state.settings.use_cookies = use_cookies;
            state.manifest.version = "test".into();
        }
        assert!(r
            .import_cookies("/not/read".into())
            .await
            .unwrap_err()
            .contains("opt in"));
        assert!(r
            .refresh_cookies("firefox".into(), "".into())
            .await
            .unwrap_err()
            .contains("opt in"));
    }
}
#[tokio::test]
async fn selected_cookie_file_is_imported_without_browser_access() {
    let f = Fixture::new();
    let r = Runtime::new(f.dir.clone(), f.tools.to_string_lossy().into());
    files::private_dir(&r.root.join("versions/test")).unwrap();
    files::write(&r.root.join("versions/test/yt-dlp.exe"), b"fake managed").unwrap();
    let cookie_file = f.dir.join("selected.txt");
    fs::write(
        &cookie_file,
        "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tprivate-value\n",
    )
    .unwrap();
    {
        let mut state = r.state.lock().unwrap();
        state.settings.enabled = true;
        state.settings.use_cookies = true;
        state.settings.tools_path = f.tools.to_string_lossy().into();
        state.manifest.version = "test".into();
    }
    let status = r
        .import_cookies(cookie_file.to_string_lossy().into())
        .await
        .unwrap();
    assert_eq!(status.cookie_count, 1);
    assert!(!status.provider_running);
    assert!(!serde_json::to_string(&status)
        .unwrap()
        .contains("private-value"));
    assert!(fs::read_to_string(f.tools.join("yt-dlp.conf"))
        .unwrap()
        .contains("nanashi_cookie_file="));
    r.clear_cookies().await.unwrap();
    assert!(!r.root.join("cookies.obf.json").exists());
    assert!(!fs::read_to_string(f.tools.join("yt-dlp.conf"))
        .unwrap()
        .contains("nanashi_cookie_file="));
}
