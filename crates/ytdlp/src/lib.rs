mod cookies;
mod deploy;
mod download;
mod files;
mod model;
mod process;
#[cfg(test)]
mod tests;

use model::Manifest;
pub use model::{YtdlpSettings as Settings, YtdlpStatus as Status};
use process::ManagedChild;
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

struct State {
    settings: Settings,
    manifest: Manifest,
    provider: Option<ManagedChild>,
    message: String,
    busy: bool,
    next_update: Instant,
}
pub struct Runtime {
    root: PathBuf,
    default_tools: String,
    state: Mutex<State>,
    operation: tokio::sync::Mutex<()>,
}
impl Runtime {
    pub fn new(data_dir: PathBuf, default_tools: String) -> Arc<Self> {
        let root = files::without_verbatim_prefix(&data_dir.join("ytdlp"));
        let settings = files::read_json(&root.join("settings.json"));
        let manifest = files::read_json(&root.join("manifest.json"));
        let message = settings
            .as_ref()
            .err()
            .or(manifest.as_ref().err())
            .cloned()
            .unwrap_or_default();
        // An interrupted browser export is never kept as a persistent plaintext cookie store.
        let _ = std::fs::remove_file(root.join("cookie-export.txt"));
        Arc::new(Self {
            root,
            default_tools,
            state: Mutex::new(State {
                settings: settings.unwrap_or_default(),
                manifest: manifest.unwrap_or_default(),
                provider: None,
                message,
                busy: false,
                next_update: Instant::now(),
            }),
            operation: tokio::sync::Mutex::new(()),
        })
    }
    pub fn stop(&self) {
        if let Some(mut child) = self.state.lock().unwrap().provider.take() {
            let _ = child.start_kill();
        }
    }
    pub fn status(&self) -> Status {
        let mut state = self.state.lock().unwrap();
        let running = state
            .provider
            .as_mut()
            .is_some_and(|p| matches!(p.try_wait(), Ok(None)));
        let s = &state.settings;
        let m = &state.manifest;
        Status {
            settings: s.clone(),
            supported: cfg!(any(target_os = "windows", target_os = "linux")),
            installed: !m.version.is_empty(),
            version: m.version.clone(),
            checked_at: m.checked_at.clone(),
            cookies_refreshed_at: m.cookies_refreshed_at.clone(),
            cookie_count: m.cookie_count as u32,
            cookie_expiry: m.cookie_expiry as f64,
            cookie_validated_at: m.cookie_validated_at.clone(),
            cookie_validation: m.cookie_validation.clone(),
            provider_running: running,
            busy: state.busy,
            message: state.message.clone(),
            tools_path: if s.tools_path.is_empty() {
                self.default_tools.clone()
            } else {
                s.tools_path.clone()
            },
        }
    }
    fn snapshot(&self) -> (Settings, Manifest) {
        let s = self.state.lock().unwrap();
        (s.settings.clone(), s.manifest.clone())
    }
    fn save_manifest(&self, m: Manifest) -> Result<(), String> {
        files::json(&self.root.join("manifest.json"), &m)?;
        self.state.lock().unwrap().manifest = m;
        Ok(())
    }
    fn save_settings(&self, s: Settings) -> Result<(), String> {
        files::json(&self.root.join("settings.json"), &s)?;
        self.state.lock().unwrap().settings = s;
        Ok(())
    }
    fn tools(&self, s: &Settings) -> Result<PathBuf, String> {
        files::absolute_tools(if s.tools_path.is_empty() {
            &self.default_tools
        } else {
            &s.tools_path
        })
    }
    async fn stop_provider(&self) {
        let provider = self.state.lock().unwrap().provider.take();
        if let Some(mut child) = provider {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
    }
    async fn provider(&self, m: &Manifest) -> Result<(), String> {
        if self.status().provider_running {
            return Ok(());
        }
        self.stop_provider().await;
        let probe = std::net::TcpListener::bind("127.0.0.1:4416")
            .map_err(|_| "Port 4416 is already in use; stop the other PO-token provider first")?;
        drop(probe);
        let main = download::provider_main(&self.root);
        let mut command = process::command(&download::node(&self.root, m));
        command
            .arg(&main)
            .args(["--host", "127.0.0.1", "--port", "4416"])
            .current_dir(
                main.parent()
                    .and_then(Path::parent)
                    .ok_or("Invalid provider path")?,
            )
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut child = process::spawn(&mut command)?;
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(1))
            .build()
            .map_err(|e| e.to_string())?;
        for _ in 0..30 {
            if child.try_wait().map_err(|e| e.to_string())?.is_some() {
                return Err(
                    "PO-token provider exited before it became ready; repair installation".into(),
                );
            }
            if client
                .get("http://127.0.0.1:4416/ping")
                .send()
                .await
                .is_ok_and(|r| r.status().is_success())
            {
                self.state.lock().unwrap().provider = Some(child);
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        Err("PO-token provider did not become ready".into())
    }
    async fn install(&self) -> Result<(), String> {
        let (s, mut m) = self.snapshot();
        let tools = self.tools(&s)?;
        self.state.lock().unwrap().message =
            "Downloading managed yt-dlp master and Node; setting up the PO-token provider..."
                .into();
        download::yt_update(&self.root, &mut m).await?;
        download::install_node(&self.root, &mut m).await?;
        self.save_manifest(m.clone())?;
        download::install_provider(&self.root, &m).await?;
        let plugin = self.root.join("plugins/nanashi/yt_dlp_plugins/extractor");
        files::private_dir(&plugin)?;
        files::write(
            &plugin.join("nanashi_cookies.py"),
            include_bytes!("../plugin/yt_dlp_plugins/extractor/nanashi_cookies.py"),
        )?;
        self.provider(&m).await?;
        deploy::install(&self.root, &tools, &s, &m)?;
        self.state.lock().unwrap().next_update = Instant::now() + Duration::from_secs(86400);
        Ok(())
    }
    /// Mutating commands are serialized; UI confirmation is required before enabling or reading cookies.
    pub async fn configure(&self, mut settings: Settings) -> Result<Status, String> {
        let _guard = self
            .operation
            .try_lock()
            .map_err(|_| "Another yt-dlp operation is running")?;
        settings.validate()?;
        if !cfg!(any(target_os = "windows", target_os = "linux")) {
            return Err("VRChat yt-dlp integration supports Windows and Linux/Proton".into());
        }
        let (old, _) = self.snapshot();
        if settings.tools_path.is_empty() {
            settings.tools_path = self.default_tools.clone();
        }
        if old.enabled && self.tools(&old)? != self.tools(&settings)? {
            return Err("Disable and restore before changing the Tools folder".into());
        }
        files::private_dir(&self.root)?;
        self.state.lock().unwrap().busy = true;
        let result = async {
            if settings.enabled {
                self.tools(&settings)?;
                self.save_settings(settings)?;
                self.install().await?;
            } else {
                // Turn off maintenance even if a user-edited file needs manual restoration.
                self.save_settings(settings)?;
                self.stop_provider().await;
                if !old.tools_path.is_empty() || !self.default_tools.is_empty() {
                    deploy::restore(&self.tools(&old)?)?;
                }
            }
            Ok(())
        }
        .await;
        self.finish(result)
    }
    fn finish(&self, result: Result<(), String>) -> Result<Status, String> {
        {
            let mut state = self.state.lock().unwrap();
            state.busy = false;
            state.message = result
                .as_ref()
                .err()
                .cloned()
                .unwrap_or_else(|| "Ready".into());
        }
        result.map(|_| self.status())
    }
    pub async fn update(&self) -> Result<Status, String> {
        let _guard = self
            .operation
            .try_lock()
            .map_err(|_| "Another yt-dlp operation is running")?;
        if !self.snapshot().0.enabled {
            return Err("Enable the integration first".into());
        }
        self.state.lock().unwrap().busy = true;
        self.finish(self.install().await)
    }
    fn require_cookies(&self) -> Result<(Settings, Manifest), String> {
        let (s, m) = self.snapshot();
        if !s.enabled || !s.use_cookies {
            return Err("Enable the integration and opt in to cookie use first".into());
        }
        if m.version.is_empty() {
            return Err("Install the integration first".into());
        }
        Ok((s, m))
    }
    fn cookie_result(&self, count: usize, expiry: i64, mut m: Manifest) -> Result<(), String> {
        m.cookies_refreshed_at = chrono::Utc::now().to_rfc3339();
        m.cookie_count = count;
        m.cookie_expiry = expiry;
        m.cookie_validation = "Imported; YouTube acceptance has not been tested".into();
        m.cookie_validated_at.clear();
        self.save_manifest(m.clone())?;
        let (s, _) = self.snapshot();
        if s.enabled {
            deploy::install(&self.root, &self.tools(&s)?, &s, &m)?;
        }
        Ok(())
    }
    pub async fn refresh_cookies(
        &self,
        browser: String,
        profile: String,
    ) -> Result<Status, String> {
        let _guard = self
            .operation
            .try_lock()
            .map_err(|_| "Another yt-dlp operation is running")?;
        let (mut s, m) = self.require_cookies()?;
        s.browser = browser;
        s.profile = profile;
        s.validate()?;
        if s.browser.is_empty() {
            return Err("Select the browser to read cookies from".into());
        }
        self.state.lock().unwrap().busy = true;
        let result=async {
            let export=cookies::ExportFile(self.root.join("cookie-export.txt"));
            files::write(&export.0,b"# Netscape HTTP Cookie File\n")?;
            let mut cmd=process::command(&download::native_yt(&self.root,&m));
            cmd.args(["--ignore-config","--no-cache-dir",
                "--no-plugin-dirs","--no-playlist","--simulate","--skip-download","--socket-timeout","10","--retries","0","--cookies-from-browser"]).arg(s.browser_spec()).arg("--cookies").arg(&export.0).args(["--","https://www.youtube.com/watch?v=BaW_jenozKc"]);
            // Cookie export can succeed even when the metadata request is refused by YouTube.
            let _=process::run(&mut cmd,Duration::from_secs(90)).await?;
            let (count,expiry)=cookies::import(&self.root,&export.0).map_err(|_|"No usable YouTube cookies exported. Check the selected profile. Chromium on Windows may require closing the browser or may prevent decryption; try Firefox or a cookies.txt file.")?;
            self.cookie_result(count,expiry,m)?; self.save_settings(s)?; Ok(())
        }.await;
        self.finish(result)
    }
    pub async fn import_cookies(&self, path: String) -> Result<Status, String> {
        let _guard = self
            .operation
            .try_lock()
            .map_err(|_| "Another yt-dlp operation is running")?;
        let (_, m) = self.require_cookies()?;
        let (count, expiry) = cookies::import(&self.root, Path::new(&path))?;
        self.cookie_result(count, expiry, m)?;
        Ok(self.status())
    }
    pub async fn clear_cookies(&self) -> Result<Status, String> {
        let _guard = self
            .operation
            .try_lock()
            .map_err(|_| "Another yt-dlp operation is running")?;
        let (mut s, mut m) = self.snapshot();
        s.use_cookies = false;
        self.save_settings(s.clone())?;
        if s.enabled {
            deploy::install(&self.root, &self.tools(&s)?, &s, &m)?;
        }
        match std::fs::remove_file(self.root.join("cookies.obf.json")) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
        m.cookie_count = 0;
        m.cookie_expiry = 0;
        m.cookies_refreshed_at.clear();
        m.cookie_validation.clear();
        m.cookie_validated_at.clear();
        self.save_manifest(m)?;
        Ok(self.status())
    }
    pub async fn test_playback(&self) -> Result<Status, String> {
        let _guard = self
            .operation
            .try_lock()
            .map_err(|_| "Another yt-dlp operation is running")?;
        let (s, mut m) = self.snapshot();
        if !s.enabled {
            return Err("Enable the integration first".into());
        }
        self.state.lock().unwrap().busy = true;
        let result=async {
            self.provider(&m).await?;
            let node=download::node(&self.root,&m);
            let mut cmd=process::command(&download::native_yt(&self.root,&m));
            cmd.args(["--ignore-config","--no-cache-dir",
                "--no-plugin-dirs","--no-playlist","--simulate","--skip-download","--no-remote-components","--js-runtimes"]).arg(format!("node:{}",node.display())).arg("--plugin-dirs").arg(self.root.join("plugins"));
            let mut args="youtube:player_client=mweb".to_string();
            if s.use_cookies && self.root.join("cookies.obf.json").is_file() { args.push_str(&format!(";nanashi_cookie_file={}",self.root.join("cookies.obf.json").display())); }
            cmd.arg("--extractor-args").arg(args).args(["--socket-timeout","15","--retries","0","--","https://www.youtube.com/watch?v=BaW_jenozKc"]);
            let (ok,error_line)=process::run_keeping_error_line(&mut cmd,Duration::from_secs(90)).await?;
            m.cookie_validated_at=chrono::Utc::now().to_rfc3339();
            m.cookie_validation=if ok {
                "Test video resolved; this does not guarantee all videos or future cookie validity".into()
            } else {
                let hint="Refresh cookies or try a separate browser profile; check network access and synchronize system time";
                match &error_line {
                    Some(line) => format!("Test failed: {line}. {hint}"),
                    None => format!("Test failed. {hint}"),
                }
            };
            self.save_manifest(m)?;
            if ok {
                Ok(())
            } else {
                tracing::error!(error = error_line.as_deref().unwrap_or("(no ERROR line)"), "yt-dlp playback check failed");
                Err(match error_line {
                    Some(line) => format!("Playback check failed: {line}"),
                    None => "Playback check failed; see the status and troubleshooting tips".into(),
                })
            }
        }.await;
        self.finish(result)
    }
    pub async fn maintain(&self) {
        if !cfg!(any(target_os = "windows", target_os = "linux")) {
            return;
        }
        let Ok(_guard) = self.operation.try_lock() else {
            return;
        };
        let (s, mut m) = self.snapshot();
        if !s.enabled || m.version.is_empty() {
            return;
        }
        let result = async {
            let due = self.state.lock().unwrap().next_update <= Instant::now();
            if due {
                self.state.lock().unwrap().next_update = Instant::now() + Duration::from_secs(3600);
                let last = chrono::DateTime::parse_from_rfc3339(&m.checked_at).ok();
                if last
                    .is_none_or(|t| chrono::Utc::now().signed_duration_since(t).num_hours() >= 24)
                {
                    match download::yt_update(&self.root, &mut m).await {
                        Ok(()) => self.save_manifest(m.clone())?,
                        Err(error) => {
                            self.state.lock().unwrap().message = format!(
                                "Update check failed; retaining the last installed build: {error}"
                            )
                        }
                    }
                }
            }
            self.provider(&m).await?;
            deploy::install(&self.root, &self.tools(&s)?, &s, &m)
        }
        .await;
        if let Err(e) = result {
            self.state.lock().unwrap().message = e;
        }
    }
}

/// Headless recovery entry point for uninstallers. Does not download or read browser cookies.
pub fn restore_for_uninstall(data_dir: &Path) -> Result<(), String> {
    let root = files::without_verbatim_prefix(&data_dir.join("ytdlp"));
    if !root.join("settings.json").is_file() {
        return Ok(());
    }
    let mut settings: Settings = files::read_json(&root.join("settings.json"))?;
    settings.enabled = false;
    files::json(&root.join("settings.json"), &settings)?;
    if !settings.tools_path.is_empty() {
        deploy::restore(&files::absolute_tools(&settings.tools_path)?)?;
    }
    match std::fs::remove_file(root.join("cookies.obf.json")) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }
    let _ = std::fs::remove_file(root.join("cookie-export.txt"));
    Ok(())
}
