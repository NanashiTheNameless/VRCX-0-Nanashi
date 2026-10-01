use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub fn prepare_executable_path(
    executable: &Path,
    appimage: Option<&Path>,
    version: &str,
) -> PathBuf {
    let Some(appimage) = appimage.filter(|path| !path.as_os_str().is_empty()) else {
        return executable.to_path_buf();
    };
    match rename_versioned_appimage(appimage, version) {
        Ok(path) => path,
        Err(error) => {
            eprintln!("Failed to rename AppImage: {error}");
            appimage.to_path_buf()
        }
    }
}

fn rename_versioned_appimage(path: &Path, version: &str) -> io::Result<PathBuf> {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return Ok(path.to_path_buf());
    };
    let prefix = format!("VRCX-0-Nanashi_{version}_");
    let Some(suffix) = name.strip_prefix(&prefix) else {
        return Ok(path.to_path_buf());
    };
    if !is_packaged_suffix(suffix) || version.is_empty() {
        return Ok(path.to_path_buf());
    }
    let destination = path.with_file_name(format!("VRCX-0-Nanashi_{suffix}"));
    match fs::symlink_metadata(&destination) {
        Ok(_) => return Ok(path.to_path_buf()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    if !fs::symlink_metadata(path)?.file_type().is_file() {
        return Ok(path.to_path_buf());
    }
    fs::rename(path, &destination)?;
    Ok(destination)
}

fn is_packaged_suffix(suffix: &str) -> bool {
    let suffix = suffix.strip_prefix("devkit_").unwrap_or(suffix);
    let suffix = if let Some(preview) = suffix.strip_prefix("preview_") {
        let Some((timestamp, platform)) = preview.split_once('_') else {
            return false;
        };
        let Some((date, time)) = timestamp.split_once('-') else {
            return false;
        };
        if date.len() != 8
            || time.len() != 4
            || !date.bytes().chain(time.bytes()).all(|c| c.is_ascii_digit())
        {
            return false;
        }
        platform
    } else {
        suffix
    };
    matches!(
        suffix,
        "amd64.AppImage"
            | "x86_64.AppImage"
            | "linux_x86_64.AppImage"
            | "aarch64.AppImage"
            | "linux_aarch64.AppImage"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir()
                .join(format!("vrcx-0-appimage-{}-{nonce}", std::process::id()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn release_names_lose_only_the_build_version() {
        let dir = TestDir::new();
        for (version, suffix) in [
            ("3.0.0", "amd64.AppImage"),
            ("3.0.0", "linux_x86_64.AppImage"),
            ("3.0.0-Nightly-c617831", "linux_x86_64.AppImage"),
            ("3.0.0", "devkit_linux_x86_64.AppImage"),
            ("3.0.0", "preview_20261001-1430_linux_x86_64.AppImage"),
        ] {
            let path = dir.0.join(format!("VRCX-0-Nanashi_{version}_{suffix}"));
            fs::write(&path, b"AppImage contents").unwrap();
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
            let renamed = rename_versioned_appimage(&path, version).unwrap();
            assert_eq!(renamed, dir.0.join(format!("VRCX-0-Nanashi_{suffix}")));
            assert!(!path.exists());
            assert_eq!(fs::read(&renamed).unwrap(), b"AppImage contents");
            assert_eq!(
                fs::metadata(&renamed).unwrap().permissions().mode() & 0o777,
                0o755
            );
            assert_eq!(
                rename_versioned_appimage(&renamed, version).unwrap(),
                renamed
            );
            fs::remove_file(renamed).unwrap();
        }
    }

    #[test]
    fn custom_names_and_inner_executables_are_untouched() {
        let dir = TestDir::new();
        for name in [
            "vrcx-0",
            "MyApp.AppImage",
            "MyApp_3.0.0_amd64.AppImage",
            "VRCX-0-Nanashi.AppImage",
            "VRCX-0-Nanashi_linux_x86_64.AppImage",
            "VRCX-0-Nanashi_my_build_amd64.AppImage",
            "VRCX-0-Nanashi_3.0.0_my_custom_build.AppImage",
        ] {
            let path = dir.0.join(name);
            fs::write(&path, b"keep").unwrap();
            assert_eq!(rename_versioned_appimage(&path, "3.0.0").unwrap(), path);
            assert_eq!(fs::read(path).unwrap(), b"keep");
        }
    }

    #[test]
    fn existing_destination_and_broken_symlinks_are_never_replaced() {
        let dir = TestDir::new();
        let path = dir.0.join("VRCX-0-Nanashi_3.0.0_linux_x86_64.AppImage");
        let destination = dir.0.join("VRCX-0-Nanashi_linux_x86_64.AppImage");
        fs::write(&path, b"new").unwrap();
        fs::write(&destination, b"existing").unwrap();
        assert_eq!(rename_versioned_appimage(&path, "3.0.0").unwrap(), path);
        assert_eq!(fs::read(&destination).unwrap(), b"existing");
        fs::remove_file(&destination).unwrap();
        symlink(dir.0.join("missing"), &destination).unwrap();
        assert_eq!(rename_versioned_appimage(&path, "3.0.0").unwrap(), path);
        assert!(fs::symlink_metadata(destination)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(fs::read(path).unwrap(), b"new");
    }

    #[test]
    fn rename_uses_the_outer_path_even_when_the_directory_has_spaces() {
        let dir = TestDir::new();
        let downloads = dir.0.join("My Downloads");
        let mount = dir.0.join(".mount_VRCX/usr/bin");
        fs::create_dir_all(&downloads).unwrap();
        fs::create_dir_all(&mount).unwrap();
        let inner = mount.join("vrcx-0");
        fs::write(&inner, b"inner executable").unwrap();
        let outer = downloads.join("VRCX-0-Nanashi_3.0.0_linux_x86_64.AppImage");
        fs::write(&outer, b"outer image").unwrap();
        let renamed = prepare_executable_path(&inner, Some(&outer), "3.0.0");
        assert_eq!(
            renamed,
            downloads.join("VRCX-0-Nanashi_linux_x86_64.AppImage")
        );
        assert_eq!(fs::read(renamed).unwrap(), b"outer image");
        assert_eq!(fs::read(&inner).unwrap(), b"inner executable");
        assert_eq!(prepare_executable_path(&inner, None, "3.0.0"), inner);
        assert_eq!(
            prepare_executable_path(&inner, Some(Path::new("")), "3.0.0"),
            inner
        );
    }

    #[test]
    fn missing_source_reports_failure_without_creating_a_destination() {
        let dir = TestDir::new();
        let path = dir.0.join("VRCX-0-Nanashi_3.0.0_linux_x86_64.AppImage");
        assert_eq!(
            rename_versioned_appimage(&path, "3.0.0")
                .unwrap_err()
                .kind(),
            io::ErrorKind::NotFound
        );
        assert!(!dir.0.join("VRCX-0-Nanashi_linux_x86_64.AppImage").exists());
        assert_eq!(
            prepare_executable_path(Path::new("/mount/usr/bin/vrcx-0"), Some(&path), "3.0.0"),
            path
        );
    }
}
