use crate::files;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{fs, path::Path};

pub(crate) fn filter(raw: &str, now: i64) -> Result<(String, usize, i64), String> {
    if raw.len() > 8 * 1024 * 1024
        || !raw
            .lines()
            .take(3)
            .any(|l| l.contains("Netscape HTTP Cookie File") || l.contains("HTTP Cookie File"))
    {
        return Err("Choose a Netscape cookies.txt file (maximum 8 MB)".into());
    }
    let mut result = String::from("# Netscape HTTP Cookie File\n");
    let mut count = 0;
    let mut expiry = i64::MAX;
    for line in raw.lines() {
        let fields: Vec<_> = line
            .strip_prefix("#HttpOnly_")
            .unwrap_or(line)
            .split('\t')
            .collect();
        if fields.len() != 7 {
            continue;
        }
        let domain = fields[0].trim_start_matches('.').to_ascii_lowercase();
        if domain != "youtube.com" && !domain.ends_with(".youtube.com") {
            continue;
        }
        let expires = fields[4]
            .parse::<i64>()
            .map_err(|_| "Invalid cookie expiry")?;
        if expires > 0 && expires <= now {
            continue;
        }
        if expires > 0 {
            expiry = expiry.min(expires);
        }
        result.push_str(line);
        result.push('\n');
        count += 1;
    }
    if count == 0 {
        return Err("No unexpired YouTube cookies found in this file".into());
    }
    Ok((result, count, if expiry == i64::MAX { 0 } else { expiry }))
}
pub(crate) fn store(root: &Path, raw: &str) -> Result<(usize, i64), String> {
    let (text, count, expiry) = filter(raw, chrono::Utc::now().timestamp())?;
    // Per-export obfuscation, not an encryption boundary; only YouTube cookies are retained.
    let seed = format!(
        "{}:{}:{}",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default(),
        std::process::id(),
        root.display()
    );
    use sha2::{Digest, Sha256};
    let key = Sha256::digest(seed.as_bytes());
    let data: Vec<_> = text
        .bytes()
        .enumerate()
        .map(|(i, b)| b ^ key[i % key.len()])
        .collect();
    files::json(
        &root.join("cookies.obf.json"),
        &serde_json::json!({"version":1,"key":STANDARD.encode(key),"data":STANDARD.encode(data)}),
    )?;
    Ok((count, expiry))
}
pub(crate) fn import(root: &Path, path: &Path) -> Result<(usize, i64), String> {
    if path.as_os_str().is_empty() {
        return Err("No cookie file was selected".into());
    }
    let meta = fs::metadata(path).map_err(|e| format!("Cookie file could not be opened: {e}"))?;
    if !meta.is_file() || meta.len() > 8 * 1024 * 1024 {
        return Err("Cookie file exceeds 8 MB or is not a file".into());
    }
    let raw = fs::read_to_string(path).map_err(|_| "Cookie file is not valid UTF-8")?;
    store(root, &raw)
}
pub(crate) struct ExportFile(pub std::path::PathBuf);
impl Drop for ExportFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
