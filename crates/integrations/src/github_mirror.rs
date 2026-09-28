//! Fork: local mirrors of small public GitHub repositories (community safety
//! lists). Equivalent to `git clone` + `git pull` without a git binary: check
//! the default branch HEAD commit (cheap, ETag-aware), and when it changes
//! download that exact commit's zip and swap it in atomically.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

const MAX_ZIP_BYTES: usize = 32 * 1024 * 1024;
const MAX_UNPACKED_BYTES: u64 = 128 * 1024 * 1024;
const MAX_FILES: usize = 5000;
const COMMIT_FILE: &str = ".mirror-commit";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HeadCheck {
    /// The ETag matched: HEAD has not moved since the last check.
    NotModified,
    Commit {
        sha: String,
        etag: Option<String>,
    },
}

fn valid_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        && value != "."
        && value != ".."
}

fn valid_sha(value: &str) -> bool {
    value.len() == 40 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(vrcx_0_core::user_agent::component_user_agent(
            "community-lists",
        ))
        .build()
        .map_err(|error| error.to_string())
}

/// Latest commit on the default branch. Sends `If-None-Match` when an ETag is
/// known so an unchanged repo costs a 304 (does not count against the
/// unauthenticated API rate limit).
pub async fn github_head(owner: &str, repo: &str, etag: Option<&str>) -> Result<HeadCheck, String> {
    if !valid_name(owner) || !valid_name(repo) {
        return Err("Invalid GitHub owner or repository name".into());
    }
    let mut request = client(Duration::from_secs(20))?
        .get(format!(
            "https://api.github.com/repos/{owner}/{repo}/commits/HEAD"
        ))
        .header("Accept", "application/vnd.github.sha");
    if let Some(etag) = etag.filter(|value| !value.is_empty()) {
        request = request.header("If-None-Match", etag);
    }
    let response = request.send().await.map_err(|error| error.to_string())?;
    if response.status() == reqwest::StatusCode::NOT_MODIFIED {
        return Ok(HeadCheck::NotModified);
    }
    if !response.status().is_success() {
        return Err(format!(
            "GitHub returned HTTP {} for {owner}/{repo}",
            response.status()
        ));
    }
    let etag = response
        .headers()
        .get("etag")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let sha = response
        .text()
        .await
        .map_err(|error| error.to_string())?
        .trim()
        .to_string();
    if !valid_sha(&sha) {
        return Err("GitHub returned an invalid commit id".into());
    }
    Ok(HeadCheck::Commit { sha, etag })
}

async fn download_commit_zip(owner: &str, repo: &str, sha: &str) -> Result<Vec<u8>, String> {
    let mut response = client(Duration::from_secs(60))?
        .get(format!(
            "https://codeload.github.com/{owner}/{repo}/zip/{sha}"
        ))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "GitHub archive returned HTTP {}",
            response.status()
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        if bytes.len() + chunk.len() > MAX_ZIP_BYTES {
            return Err("Repository archive exceeds 32 MB".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

/// Unpack a GitHub commit zip into `destination`, dropping the archive's
/// top-level `<repo>-<sha>/` folder. Rejects unsafe paths and symlinks.
pub fn unpack_github_zip(bytes: &[u8], destination: &Path) -> Result<(), String> {
    let mut archive =
        zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|error| error.to_string())?;
    if archive.len() > MAX_FILES {
        return Err("Repository archive has too many files".into());
    }
    std::fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    let mut total = 0u64;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        if entry.is_symlink() {
            return Err("Repository archive contains a symlink".into());
        }
        let enclosed = entry.enclosed_name().ok_or("Unsafe archive path")?;
        let relative: PathBuf = enclosed.components().skip(1).collect();
        if relative.as_os_str().is_empty() {
            continue;
        }
        total = total
            .checked_add(entry.size())
            .ok_or("Repository archive too large")?;
        if total > MAX_UNPACKED_BYTES {
            return Err("Repository archive too large".into());
        }
        let target = destination.join(&relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&target).map_err(|error| error.to_string())?;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut data = Vec::new();
        entry
            .read_to_end(&mut data)
            .map_err(|error| error.to_string())?;
        std::fs::write(&target, data).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Commit currently checked out in a mirror, if the mirror is complete.
pub fn mirror_commit(mirror_dir: &Path) -> Option<String> {
    std::fs::read_to_string(mirror_dir.join(COMMIT_FILE))
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| valid_sha(value))
}

/// Download `sha` of `owner/repo` and atomically replace `mirror_dir` with it.
/// On failure the previous mirror is left untouched.
pub async fn update_mirror(
    owner: &str,
    repo: &str,
    sha: &str,
    mirror_dir: &Path,
) -> Result<(), String> {
    if !valid_name(owner) || !valid_name(repo) || !valid_sha(sha) {
        return Err("Invalid mirror target".into());
    }
    let bytes = download_commit_zip(owner, repo, sha).await?;
    let parent = mirror_dir
        .parent()
        .ok_or("Mirror has no parent directory")?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let name = mirror_dir
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid mirror directory name")?;
    let staging = parent.join(format!(".{name}.incoming"));
    let previous = parent.join(format!(".{name}.previous"));
    let _ = std::fs::remove_dir_all(&staging);
    let _ = std::fs::remove_dir_all(&previous);
    let result = unpack_github_zip(&bytes, &staging).and_then(|()| {
        std::fs::write(staging.join(COMMIT_FILE), sha).map_err(|error| error.to_string())
    });
    if let Err(error) = result {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(error);
    }
    if mirror_dir.exists() {
        std::fs::rename(mirror_dir, &previous).map_err(|error| error.to_string())?;
    }
    if let Err(error) = std::fs::rename(&staging, mirror_dir) {
        // Put the old mirror back so the lists keep working.
        if previous.exists() {
            let _ = std::fs::rename(&previous, mirror_dir);
        }
        let _ = std::fs::remove_dir_all(&staging);
        return Err(error.to_string());
    }
    let _ = std::fs::remove_dir_all(&previous);
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "vrcx-0-nanashi-mirror-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn zip_with(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        for (name, contents) in entries {
            writer.start_file(*name, options).unwrap();
            writer.write_all(contents.as_bytes()).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn validates_names_and_shas() {
        assert!(valid_name("minunn") && valid_name("VRC-Blacklist") && valid_name("crashavatars"));
        assert!(!valid_name("../x") && !valid_name("a/b") && !valid_name(".."));
        assert!(valid_sha(&"a".repeat(40)));
        assert!(!valid_sha("abc") && !valid_sha(&"g".repeat(40)));
    }

    #[test]
    fn unpacks_without_the_top_level_folder() {
        let dir = temp_dir("unpack");
        let bytes = zip_with(&[
            ("crashavatars-abc/april2026.txt", "avtr_1"),
            ("crashavatars-abc/sub/readme.md", "hi"),
        ]);
        unpack_github_zip(&bytes, &dir).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("april2026.txt")).unwrap(),
            "avtr_1"
        );
        assert!(dir.join("sub/readme.md").is_file());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn mirror_commit_requires_a_valid_marker() {
        let dir = temp_dir("marker");
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(mirror_commit(&dir), None);
        std::fs::write(dir.join(COMMIT_FILE), format!("{}\n", "b".repeat(40))).unwrap();
        assert_eq!(mirror_commit(&dir), Some("b".repeat(40)));
        let _ = std::fs::remove_dir_all(dir);
    }
}
