use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

pub(crate) fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
pub(crate) fn private_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    Ok(())
}
pub(crate) fn write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let staging = path.with_extension("vrcx-staging");
    // A prior interrupted operation may leave our staging file, never a user file.
    if staging.exists() {
        fs::remove_file(&staging).map_err(|e| e.to_string())?;
    }
    let mut file = options.open(&staging).map_err(|e| e.to_string())?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    drop(file);
    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    fs::rename(staging, path).map_err(|e| e.to_string())
}
pub(crate) fn json<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), String> {
    write(
        path,
        &serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?,
    )
}
pub(crate) fn read_json<T: serde::de::DeserializeOwned + Default>(
    path: &Path,
) -> Result<T, String> {
    match fs::read(path) {
        Ok(v) => serde_json::from_slice(&v)
            .map_err(|_| format!("Invalid settings file: {}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(e) => Err(e.to_string()),
    }
}
pub(crate) fn executable(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    let _ = path;
    Ok(())
}
pub(crate) fn unpack_zip(bytes: &[u8], destination: &Path) -> Result<(), String> {
    let mut archive =
        zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| e.to_string())?;
    if archive.len() > 10000 {
        return Err("Archive has too many files".into());
    }
    let mut total = 0u64;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let relative = entry.enclosed_name().ok_or("Unsafe archive path")?;
        if entry.is_symlink() {
            return Err("Archive symlinks are not supported".into());
        }
        total = total.checked_add(entry.size()).ok_or("Archive too large")?;
        if total > 512 * 1024 * 1024 {
            return Err("Archive too large".into());
        }
        let target = destination.join(relative);
        if entry.is_dir() {
            private_dir(&target)?;
        } else {
            private_dir(target.parent().ok_or("Invalid archive parent")?)?;
            let mut data = Vec::new();
            std::io::Read::read_to_end(&mut entry, &mut data).map_err(|e| e.to_string())?;
            write(&target, &data)?;
        }
    }
    Ok(())
}
pub(crate) fn game_path(path: &Path) -> Result<String, String> {
    let s = path.to_str().ok_or("Path must be UTF-8")?;
    if s.chars().any(|c| c.is_control()) {
        return Err("Control character in path".into());
    }
    #[cfg(target_os = "linux")]
    {
        Ok(format!("Z:{}", s.replace('/', "\\")))
    }
    #[cfg(not(target_os = "linux"))]
    {
        Ok(s.to_string())
    }
}
pub(crate) fn quote(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}
pub(crate) fn absolute_tools(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    if !path.is_absolute()
        || !path.is_dir()
        || path.file_name().and_then(|x| x.to_str()) != Some("Tools")
    {
        return Err(
            "Choose VRChat's existing Tools folder (start VRChat once if it is missing)".into(),
        );
    }
    let path = fs::canonicalize(path).map_err(|e| e.to_string())?;
    if !path
        .parent()
        .is_some_and(|p| p.file_name().and_then(|n| n.to_str()) == Some("VRChat"))
    {
        return Err("Tools folder must be inside VRChat's application data folder".into());
    }
    Ok(path)
}
