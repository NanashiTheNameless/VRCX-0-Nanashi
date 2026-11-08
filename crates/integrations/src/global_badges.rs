//! Fork: the global badge list (`data/global-badges.jsonc`).
//!
//! A copy is compiled into every build. The maintainer's workflow also signs
//! the file with the app updater key and publishes it on the `data-assets`
//! release, so running apps can pick up new awards between releases. Only
//! the whole public file is downloaded, with no credentials and nothing
//! about the user sent along.
use std::collections::HashSet;
use std::time::Duration;

use base64::Engine as _;
use serde::Deserialize;
use vrcx_0_contracts::global_badges::{
    GlobalBadgeCatalog, GlobalBadgeDefinition, GlobalBadgeGrant, GlobalBadgeOverrides,
    GlobalBadgeSource, CUSTOM_AWARD_BADGE,
};
use vrcx_0_http_client::{Policy as HttpPolicy, RequestBuilderExt};

pub const GLOBAL_BADGES_FILE: &str = "global-badges.jsonc";
pub const GLOBAL_BADGES_URL: &str =
    "https://github.com/NanashiTheNameless/VRCX-0-Nanashi/releases/download/data-assets/global-badges.jsonc";
pub const GLOBAL_BADGES_SIGNATURE_URL: &str =
    "https://github.com/NanashiTheNameless/VRCX-0-Nanashi/releases/download/data-assets/global-badges.jsonc.sig";

/// The app updater public key (`plugins.updater.pubkey` in tauri.conf.json),
/// base64 of a minisign public key. A test keeps the two in step.
pub const SIGNING_PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDc2RkU0RTAyMjA2NTBDQ0MKUldUTURHVWdBazcrZGpZaXpiTE9xYTJ1aGpQNURYMHBqOG5WRnhhVHdQSmdWU2EyMHc2ckRPNXIK";

const MAX_BYTES: usize = 1024 * 1024;
const MAX_SIGNATURE_BYTES: usize = 4096;
const LABEL_MAX: usize = 32;
const TEXT_MAX: usize = 300;

#[derive(Debug, thiserror::Error)]
pub enum GlobalBadgesError {
    #[error("global badge list could not be downloaded: {0}")]
    Download(String),
    #[error("global badge list signature is not valid: {0}")]
    Signature(String),
    #[error("global badge list could not be read: {0}")]
    Parse(String),
}

/// Strips `//` and `/* */` comments and trailing commas so the text parses
/// as JSON. Strings are left untouched.
pub fn strip_jsonc(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    let mut in_string = false;
    while i < chars.len() {
        let c = chars[i];
        if in_string {
            out.push(c);
            if c == '\\' && i + 1 < chars.len() {
                out.push(chars[i + 1]);
                i += 2;
                continue;
            }
            if c == '"' {
                in_string = false;
            }
            i += 1;
            continue;
        }
        match c {
            '"' => {
                in_string = true;
                out.push(c);
                i += 1;
            }
            '/' if chars.get(i + 1) == Some(&'/') => {
                while i < chars.len() && chars[i] != '\n' {
                    i += 1;
                }
            }
            '/' if chars.get(i + 1) == Some(&'*') => {
                i += 2;
                while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                    i += 1;
                }
                i += 2;
            }
            ',' => {
                let mut j = i + 1;
                while j < chars.len() && chars[j].is_whitespace() {
                    j += 1;
                }
                if !matches!(chars.get(j), Some('}') | Some(']')) {
                    out.push(c);
                }
                i += 1;
            }
            _ => {
                out.push(c);
                i += 1;
            }
        }
    }
    out
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawFile {
    revision: u32,
    #[serde(default)]
    badges: Vec<RawBadge>,
    #[serde(default)]
    awards: Vec<RawAward>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawBadge {
    #[serde(default)]
    id: String,
    #[serde(default)]
    label: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    icon: String,
    #[serde(default)]
    style: String,
    #[serde(default)]
    animation: String,
    #[serde(default)]
    color_from: String,
    #[serde(default)]
    color_to: String,
    #[serde(default)]
    color_border: String,
    #[serde(default)]
    color_text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawAward {
    #[serde(default)]
    user_id: String,
    #[serde(default)]
    badge: String,
    #[serde(default)]
    reason: String,
    /// Epoch seconds (what the editor writes) or a date string.
    #[serde(default)]
    since: Option<serde_json::Value>,
    #[serde(default)]
    until: Option<serde_json::Value>,
    #[serde(default)]
    label: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    icon: String,
    #[serde(default)]
    style: String,
    #[serde(default)]
    animation: String,
    #[serde(default)]
    color_from: String,
    #[serde(default)]
    color_to: String,
    #[serde(default)]
    color_border: String,
    #[serde(default)]
    color_text: String,
}

fn is_badge_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 40
        && value
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn is_user_id(value: &str) -> bool {
    value.strip_prefix("usr_").is_some_and(|rest| {
        rest.len() == 36 && rest.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
    })
}

/// `#rrggbb` from `#rrggbb`, `rrggbb`, `#rgb` or `rgb`.
fn normalize_hex_color(value: &str) -> Option<String> {
    let hex = value
        .strip_prefix('#')
        .unwrap_or(value)
        .to_ascii_lowercase();
    if !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    match hex.len() {
        6 => Some(format!("#{hex}")),
        3 => Some(format!(
            "#{}",
            hex.chars().flat_map(|c| [c, c]).collect::<String>()
        )),
        _ => None,
    }
}

/// A colour override, or empty (use the style's colour) when absent or bad.
fn color(value: &str, field: &str, problems: &mut Vec<String>) -> String {
    let value = value.trim();
    if value.is_empty() {
        return String::new();
    }
    match normalize_hex_color(value) {
        Some(color) => color,
        None => {
            problems.push(format!("{field} \"{value}\" is not a #rrggbb colour"));
            String::new()
        }
    }
}

fn clip(value: &str, max: usize) -> String {
    value.trim().chars().take(max).collect()
}

fn parse_date(
    value: Option<&serde_json::Value>,
    field: &str,
    problems: &mut Vec<String>,
) -> Result<Option<i64>, ()> {
    match value {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::String(text)) if text.trim().is_empty() => Ok(None),
        Some(value) => match vrcx_0_core::time::epoch_from_json(value) {
            Some(seconds) => Ok(Some(seconds)),
            None => {
                problems.push(format!("{field} {value} is not a date"));
                Err(())
            }
        },
    }
}

/// Parses the badge file. Entries with problems are left out and described
/// in the returned list, so a mistake in one award never hides the others.
pub fn parse_catalog(
    text: &str,
    source: GlobalBadgeSource,
) -> Result<(GlobalBadgeCatalog, Vec<String>), GlobalBadgesError> {
    let raw: RawFile = serde_json::from_str(&strip_jsonc(text))
        .map_err(|error| GlobalBadgesError::Parse(error.to_string()))?;
    let mut problems = Vec::new();
    let mut badges = Vec::new();
    let mut ids = HashSet::new();
    for (index, badge) in raw.badges.into_iter().enumerate() {
        let id = badge.id.trim().to_string();
        if !is_badge_id(&id) {
            problems.push(format!(
                "badge {index}: id \"{id}\" must be lowercase letters, digits and dashes"
            ));
            continue;
        }
        if id == CUSTOM_AWARD_BADGE {
            problems.push(format!(
                "badge {index}: id \"{CUSTOM_AWARD_BADGE}\" is kept for one-off awards"
            ));
            continue;
        }
        if !ids.insert(id.clone()) {
            problems.push(format!("badge \"{id}\" is defined twice"));
            continue;
        }
        let label = clip(&badge.label, LABEL_MAX);
        if label.is_empty() {
            problems.push(format!("badge \"{id}\" has no label"));
            continue;
        }
        let color_from = color(
            &badge.color_from,
            &format!("badge \"{id}\" colorFrom"),
            &mut problems,
        );
        let color_to = color(
            &badge.color_to,
            &format!("badge \"{id}\" colorTo"),
            &mut problems,
        );
        let color_border = color(
            &badge.color_border,
            &format!("badge \"{id}\" colorBorder"),
            &mut problems,
        );
        let color_text = color(
            &badge.color_text,
            &format!("badge \"{id}\" colorText"),
            &mut problems,
        );
        badges.push(GlobalBadgeDefinition {
            id,
            label,
            description: clip(&badge.description, TEXT_MAX),
            icon: clip(&badge.icon, 64),
            style: clip(&badge.style, 32),
            animation: clip(&badge.animation, 96),
            color_from,
            color_to,
            color_border,
            color_text,
        });
    }
    let mut awards = Vec::new();
    for (index, award) in raw.awards.into_iter().enumerate() {
        let user_id = award.user_id.trim().to_string();
        let badge = award.badge.trim().to_string();
        if !is_user_id(&user_id) {
            problems.push(format!(
                "award {index}: \"{user_id}\" is not a VRChat user id"
            ));
            continue;
        }
        if badge == CUSTOM_AWARD_BADGE {
            if clip(&award.label, LABEL_MAX).is_empty() {
                problems.push(format!("award {index}: a custom award needs a label"));
                continue;
            }
        } else if !ids.contains(&badge) {
            problems.push(format!("award {index}: badge \"{badge}\" is not defined"));
            continue;
        }
        let Ok(since) = parse_date(
            award.since.as_ref(),
            &format!("award {index}: since"),
            &mut problems,
        ) else {
            continue;
        };
        let Ok(until) = parse_date(
            award.until.as_ref(),
            &format!("award {index}: until"),
            &mut problems,
        ) else {
            continue;
        };
        if let (Some(since), Some(until)) = (since, until) {
            if until <= since {
                problems.push(format!("award {index}: until must be after since"));
                continue;
            }
        }
        let where_ = format!("award {index}");
        let overrides = GlobalBadgeOverrides {
            label: clip(&award.label, LABEL_MAX),
            description: clip(&award.description, TEXT_MAX),
            icon: clip(&award.icon, 64),
            style: clip(&award.style, 32),
            animation: clip(&award.animation, 96),
            color_from: color(
                &award.color_from,
                &format!("{where_}: colorFrom"),
                &mut problems,
            ),
            color_to: color(
                &award.color_to,
                &format!("{where_}: colorTo"),
                &mut problems,
            ),
            color_border: color(
                &award.color_border,
                &format!("{where_}: colorBorder"),
                &mut problems,
            ),
            color_text: color(
                &award.color_text,
                &format!("{where_}: colorText"),
                &mut problems,
            ),
        };
        awards.push(GlobalBadgeGrant {
            user_id,
            badge,
            reason: clip(&award.reason, TEXT_MAX),
            since,
            until,
            overrides,
        });
    }
    Ok((
        GlobalBadgeCatalog {
            revision: raw.revision,
            badges,
            awards,
            source,
        },
        problems,
    ))
}

/// Checks a Tauri/minisign signature (`.sig` file content, base64) made by
/// the app updater key.
pub fn verify_signature(data: &[u8], signature_base64: &str) -> Result<(), GlobalBadgesError> {
    verify_with_key(data, signature_base64, SIGNING_PUBLIC_KEY)
}

fn decode_base64_text(value: &str) -> Result<String, GlobalBadgesError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(value.trim())
        .map_err(|error| GlobalBadgesError::Signature(error.to_string()))?;
    String::from_utf8(bytes).map_err(|error| GlobalBadgesError::Signature(error.to_string()))
}

fn verify_with_key(
    data: &[u8],
    signature_base64: &str,
    public_key_base64: &str,
) -> Result<(), GlobalBadgesError> {
    let key = minisign_verify::PublicKey::decode(&decode_base64_text(public_key_base64)?)
        .map_err(|error| GlobalBadgesError::Signature(error.to_string()))?;
    let signature = minisign_verify::Signature::decode(&decode_base64_text(signature_base64)?)
        .map_err(|error| GlobalBadgesError::Signature(error.to_string()))?;
    key.verify(data, &signature, false)
        .map_err(|error| GlobalBadgesError::Signature(error.to_string()))
}

async fn download(
    client: &reqwest::Client,
    url: &str,
    max: usize,
) -> Result<Vec<u8>, GlobalBadgesError> {
    let mut response = client
        .get(url)
        .send_with_policy(HttpPolicy::public())
        .await
        .map_err(|error| GlobalBadgesError::Download(error.to_string()))?;
    if !response.status().is_success() {
        return Err(GlobalBadgesError::Download(format!(
            "HTTP {}",
            response.status()
        )));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| GlobalBadgesError::Download(error.to_string()))?
    {
        if bytes.len() + chunk.len() > max {
            return Err(GlobalBadgesError::Download("file is too large".into()));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

/// Downloads the published file and its signature. Returns the text and the
/// signature once the signature checks out; parsing is up to the caller.
pub async fn fetch_signed_catalog() -> Result<(String, String), GlobalBadgesError> {
    vrcx_0_core::tls::install_crypto_provider();
    let client = vrcx_0_http_client::builder()
        .timeout(Duration::from_secs(30))
        // GitHub release downloads redirect to its file host.
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent(vrcx_0_core::user_agent::component_user_agent(
            "global-badges",
        ))
        .build()
        .map_err(|error| GlobalBadgesError::Download(error.to_string()))?;
    let data = download(&client, GLOBAL_BADGES_URL, MAX_BYTES).await?;
    let signature = download(&client, GLOBAL_BADGES_SIGNATURE_URL, MAX_SIGNATURE_BYTES).await?;
    let signature = String::from_utf8(signature)
        .map_err(|error| GlobalBadgesError::Signature(error.to_string()))?;
    verify_signature(&data, &signature)?;
    let text =
        String::from_utf8(data).map_err(|error| GlobalBadgesError::Parse(error.to_string()))?;
    Ok((text, signature))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signing_key_matches_the_updater_key() {
        let config: serde_json::Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../src-tauri/tauri.conf.json"
        )))
        .unwrap();
        assert_eq!(config["plugins"]["updater"]["pubkey"], SIGNING_PUBLIC_KEY);
    }

    #[test]
    fn the_repository_badge_file_parses_without_problems() {
        let text = include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../data/global-badges.jsonc"
        ));
        let (catalog, problems) = parse_catalog(text, GlobalBadgeSource::Embedded).unwrap();
        assert!(problems.is_empty(), "{problems:?}");
        assert!(catalog.revision > 0);
        assert!(!catalog.badges.is_empty());
    }

    #[test]
    fn strips_comments_and_trailing_commas_but_not_strings() {
        let text = r#"{
            // line comment
            "a": "keep // this and /* this */", /* block */
            "b": [1, 2,],
        }"#;
        let value: serde_json::Value = serde_json::from_str(&strip_jsonc(text)).unwrap();
        assert_eq!(value["a"], "keep // this and /* this */");
        assert_eq!(value["b"], serde_json::json!([1, 2]));
    }

    #[test]
    fn skips_bad_entries_and_reports_them() {
        let text = r##"{
            "revision": 3,
            "badges": [
                { "id": "donator", "label": "Donator", "icon": "HandHeart",
                  "colorFrom": "#FF0000", "colorTo": "red",
                  "colorBorder": "f80" },
                { "id": "Bad Id", "label": "x" },
            ],
            "awards": [
                { "userId": "usr_11111111-1111-1111-1111-111111111111", "badge": "donator",
                  "reason": "Thanks", "since": "2026-11-07",
                  "label": "Big Donator", "colorFrom": "#0f0" },
                { "userId": "not-a-user", "badge": "donator" },
                { "userId": "usr_22222222-2222-2222-2222-222222222222", "badge": "missing" },
                { "userId": "usr_33333333-3333-3333-3333-333333333333", "badge": "donator",
                  "since": "2026-11-07", "until": "2026-11-01" },
                { "userId": "usr_44444444-4444-4444-4444-444444444444", "badge": "donator",
                  "since": 1794009600, "until": 1825545600 },
            ],
        }"##;
        let (catalog, problems) = parse_catalog(text, GlobalBadgeSource::Embedded).unwrap();
        assert_eq!(catalog.revision, 3);
        assert_eq!(catalog.badges.len(), 1);
        assert_eq!(catalog.awards.len(), 2);
        assert_eq!(catalog.awards[1].since, Some(1_794_009_600));
        assert_eq!(catalog.awards[1].until, Some(1_825_545_600));
        assert_eq!(catalog.awards[0].since, Some(1_794_009_600));
        assert_eq!(catalog.awards[0].until, None);
        assert_eq!(catalog.awards[0].overrides.label, "Big Donator");
        assert_eq!(catalog.awards[0].overrides.color_from, "#00ff00");
        assert_eq!(catalog.awards[0].overrides.icon, "");
        assert_eq!(catalog.badges[0].color_from, "#ff0000");
        assert_eq!(catalog.badges[0].color_to, "");
        assert_eq!(catalog.badges[0].color_border, "#ff8800");
        assert_eq!(problems.len(), 5, "{problems:?}");
    }

    #[test]
    fn custom_awards_need_a_label_and_no_badge_type_may_take_their_id() {
        let text = r##"{
            "revision": 1,
            "badges": [{ "id": "custom", "label": "Taken" }],
            "awards": [
                { "userId": "usr_11111111-1111-1111-1111-111111111111", "badge": "custom",
                  "label": "First Tester", "description": "Tested build one",
                  "icon": "Rocket", "colorFrom": "#123456" },
                { "userId": "usr_22222222-2222-2222-2222-222222222222", "badge": "custom" },
            ],
        }"##;
        let (catalog, problems) = parse_catalog(text, GlobalBadgeSource::Embedded).unwrap();
        assert!(catalog.badges.is_empty());
        assert_eq!(catalog.awards.len(), 1);
        let award = &catalog.awards[0];
        assert_eq!(award.badge, CUSTOM_AWARD_BADGE);
        assert_eq!(award.overrides.label, "First Tester");
        assert_eq!(award.overrides.description, "Tested build one");
        assert_eq!(award.overrides.icon, "Rocket");
        assert_eq!(award.overrides.color_from, "#123456");
        assert_eq!(problems.len(), 2, "{problems:?}");
    }

    #[test]
    fn rejects_text_that_is_not_json() {
        assert!(parse_catalog("not json", GlobalBadgeSource::Embedded).is_err());
    }

    // Key pair and signature produced with `tauri signer` for these tests only.
    const TEST_PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDBDOTc2RjkyMUI4MzExRkQKUldUOUVZTWJrbStYRE13Qmc4VjV1YnZqYkxNN2RXSmtISEJkVEtEdlhJcXk2cVpzRFlaQjVCRGwK";
    const TEST_SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVUOUVZTWJrbStYRERBSmFxY2dDOVRCTHdaNk1rTVJPOUJDaURDT29QaEl0WU9KTXdpUThzWnhVZGtxcmdMaVFhNHR5a1BQRWU5Ky82eVdoUFFRZXVtRTNsWGk4Uk5HaEF3PQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzk0MDkxMTU3CWZpbGU6Zi5qc29uYwo4VjA2Y0U1b2JYVkF3UHZERmxDRlZMYkVqOFN3WjZLMXh2VXdJNjNlZ0Y4eHNJeENBVkJYQkJ0NWZpOUt0YlJleXMzNkVQelV3Ylc1dSs1YkxySWhCZz09Cg==";

    #[test]
    fn accepts_a_valid_signature_and_rejects_changed_data() {
        let data = b"{\"revision\":1}\n";
        verify_with_key(data, TEST_SIGNATURE, TEST_PUBLIC_KEY).unwrap();
        assert!(verify_with_key(b"{\"revision\":2}\n", TEST_SIGNATURE, TEST_PUBLIC_KEY).is_err());
        assert!(verify_with_key(data, TEST_SIGNATURE, SIGNING_PUBLIC_KEY).is_err());
        assert!(verify_with_key(data, "not base64!", TEST_PUBLIC_KEY).is_err());
    }
}
