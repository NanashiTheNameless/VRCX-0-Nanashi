use crate::{files, model::Manifest, Settings};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

const BACKUP: &str = ".vrcx-nanashi-ytdlp";
#[derive(Default, Serialize, Deserialize)]
struct Journal {
    entries: Vec<Entry>,
}
#[derive(Serialize, Deserialize)]
struct Entry {
    name: String,
    original: Option<String>,
    installed: String,
    #[serde(default)]
    previous: Option<String>,
}
fn journal_path(tools: &Path) -> std::path::PathBuf {
    tools.join(BACKUP).join("journal.json")
}
fn replacement(
    tools: &Path,
    name: &str,
    data: &[u8],
    journal: &mut Journal,
    executable: bool,
) -> Result<(), String> {
    let target = tools.join(name);
    if fs::symlink_metadata(&target).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("Refusing to replace a symlink in VRChat Tools".into());
    }
    let current = fs::read(&target).ok();
    let current_hash = current.as_ref().map(|v| files::hash(v));
    let index = journal.entries.iter().position(|e| e.name == name);
    if let Some(i) = index {
        let entry = &mut journal.entries[i];
        if current_hash.as_deref() == Some(&entry.installed) && entry.installed == files::hash(data)
        {
            return Ok(());
        }
        if current_hash.as_deref() != Some(&entry.installed) && current_hash != entry.original {
            // VRChat can refresh its executable. Preserve that new original before reapplying.
            // Other configuration changes require review instead of overwriting user edits.
            if !executable {
                return Err(format!(
                    "{name} changed outside this app; restore or review it before continuing"
                ));
            }
            if let Some(bytes) = &current {
                files::write(
                    &tools
                        .join(BACKUP)
                        .join(format!("original-{}", files::hash(bytes))),
                    bytes,
                )?;
            }
            entry.original = current_hash;
        }
        entry.previous = Some(entry.installed.clone());
        entry.installed = files::hash(data);
    } else {
        if let Some(bytes) = &current {
            files::write(
                &tools
                    .join(BACKUP)
                    .join(format!("original-{}", files::hash(bytes))),
                bytes,
            )?;
        }
        journal.entries.push(Entry {
            name: name.into(),
            original: current_hash,
            installed: files::hash(data),
            previous: None,
        });
    }
    // Journal first so interrupted installs can always be restored.
    files::json(&journal_path(tools), journal)?;
    files::write(&target, data)?;
    if executable {
        files::executable(&target)?;
    }
    Ok(())
}
pub(crate) fn config(
    root: &Path,
    settings: &Settings,
    manifest: &Manifest,
) -> Result<Vec<u8>, String> {
    let plugins = files::game_path(&root.join("plugins"))?;
    let node = files::game_path(&root.join(&manifest.game_node_dir).join("node.exe"))?;
    let mut lines = vec![
        "# coding: utf-8".to_string(),
        "# Managed by VRCX-0-Nanashi. Restore through Settings > Media.".into(),
        "--ignore-config".into(),
        "--no-cache-dir".into(),
        "--no-plugin-dirs".into(),
        "--no-playlist".into(),
        "--no-update".into(),
        "--no-remote-components".into(),
        format!("--plugin-dirs {}", files::quote(&plugins)),
        format!("--js-runtimes {}", files::quote(&format!("node:{node}"))),
        "--extractor-args \"youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416\"".into(),
    ];
    let mut youtube = "youtube:player_client=mweb".to_string();
    if settings.use_cookies && root.join("cookies.obf.json").is_file() {
        let cookie = files::game_path(&root.join("cookies.obf.json"))?;
        if cookie.contains([',', ';']) {
            return Err("Cookie data path cannot contain commas or semicolons".into());
        }
        youtube.push_str(&format!(";nanashi_cookie_file={cookie}"));
    }
    lines.push(format!("--extractor-args {}", files::quote(&youtube)));
    Ok((lines.join("\n") + "\n").into_bytes())
}
pub(crate) fn install(
    root: &Path,
    tools: &Path,
    settings: &Settings,
    manifest: &Manifest,
) -> Result<(), String> {
    files::private_dir(&tools.join(BACKUP))?;
    let mut journal: Journal = files::read_json(&journal_path(tools))?;
    let cfg = config(root, settings, manifest)?;
    let binary = fs::read(
        root.join("versions")
            .join(&manifest.version)
            .join("yt-dlp.exe"),
    )
    .map_err(|e| e.to_string())?;
    replacement(tools, "yt-dlp.conf", &cfg, &mut journal, false)?;
    replacement(tools, "yt-dlp.exe", &binary, &mut journal, true)
}
pub(crate) fn restore(tools: &Path) -> Result<(), String> {
    if !journal_path(tools).exists() {
        return Ok(());
    }
    let mut journal: Journal = files::read_json(&journal_path(tools))?;
    while let Some(entry) = journal.entries.last() {
        if !["yt-dlp.exe", "yt-dlp.conf"].contains(&entry.name.as_str()) {
            return Err("Invalid restore journal".into());
        }
        let path = tools.join(&entry.name);
        let current = fs::read(&path).ok().map(|b| files::hash(&b));
        if current.as_deref() == Some(&entry.installed)
            || (entry.previous.is_some() && current == entry.previous)
            || current.is_none()
        {
            if let Some(expected) = &entry.original {
                if expected.len() != 64 || !expected.bytes().all(|b| b.is_ascii_hexdigit()) {
                    return Err("Invalid original checksum in restore journal".into());
                }
                let bytes = fs::read(tools.join(BACKUP).join(format!("original-{expected}")))
                    .map_err(|e| e.to_string())?;
                if files::hash(&bytes) != *expected {
                    return Err("Original backup checksum mismatch; restore cancelled".into());
                }
                files::write(&path, &bytes)?;
            } else if path.exists() {
                fs::remove_file(&path).map_err(|e| e.to_string())?;
            }
        } else if current != entry.original {
            return Err(format!(
                "{} changed outside this app; original backup kept in {}",
                entry.name,
                tools.join(BACKUP).display()
            ));
        }
        journal.entries.pop();
        files::json(&journal_path(tools), &journal)?;
    }
    // Keep the original backup for manual recovery; no user content is recursively deleted.
    Ok(())
}
