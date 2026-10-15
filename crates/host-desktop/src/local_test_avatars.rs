use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;
use vrcx_0_platform::Error;

use crate::host_capabilities::{require_host_capability, HostCapability};
use crate::vrchat_paths;

const TEST_AVATAR_EXTENSION: &str = ".vrca";

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalTestAvatarOutput {
    pub file_name: String,
    pub name: String,
    pub size: u64,
    pub modified_at: Option<String>,
}

pub fn list() -> Result<Vec<LocalTestAvatarOutput>, Error> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    list_in(&avatars_dir()?)
}

pub fn delete(file_name: &str) -> Result<(), Error> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    delete_in(&avatars_dir()?, file_name)
}

fn avatars_dir() -> Result<PathBuf, Error> {
    let app_data = vrchat_paths::vrchat_app_data();
    if !app_data.is_absolute() {
        return Err(Error::Custom(
            "VRChat app data directory is not available.".into(),
        ));
    }
    Ok(app_data.join("Avatars"))
}

fn list_in(dir: &Path) -> Result<Vec<LocalTestAvatarOutput>, Error> {
    let read_dir = match fs::read_dir(dir) {
        Ok(read_dir) => read_dir,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };

    let mut candidates = Vec::new();
    for entry in read_dir {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) if error.kind() == ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        let Some(file_name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let Some(name) = file_name.strip_suffix(TEST_AVATAR_EXTENSION) else {
            continue;
        };
        if name.is_empty() {
            continue;
        }

        let metadata = match fs::symlink_metadata(entry.path()) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        if !metadata.file_type().is_file() {
            continue;
        }

        let modified = metadata.modified().ok();
        candidates.push((
            modified.unwrap_or(SystemTime::UNIX_EPOCH),
            LocalTestAvatarOutput {
                name: name.to_string(),
                file_name,
                size: metadata.len(),
                modified_at: modified.map(system_time_to_iso),
            },
        ));
    }

    candidates.sort_by(|(left_modified, left), (right_modified, right)| {
        right_modified
            .cmp(left_modified)
            .then_with(|| left.file_name.cmp(&right.file_name))
    });
    Ok(candidates.into_iter().map(|(_, avatar)| avatar).collect())
}

fn delete_in(dir: &Path, file_name: &str) -> Result<(), Error> {
    let file_name = validate_file_name(file_name)?;
    let path = dir.join(file_name);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if !metadata.file_type().is_file() {
        return Err(Error::Custom(
            "The selected local test avatar is not a regular file.".into(),
        ));
    }

    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn validate_file_name(file_name: &str) -> Result<&str, Error> {
    let is_plain_name = !file_name.is_empty()
        && !file_name.contains('/')
        && !file_name.contains('\\')
        && !file_name.contains(':');
    let has_stem = file_name
        .strip_suffix(TEST_AVATAR_EXTENSION)
        .is_some_and(|stem| !stem.is_empty());
    if is_plain_name && has_stem {
        Ok(file_name)
    } else {
        Err(Error::Custom("Invalid local test avatar file name.".into()))
    }
}

fn system_time_to_iso(time: SystemTime) -> String {
    let timestamp: chrono::DateTime<chrono::Utc> = time.into();
    timestamp.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests;
