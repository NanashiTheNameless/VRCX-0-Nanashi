use std::{path::PathBuf, sync::Arc};

use vrcx_0_persistence::{config::ConfigRepository, DatabaseService};

pub(super) struct TestDir(PathBuf);

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-notification-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub(super) fn test_config(name: &str) -> (TestDir, ConfigRepository) {
    let dir = TestDir::new(name);
    let db = Arc::new(DatabaseService::new(&dir.0.join("VRCX-0.sqlite3")).unwrap());
    (dir, ConfigRepository::new(db))
}
