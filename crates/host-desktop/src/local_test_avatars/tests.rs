use std::fs::{File, FileTimes};
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::*;

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-local-test-avatars-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }

    fn write(&self, file_name: &str, content: &[u8], modified_secs: u64) -> PathBuf {
        let path = self.path.join(file_name);
        std::fs::write(&path, content).unwrap();
        File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_times(
                FileTimes::new().set_modified(UNIX_EPOCH + Duration::from_secs(modified_secs)),
            )
            .unwrap();
        path
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[test]
fn lists_only_vrca_files_newest_first() {
    let dir = TestDir::new("list");
    dir.write("Older Avatar.vrca", b"older", 1);
    dir.write("Newer Avatar.vrca", b"newer!", 2);
    dir.write("notes.txt", b"ignored", 3);
    dir.write("upper.VRCA", b"ignored", 4);
    dir.write(".vrca", b"ignored", 5);
    std::fs::create_dir(dir.path.join("folder.vrca")).unwrap();

    let avatars = list_in(&dir.path).unwrap();

    let names: Vec<_> = avatars.iter().map(|avatar| avatar.name.as_str()).collect();
    assert_eq!(names, ["Newer Avatar", "Older Avatar"]);
    assert_eq!(avatars[0].file_name, "Newer Avatar.vrca");
    assert_eq!(avatars[0].size, 6);
    assert_eq!(
        avatars[0].modified_at.as_deref(),
        Some("1970-01-01T00:00:02.000Z")
    );
}

#[test]
fn missing_avatars_directory_lists_nothing() {
    let dir = TestDir::new("missing");

    let avatars = list_in(&dir.path.join("Avatars")).unwrap();

    assert!(avatars.is_empty());
}

#[test]
fn deletes_the_named_test_avatar_only() {
    let dir = TestDir::new("delete");
    let target = dir.write("Target v1..2.vrca", b"target", 1);
    let other = dir.write("Other.vrca", b"other", 1);

    delete_in(&dir.path, "Target v1..2.vrca").unwrap();

    assert!(!target.exists());
    assert!(other.exists());
}

#[test]
fn deleting_an_already_removed_test_avatar_succeeds() {
    let dir = TestDir::new("delete-missing");

    delete_in(&dir.path, "Gone.vrca").unwrap();
}

#[test]
fn delete_rejects_names_outside_the_avatars_directory() {
    let root = TestDir::new("delete-reject");
    let avatars = root.path.join("Avatars");
    std::fs::create_dir_all(&avatars).unwrap();
    let outside = root.write("outside.vrca", b"outside", 1);
    let config = root.write("config.json", b"{}", 1);

    for file_name in [
        "../outside.vrca",
        "..\\outside.vrca",
        "C:outside.vrca",
        "sub/outside.vrca",
        "../config.json",
        "config.json",
        ".vrca",
        "",
    ] {
        assert!(
            delete_in(&avatars, file_name).is_err(),
            "{file_name:?} should be rejected"
        );
    }
    assert!(outside.exists());
    assert!(config.exists());
}

#[test]
fn delete_refuses_directories() {
    let dir = TestDir::new("delete-directory");
    std::fs::create_dir(dir.path.join("folder.vrca")).unwrap();

    assert!(delete_in(&dir.path, "folder.vrca").is_err());
    assert!(dir.path.join("folder.vrca").is_dir());
}
