use crate::{files, model::Manifest, process};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

pub(crate) const PROVIDER_VERSION: &str = "2.0.0";
fn allowed(host: &str) -> bool {
    matches!(
        host,
        "github.com"
            | "api.github.com"
            | "release-assets.githubusercontent.com"
            | "objects.githubusercontent.com"
            | "codeload.github.com"
            | "nodejs.org"
    )
}
fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("VRCX-0-Nanashi yt-dlp integration")
        .timeout(Duration::from_secs(180))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 5
                && attempt.url().scheme() == "https"
                && attempt.url().host_str().is_some_and(allowed)
            {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|e| e.to_string())
}
pub(crate) async fn fetch(url: &str, limit: usize) -> Result<Vec<u8>, String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "Invalid download URL")?;
    if parsed.scheme() != "https" || !parsed.host_str().is_some_and(allowed) {
        return Err("Untrusted download host".into());
    }
    let mut response = client()?
        .get(parsed)
        .send()
        .await
        .map_err(|_| "Download failed; check the network")?;
    if !response.status().is_success() {
        return Err(format!("Download failed: HTTP {}", response.status()));
    }
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err("Download exceeds size limit".into());
    }
    let mut data = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "Download interrupted")? {
        if data.len() + chunk.len() > limit {
            return Err("Download exceeds size limit".into());
        }
        data.extend_from_slice(&chunk);
    }
    Ok(data)
}
async fn release(repo: &str) -> Result<Value, String> {
    serde_json::from_slice(
        &fetch(
            &format!("https://api.github.com/repos/{repo}/releases/latest"),
            2 * 1024 * 1024,
        )
        .await?,
    )
    .map_err(|_| "Invalid release metadata".into())
}
fn asset<'a>(release: &'a Value, name: &str) -> Result<&'a Value, String> {
    release["assets"]
        .as_array()
        .and_then(|a| a.iter().find(|a| a["name"] == name))
        .ok_or_else(|| format!("Release is missing {name}"))
}
fn checksum(text: &str, name: &str) -> Result<String, String> {
    text.lines()
        .find_map(|line| {
            let mut fields = line.split_whitespace();
            let hash = fields.next()?;
            let file = fields.next()?.trim_start_matches('*');
            (file == name && hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit()))
                .then(|| hash.to_ascii_lowercase())
        })
        .ok_or_else(|| format!("Missing SHA256 for {name}"))
}
pub(crate) fn verify(bytes: &[u8], digest: &str) -> Result<(), String> {
    if files::hash(bytes) != digest.to_ascii_lowercase() {
        Err("Download checksum mismatch".into())
    } else {
        Ok(())
    }
}
pub(crate) async fn yt_update(root: &Path, manifest: &mut Manifest) -> Result<(), String> {
    let info = release("yt-dlp/yt-dlp-master-builds").await?;
    let version = info["tag_name"].as_str().ok_or("Release has no version")?;
    if !version
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-' || b == b'_')
    {
        return Err("Invalid release version".into());
    }
    let dir = root.join("versions").join(version);
    let native = if cfg!(windows) {
        "yt-dlp.exe"
    } else if cfg!(target_arch = "aarch64") {
        "yt-dlp_linux_aarch64"
    } else {
        "yt-dlp_linux"
    };
    if !dir.join("ready").is_file() {
        files::private_dir(&dir)?;
        let sums_url = asset(&info, "SHA2-256SUMS")?["browser_download_url"]
            .as_str()
            .ok_or("Missing checksum URL")?;
        let sums = String::from_utf8(fetch(sums_url, 1024 * 1024).await?)
            .map_err(|_| "Invalid checksums")?;
        for name in ["yt-dlp.exe", native] {
            if dir.join(name).is_file()
                && files::hash(&std::fs::read(dir.join(name)).map_err(|e| e.to_string())?)
                    == checksum(&sums, name)?
            {
                continue;
            }
            let url = asset(&info, name)?["browser_download_url"]
                .as_str()
                .ok_or("Missing binary URL")?;
            let data = fetch(url, 100 * 1024 * 1024).await?;
            verify(&data, &checksum(&sums, name)?)?;
            files::write(&dir.join(name), &data)?;
            files::executable(&dir.join(name))?;
        }
        files::write(&dir.join("ready"), b"1")?;
    }
    manifest.version = version.into();
    manifest.checked_at = chrono::Utc::now().to_rfc3339();
    Ok(())
}
pub(crate) fn native_yt(root: &Path, manifest: &Manifest) -> PathBuf {
    let name = if cfg!(windows) {
        "yt-dlp.exe"
    } else if cfg!(target_arch = "aarch64") {
        "yt-dlp_linux_aarch64"
    } else {
        "yt-dlp_linux"
    };
    root.join("versions").join(&manifest.version).join(name)
}
pub(crate) fn node(root: &Path, manifest: &Manifest) -> PathBuf {
    let dir = root.join(&manifest.node_dir);
    if cfg!(windows) {
        dir.join("node.exe")
    } else {
        dir.join("bin/node")
    }
}
pub(crate) async fn install_node(root: &Path, manifest: &mut Manifest) -> Result<(), String> {
    if !manifest.node_dir.is_empty()
        && node(root, manifest).is_file()
        && root
            .join(&manifest.game_node_dir)
            .join("node.exe")
            .is_file()
    {
        return Ok(());
    }
    // Use the current Node 22 LTS release with upstream SHA256 verification.
    let sums = String::from_utf8(
        fetch(
            "https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt",
            1024 * 1024,
        )
        .await?,
    )
    .map_err(|_| "Invalid Node checksums")?;
    let arch = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    };
    let win_suffix = format!("-win-{arch}.zip");
    let win = sums
        .lines()
        .filter_map(|l| l.split_whitespace().nth(1))
        .find(|n| n.ends_with(&win_suffix))
        .ok_or("Node Windows release missing")?;
    let version = win
        .strip_suffix(&win_suffix)
        .ok_or("Invalid Node filename")?;
    let win_dir = root.join(format!("{version}-win-{arch}"));
    if !win_dir.join("node.exe").is_file() {
        let bytes = fetch(
            &format!("https://nodejs.org/dist/latest-v22.x/{win}"),
            100 * 1024 * 1024,
        )
        .await?;
        verify(&bytes, &checksum(&sums, win)?)?;
        files::unpack_zip(&bytes, root)?;
    }
    manifest.game_node_dir = format!("{version}-win-{arch}");
    if cfg!(windows) {
        manifest.node_dir = manifest.game_node_dir.clone();
        return Ok(());
    }
    let name = format!("{version}-linux-{arch}.tar.xz");
    let bytes = fetch(
        &format!("https://nodejs.org/dist/latest-v22.x/{name}"),
        100 * 1024 * 1024,
    )
    .await?;
    verify(&bytes, &checksum(&sums, &name)?)?;
    let archive = root.join("node-install.tar.xz");
    files::write(&archive, &bytes)?;
    let (ok, _) = process::run(
        process::command(Path::new("tar"))
            .arg("-xJf")
            .arg(&archive)
            .arg("-C")
            .arg(root),
        Duration::from_secs(90),
    )
    .await?;
    if !ok {
        return Err("Unable to extract Node; install tar with xz support".into());
    }
    std::fs::remove_file(archive).map_err(|e| e.to_string())?;
    manifest.node_dir = format!("{version}-linux-{arch}");
    if !node(root, manifest).is_file() {
        return Err("Node extraction incomplete".into());
    }
    Ok(())
}
pub(crate) async fn install_provider(root: &Path, manifest: &Manifest) -> Result<(), String> {
    let home = root.join(format!("bgutil-ytdlp-pot-provider-{PROVIDER_VERSION}"));
    if home.join("ready").is_file() {
        return Ok(());
    }
    let data=fetch(&format!("https://github.com/Brainicism/bgutil-ytdlp-pot-provider/archive/refs/tags/{PROVIDER_VERSION}.zip"),20*1024*1024).await?;
    // Version-pinned provider archive and plugin; checksums are maintained with this integration.
    verify(&data, PROVIDER_SOURCE_SHA256)?;
    files::unpack_zip(&data, root)?;
    let plugin=fetch(&format!("https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/{PROVIDER_VERSION}/bgutil-ytdlp-pot-provider.zip"),2*1024*1024).await?;
    verify(&plugin, PROVIDER_PLUGIN_SHA256)?;
    files::private_dir(&root.join("plugins"))?;
    files::write(&root.join("plugins/bgutil-ytdlp-pot-provider.zip"), &plugin)?;
    let server = home.join("server");
    let node = node(root, manifest);
    let npm = if cfg!(windows) {
        root.join(&manifest.node_dir)
            .join("node_modules/npm/bin/npm-cli.js")
    } else {
        root.join(&manifest.node_dir)
            .join("lib/node_modules/npm/bin/npm-cli.js")
    };
    let old = std::env::var_os("PATH").unwrap_or_default();
    let path = std::env::join_paths(
        std::iter::once(node.parent().unwrap().to_path_buf()).chain(std::env::split_paths(&old)),
    )
    .map_err(|e| e.to_string())?;
    let (ok, output) = process::run_diagnosed(
        process::command(&node)
            .arg(npm)
            .args(["ci", "--no-audit", "--no-fund", "--loglevel=error"])
            .env("PATH", path)
            .current_dir(&server),
        Duration::from_secs(600),
    )
    .await?;
    if !ok {
        tracing::warn!(output = %output, "PO-token provider npm ci failed");
        return Err(installer_error(
            "PO-token provider dependency installation failed; retry installation",
            &output,
        ));
    }
    let (ok, output) = process::run_diagnosed(
        process::command(&node)
            .arg(server.join("node_modules/typescript/bin/tsc"))
            .current_dir(&server),
        Duration::from_secs(120),
    )
    .await?;
    if !ok {
        tracing::warn!(output = %output, "PO-token provider build failed");
        return Err(installer_error("PO-token provider build failed", &output));
    }
    files::write(&home.join("ready"), b"1")
}
fn installer_error(summary: &str, output: &str) -> String {
    match process::last_error_line(output) {
        Some(line) => format!("{summary} ({line})"),
        None => summary.to_string(),
    }
}
pub(crate) fn provider_main(root: &Path) -> PathBuf {
    root.join(format!(
        "bgutil-ytdlp-pot-provider-{PROVIDER_VERSION}/server/build/main.js"
    ))
}
// Updated only after inspecting the pinned upstream release.
const PROVIDER_SOURCE_SHA256: &str =
    "e95324ee24b1b0f1b4ad43d336343afe7cf1914acdf65d9cc1977f51d7b137c2";
const PROVIDER_PLUGIN_SHA256: &str =
    "bce874dfa25896c2798e0f4f8147b7b22e785479eb1e459ab232bf2506c95016";
