use super::*;
use crate::profile_backup::{ProfileBackupKind, MAX_PROFILE_DATABASE_BYTES};

struct TestDir(PathBuf);

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-profile-backup-{name}-{}-{nonce}",
            std::process::id()
        ));
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
fn profile_backup_manifest_roundtrips_and_archive_orders_database_first() {
    let dir = TestDir::new("archive-roundtrip");
    let snapshot = dir.0.join(DATABASE_FILE_NAME);
    let archive = dir.0.join("backup.vrcx0backup");
    fs::write(&snapshot, b"sqlite snapshot").unwrap();
    let manifest = create_backup_archive(
        &snapshot,
        &archive,
        ProfileBackupManifestMetadata {
            app_version: "1.2.3".into(),
            db_version: 18,
            created_at: "2026-07-14T07:30:00Z".into(),
            platform: "windows".into(),
            kind: ProfileBackupKind::Manual,
        },
    )
    .unwrap();

    let encoded = serde_json::to_string(&manifest).unwrap();
    assert_eq!(
        serde_json::from_str::<ProfileBackupManifest>(&encoded).unwrap(),
        manifest
    );
    let decoder = zstd::Decoder::new(File::open(archive).unwrap()).unwrap();
    let mut tar = tar::Archive::new(decoder);
    let mut entries = tar.entries().unwrap();

    let mut database_entry = entries.next().unwrap().unwrap();
    assert_eq!(
        database_entry.path().unwrap().as_ref(),
        Path::new(DATABASE_FILE_NAME)
    );
    assert_eq!(database_entry.header().entry_type(), EntryType::Regular);
    assert_eq!(database_entry.header().mode().unwrap(), 0o600);
    assert_eq!(database_entry.header().mtime().unwrap(), 0);
    let mut database_bytes = Vec::new();
    database_entry.read_to_end(&mut database_bytes).unwrap();
    assert_eq!(database_bytes, b"sqlite snapshot");
    drop(database_entry);

    let mut manifest_entry = entries.next().unwrap().unwrap();
    assert_eq!(
        manifest_entry.path().unwrap().as_ref(),
        Path::new(MANIFEST_FILE_NAME)
    );
    assert_eq!(manifest_entry.header().entry_type(), EntryType::Regular);
    assert_eq!(manifest_entry.header().mode().unwrap(), 0o600);
    assert_eq!(manifest_entry.header().mtime().unwrap(), 0);
    let mut manifest_bytes = Vec::new();
    manifest_entry.read_to_end(&mut manifest_bytes).unwrap();
    assert_eq!(
        serde_json::from_slice::<ProfileBackupManifest>(&manifest_bytes).unwrap(),
        manifest
    );
    drop(manifest_entry);

    assert!(entries.next().is_none());
    assert_eq!(manifest.contents[0].bytes, 15);
}

#[test]
fn profile_backup_version_parser_handles_release_suffix_and_rejects_invalid_values() {
    assert_eq!(parse_app_version("1.2.3"), Some([1, 2, 3]));
    assert_eq!(parse_app_version("1.2.3-beta.1"), Some([1, 2, 3]));
    assert_eq!(parse_app_version("1.2"), None);
    assert_eq!(parse_app_version("1.2.x"), None);
    assert_eq!(parse_app_version("1.2.3.4"), None);
}

#[test]
fn profile_backup_rotation_only_removes_old_auto_files() {
    let paths = [
        "VRCX-0-Nanashi-backup-auto-20260714-073000.vrcx0backup",
        "VRCX-0-Nanashi-backup-auto-20260713-073000.vrcx0backup",
        "VRCX-0-Nanashi-backup-auto-20260712-073000.vrcx0backup",
        "VRCX-0-Nanashi-backup-20260711-073000.vrcx0backup",
        "VRCX-0-Nanashi-backup-auto-20260710-073000.vrcx0backup.tmp",
        "notes.txt",
    ]
    .into_iter()
    .map(PathBuf::from)
    .collect::<Vec<_>>();

    assert_eq!(
        select_auto_backups_for_removal(paths, 2),
        vec![PathBuf::from(
            "VRCX-0-Nanashi-backup-auto-20260712-073000.vrcx0backup"
        )]
    );
}

#[test]
fn profile_backup_commit_refuses_existing_target() {
    let dir = TestDir::new("commit-existing");
    let temporary = dir.0.join("backup.tmp");
    let final_path = dir.0.join("backup.vrcx0backup");
    fs::write(&temporary, b"new").unwrap();
    fs::write(&final_path, b"old").unwrap();

    assert!(commit_file_without_overwrite(&temporary, &final_path).is_err());
    assert_eq!(fs::read(&final_path).unwrap(), b"old");
    assert_eq!(fs::read(&temporary).unwrap(), b"new");
}

#[test]
fn profile_backup_commit_falls_back_when_hard_links_are_unsupported() {
    let dir = TestDir::new("commit-fallback");
    let temporary = dir.0.join("backup.tmp");
    let final_path = dir.0.join("backup.vrcx0backup");
    fs::write(&temporary, b"new").unwrap();

    commit_file_without_overwrite_with(&temporary, &final_path, |_, _| {
        Err(io::Error::new(io::ErrorKind::Unsupported, "unsupported"))
    })
    .unwrap();
    assert!(!temporary.exists());
    assert_eq!(fs::read(&final_path).unwrap(), b"new");
}

#[test]
fn profile_backup_rejects_oversized_snapshot_before_creating_archive() {
    let dir = TestDir::new("oversized-snapshot");
    let snapshot = dir.0.join(DATABASE_FILE_NAME);
    let archive = dir.0.join("backup.vrcx0backup");
    File::create(&snapshot)
        .unwrap()
        .set_len(MAX_PROFILE_DATABASE_BYTES + 1)
        .unwrap();

    assert!(matches!(
        create_backup_archive(
            &snapshot,
            &archive,
            ProfileBackupManifestMetadata {
                app_version: "1.2.3".into(),
                db_version: 18,
                created_at: "2026-07-14T07:30:00Z".into(),
                platform: "windows".into(),
                kind: ProfileBackupKind::Manual,
            },
        ),
        Err(Error::InvalidData(_))
    ));
    assert!(!archive.exists());
}

#[cfg(unix)]
#[test]
fn profile_backup_archive_is_private_on_unix() {
    use std::os::unix::fs::PermissionsExt;

    let dir = TestDir::new("private-archive");
    let snapshot = dir.0.join(DATABASE_FILE_NAME);
    let archive = dir.0.join("backup.vrcx0backup");
    fs::write(&snapshot, b"sqlite snapshot").unwrap();

    create_backup_archive(
        &snapshot,
        &archive,
        ProfileBackupManifestMetadata {
            app_version: "1.2.3".into(),
            db_version: 18,
            created_at: "2026-07-14T07:30:00Z".into(),
            platform: "linux".into(),
            kind: ProfileBackupKind::Manual,
        },
    )
    .unwrap();

    assert_eq!(
        fs::metadata(archive).unwrap().permissions().mode() & 0o777,
        0o600
    );
}
