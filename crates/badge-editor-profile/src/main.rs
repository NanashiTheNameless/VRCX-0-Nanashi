//! Developer tool for `npm run badges:editor`; never part of the app.
//!
//! Looks up one VRChat profile with the session the installed app saved, so
//! the badge editor can preview a real name, picture and bio. It opens the
//! app database read-only, unseals the session in memory the same way the
//! app does, makes read-only requests for that one user and writes nothing:
//! not the database, not the session, not any cache. Output is one JSON line
//! with only the fields the preview shows.
//!
//! Usage: badge-editor-profile usr_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
use base64::Engine as _;
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::{json, Value};
use vrcx_0_vrchat_client::image_fetcher::ImageFetcher;
use vrcx_0_vrchat_client::web_client::{WebClient, WebExecuteRequest};

const API: &str = "https://api.vrchat.cloud/api/1";

fn is_user_id(value: &str) -> bool {
    value.strip_prefix("usr_").is_some_and(|rest| {
        rest.len() == 36 && rest.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
    })
}

fn saved_session() -> Result<String, String> {
    let paths = vrcx_0_platform::app_paths::AppPaths::resolve().map_err(|e| e.to_string())?;
    let db = Connection::open_with_flags(
        &paths.db_file,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("cannot open the app database: {e}"))?;
    let stored: Option<String> = db
        .query_row(
            "SELECT `value` FROM `cookies` WHERE `key` = 'default'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("cannot read the saved session: {e}"))?;
    let stored = stored.ok_or("VRCX-0-Nanashi has no saved login; log in in the app first")?;
    // In-memory only; `false` keeps this process from ever sealing anything.
    vrcx_0_persistence::secrets::init_secrets(
        vrcx_0_platform::machine_key::derive_secrets_key(),
        false,
    );
    vrcx_0_persistence::secrets::open_secret(&stored)
        .ok_or_else(|| "the saved login cannot be unlocked on this PC".to_string())
}

fn image_mime(bytes: &[u8]) -> &'static str {
    match bytes {
        [0x89, b'P', b'N', b'G', ..] => "image/png",
        [0xFF, 0xD8, ..] => "image/jpeg",
        [b'G', b'I', b'F', ..] => "image/gif",
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => "image/webp",
        _ => "application/octet-stream",
    }
}

async fn image_data_url(fetcher: &ImageFetcher, url: &str) -> Option<String> {
    if url.is_empty() {
        return None;
    }
    let bytes = fetcher.fetch_image(url).await.ok()?;
    if bytes.len() > 4 * 1024 * 1024 {
        return None;
    }
    Some(format!(
        "data:{};base64,{}",
        image_mime(&bytes),
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    ))
}

fn text(user: &Value, key: &str) -> String {
    user.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

async fn lookup(user_id: &str) -> Result<Value, String> {
    let cookies = saved_session()?;
    let version = env!("CARGO_PKG_VERSION");
    let web = WebClient::new(None, Some(&cookies), version).map_err(|e| e.to_string())?;
    let request = WebExecuteRequest::new(format!("{API}/users/{user_id}"), "GET".into());
    let (status, body) = web.execute(request).await.map_err(|e| e.to_string())?;
    if status == 401 {
        return Err("the saved login has expired; log in again in the app".into());
    }
    if !(200..300).contains(&status) {
        return Err(format!("VRChat returned HTTP {status}"));
    }
    let user: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let fetcher = ImageFetcher::new(web.cookie_jar(), None, version).map_err(|e| e.to_string())?;
    // Same order as the app's user dialog: the profile icon and banner, and
    // the avatar image only when the profile asks for it or has nothing else.
    let first = |keys: &[&str]| {
        keys.iter()
            .map(|key| text(&user, key))
            .find(|url| !url.is_empty())
            .unwrap_or_default()
    };
    let icon_url = first(&[
        "iconUrl",
        "userIcon",
        "profilePicOverrideThumbnail",
        "profilePicOverride",
        "currentAvatarThumbnailImageUrl",
    ]);
    let banner_type = text(&user, "bannerType");
    let banner_url = match banner_type.as_str() {
        "color" => String::new(),
        "avatarBanner" => first(&["bannerUrl", "currentAvatarImageUrl"]),
        _ => first(&["bannerUrl", "bannerCustomUrl", "profilePicOverride"]),
    };
    let banner_color = {
        let color = text(&user, "bannerColor");
        if banner_type == "color"
            && color.len() == 6
            && color.chars().all(|c| c.is_ascii_hexdigit())
        {
            format!("#{color}")
        } else {
            String::new()
        }
    };
    Ok(json!({
        "ok": true,
        "id": user_id,
        "displayName": text(&user, "displayName"),
        "bio": text(&user, "bio"),
        "statusDescription": text(&user, "statusDescription"),
        "status": text(&user, "status"),
        "pronouns": text(&user, "pronouns"),
        "tags": user.get("tags").cloned().unwrap_or(Value::Array(vec![])),
        "developerType": text(&user, "developerType"),
        "icon": image_data_url(&fetcher, &icon_url).await,
        "banner": image_data_url(&fetcher, &banner_url).await,
        "bannerColor": banner_color,
    }))
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    vrcx_0_core::tls::install_crypto_provider();
    vrcx_0_core::user_agent::set_app_version(env!("CARGO_PKG_VERSION"));
    let user_id = std::env::args().nth(1).unwrap_or_default();
    let output = if is_user_id(&user_id) {
        lookup(&user_id)
            .await
            .unwrap_or_else(|error| json!({ "ok": false, "error": error }))
    } else {
        json!({ "ok": false, "error": "pass one VRChat user id (usr_...)" })
    };
    println!("{output}");
}
