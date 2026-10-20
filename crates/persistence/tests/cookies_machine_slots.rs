use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    XChaCha20Poly1305, XNonce,
};
use rusqlite::{params, Connection};
use vrcx_0_persistence::{
    cookies::{
        get_default_cookies, save_default_cookies, save_default_cookies_dropping_other_machines,
    },
    secrets::init_secrets,
    DatabaseService,
};

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn sealed_on_other_machine(plaintext: &str) -> String {
    let cipher = XChaCha20Poly1305::new_from_slice(&[5; 32]).unwrap();
    let nonce = XNonce::from([1; 24]);
    let mut payload = Vec::new();
    payload.extend_from_slice(nonce.as_ref());
    payload.extend_from_slice(&cipher.encrypt(&nonce, plaintext.as_bytes()).unwrap());
    format!("enc1:{}", STANDARD.encode(payload))
}

fn read_raw_cookie(db_path: &Path) -> String {
    Connection::open(db_path)
        .unwrap()
        .query_row(
            "SELECT value FROM cookies WHERE key = 'default'",
            [],
            |row| row.get(0),
        )
        .unwrap()
}

#[test]
fn saved_cookies_keep_other_machine_sessions_until_a_full_clear() {
    let dir = TestDir::new("cookies-machine-slots");
    let db_path = dir.path.join("VRCX-0.sqlite3");
    let windows_cookie = sealed_on_other_machine("windows-cookie");
    let windows_slot = windows_cookie.strip_prefix("enc1:").unwrap().to_string();
    let connection = Connection::open(&db_path).unwrap();
    connection
        .execute_batch("CREATE TABLE cookies (key TEXT PRIMARY KEY, value TEXT);")
        .unwrap();
    connection
        .execute(
            "INSERT INTO cookies (key, value) VALUES ('default', ?1)",
            params![windows_cookie],
        )
        .unwrap();
    drop(connection);

    let db = DatabaseService::new(&db_path).unwrap();
    init_secrets(Some([3; 32]), true);

    assert_eq!(get_default_cookies(&db).unwrap(), None);

    save_default_cookies(&db, "linux-cookie").unwrap();
    save_default_cookies(&db, "linux-cookie-2").unwrap();
    let raw = read_raw_cookie(&db_path);
    assert!(raw.starts_with("enc1:"));
    assert!(raw.ends_with(&format!(",{windows_slot}")));
    assert_eq!(raw.matches(',').count(), 1);
    assert_eq!(
        get_default_cookies(&db).unwrap().as_deref(),
        Some("linux-cookie-2")
    );

    let (own_slot, _) = raw.strip_prefix("enc1:").unwrap().split_once(',').unwrap();
    let windows_first = format!("enc1:{windows_slot},{own_slot}");
    Connection::open(&db_path)
        .unwrap()
        .execute(
            "UPDATE cookies SET value = ?1 WHERE key = 'default'",
            params![windows_first],
        )
        .unwrap();
    assert_eq!(
        get_default_cookies(&db).unwrap().as_deref(),
        Some("linux-cookie-2")
    );
    assert_eq!(read_raw_cookie(&db_path), raw);

    save_default_cookies_dropping_other_machines(&db, "after-logout").unwrap();
    let raw = read_raw_cookie(&db_path);
    assert!(!raw.contains(&windows_slot));
    assert!(!raw.contains(','));
    assert_eq!(
        get_default_cookies(&db).unwrap().as_deref(),
        Some("after-logout")
    );

    drop(db);
}
