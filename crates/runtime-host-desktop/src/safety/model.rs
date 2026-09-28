use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use specta::Type;

pub const SETTINGS_KEY: &str = "safetySettings";
pub const CACHE_KEY: &str = "safetySourceCache";
pub const AUDIT_KEY: &str = "safetyAudit";
/// Fork: per-account global-hide progress and provenance (`account user id -> state`).
pub const GLOBAL_HIDE_KEY: &str = "safetyGlobalHide";

/// Fork: persisted global-hide progress for one VRChat account.
#[derive(Clone, Debug, Default, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct GlobalHideAccountState {
    /// Avatars this app blocked (the only ones the unblock action may touch).
    pub blocked_by_app: BTreeSet<String>,
    /// IDs not to retry: removed/invalid avatars (HTTP 400/404).
    pub skipped: BTreeSet<String>,
    /// UTC day (`YYYY-MM-DD`) that `day_count` belongs to.
    pub day: String,
    pub day_count: u32,
    pub paused: bool,
    /// RFC 3339; no requests before this time.
    pub backoff_until: String,
    pub consecutive_errors: u32,
    pub last_error: String,
    pub last_block_at: String,
}

/// Fork: a player's current avatar name in this instance (from the game log).
#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InstanceAvatar {
    pub display_name: String,
    pub avatar_name: String,
}

/// Fork: explicit unblock review (app-made blocks only).
#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GlobalHideUnblockPreview {
    pub token: String,
    pub account_user_id: String,
    pub ids: Vec<String>,
}

/// Fork: global-hide status for the signed-in account.
#[derive(Clone, Debug, Default, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GlobalHideStatus {
    pub signed_in: bool,
    pub source_names: Vec<String>,
    pub listed: u32,
    pub blocked_by_app: u32,
    pub already_blocked: u32,
    pub skipped: u32,
    pub pending: u32,
    pub today: u32,
    pub daily_cap: u32,
    pub paused: bool,
    pub backoff_until: String,
    pub last_error: String,
    pub unblock_remaining: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SafetySettings {
    pub enabled: bool,
    pub groups: Vec<WatchEntry>,
    pub avatars: Vec<WatchEntry>,
    pub url_warnings: bool,
    pub warn_shorteners: bool,
    pub blocked_domains: Vec<String>,
    pub allowed_domains: Vec<String>,
    pub sources: Vec<SafetySource>,
}

impl Default for SafetySettings {
    fn default() -> Self {
        Self {
            enabled: true,
            groups: Vec::new(), avatars: Vec::new(),
            url_warnings: true, warn_shorteners: true,
            blocked_domains: ["grabify.link", "iplogger.org", "iplogger.com", "iplogger.ru", "2no.co", "yip.su", "blasze.com", "blasze.tk", "ps3cfw.com"].map(str::to_string).to_vec(),
            allowed_domains: Vec::new(),
            sources: vec![
                SafetySource { id: "crashavatars".into(), name: "minunn/crashavatars".into(), url: "https://api.github.com/repos/minunn/crashavatars/contents".into(), format: SourceFormat::GithubAvatars, ..Default::default() },
                SafetySource { id: "vrc-blacklist".into(), name: "notadork21/VRC-Blacklist".into(), url: "https://raw.githubusercontent.com/notadork21/VRC-Blacklist/master/targets.json".into(), format: SourceFormat::UserIds, ..Default::default() },
            ],
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WatchEntry {
    pub id: String,
    /// Optional exact log-name match. It is warning-only, never proof of identity.
    pub label: String,
    pub enabled: bool,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SourceFormat {
    #[default]
    AvatarIds,
    UserIds,
    Domains,
    GithubAvatars,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SafetySource {
    pub id: String,
    pub name: String,
    pub url: String,
    pub format: SourceFormat,
    pub enabled: bool,
    pub warn: bool,
    pub block_users: bool,
    /// Only explicitly listed groups currently owned by the logged-in user.
    pub ban_group_ids: Vec<String>,
    /// Fork: globally hide (VRChat avatar block) every listed avatar, slowly, in
    /// the background. Avatar-ID sources only. Turning it off never unblocks.
    pub global_hide: bool,
}
impl Default for SafetySource {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            url: String::new(),
            format: SourceFormat::default(),
            enabled: false,
            warn: true,
            block_users: false,
            ban_group_ids: Vec::new(),
            global_hide: false,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct SourceCache {
    pub source_id: String,
    pub url: String,
    pub format: SourceFormat,
    pub entries: BTreeSet<String>,
    pub updated_at: String,
    pub last_attempt: String,
    pub error: String,
    /// Fork: commit of the local GitHub mirror the entries were read from.
    pub commit_sha: String,
    /// Fork: ETag of the last `commits/HEAD` response (conditional requests).
    pub etag: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SafetyAuditEntry {
    #[serde(default)]
    pub account_user_id: String,
    #[serde(default)]
    pub event_created_at: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub log_kind: String,
    #[serde(default)]
    pub avatar_id: String,
    pub created_at: String,
    pub event_type: String,
    pub user_id: String,
    pub source: String,
    pub message: String,
    pub action: String,
    pub outcome: String,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SafetyStatus {
    pub sources: Vec<SourceStatus>,
    pub audit: Vec<SafetyAuditEntry>,
    pub dropped_events: u32,
}
#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SourceStatus {
    pub id: String,
    pub count: u32,
    pub updated_at: String,
    pub error: String,
}

pub fn valid_id(value: &str, prefix: &str) -> bool {
    let Some(id) = value.strip_prefix(prefix) else {
        return false;
    };
    id.len() == 36
        && id.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}

pub fn normalize_domain(value: &str) -> Option<String> {
    let value = value.trim().trim_end_matches('.').to_ascii_lowercase();
    if value.is_empty() || value.contains(['/', ':', '@', '*', ' ', '\\']) {
        return None;
    }
    let host = url::Host::parse(&value).ok()?;
    match host {
        url::Host::Domain(domain)
            if domain.contains('.')
                && domain.split('.').all(|part| {
                    !part.is_empty() && !part.starts_with('-') && !part.ends_with('-')
                }) =>
        {
            Some(domain)
        }
        _ => None,
    }
}

pub fn domain_matches(host: &str, domain: &str) -> bool {
    host == domain
        || host
            .strip_suffix(domain)
            .is_some_and(|prefix| prefix.ends_with('.'))
}

/// Parse the host only. This function never performs DNS or HTTP requests.
pub fn suspicious_url(
    raw: &str,
    blocked: &[String],
    allowed: &[String],
    shorteners: bool,
) -> Option<(String, bool)> {
    let url = url::Url::parse(raw.trim()).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    let host = url.host_str()?.trim_end_matches('.').to_ascii_lowercase();
    if allowed.iter().any(|d| domain_matches(&host, d)) {
        return None;
    }
    if blocked.iter().any(|d| domain_matches(&host, d)) {
        return Some((host, false));
    }
    if shorteners
        && [
            "bit.ly",
            "tinyurl.com",
            "t.co",
            "is.gd",
            "cutt.ly",
            "rebrand.ly",
            "shorturl.at",
        ]
        .iter()
        .any(|d| domain_matches(&host, d))
    {
        return Some((host, true));
    }
    None
}

impl SafetySettings {
    pub fn validate(&mut self) -> Result<(), String> {
        if self.groups.len() + self.avatars.len() > 10_000 || self.sources.len() > 32 {
            return Err("Too many watchlist entries or sources".into());
        }
        for (entries, prefix) in [(&mut self.groups, "grp_"), (&mut self.avatars, "avtr_")] {
            let mut seen = BTreeSet::new();
            for entry in entries {
                entry.id = entry.id.trim().to_ascii_lowercase();
                entry.label = entry.label.trim().to_string();
                if !valid_id(&entry.id, prefix)
                    || !seen.insert(entry.id.clone())
                    || entry.label.len() > 256
                {
                    return Err(format!("Invalid or duplicate watchlist ID: {}", entry.id));
                }
            }
        }
        for domains in [&mut self.blocked_domains, &mut self.allowed_domains] {
            if domains.len() > 10_000 {
                return Err("Too many domains".into());
            }
            for domain in domains.iter_mut() {
                *domain =
                    normalize_domain(domain).ok_or_else(|| format!("Invalid domain: {domain}"))?;
            }
            domains.sort();
            domains.dedup();
        }
        let mut seen = BTreeSet::new();
        for source in &mut self.sources {
            if source.id.is_empty() || source.id.len() > 80 || !seen.insert(source.id.clone()) {
                return Err("Source IDs must be unique and nonempty".into());
            }
            if source.name.len() > 256 || source.url.len() > 2048 {
                return Err("Source name or URL is too long".into());
            }
            source.url = source.url.trim().to_string();
            if !matches!(
                source.format,
                SourceFormat::AvatarIds | SourceFormat::GithubAvatars
            ) {
                source.global_hide = false;
            }
            let parsed = url::Url::parse(&source.url).map_err(|_| "Invalid source URL")?;
            if parsed.scheme() != "https"
                || !parsed.username().is_empty()
                || parsed.password().is_some()
                || parsed.fragment().is_some()
            {
                return Err(
                    "List sources require HTTPS URLs without credentials or fragments".into(),
                );
            }
            if source.format == SourceFormat::GithubAvatars
                && (parsed.host_str() != Some("api.github.com")
                    || !parsed.path().starts_with("/repos/")
                    || !parsed.path().ends_with("/contents"))
            {
                return Err("Avatar directories require a GitHub contents API URL".into());
            }
            if source.ban_group_ids.len() > 20
                || source.ban_group_ids.iter().any(|id| !valid_id(id, "grp_"))
            {
                return Err("Invalid group ID for automatic bans".into());
            }
            if source.format != SourceFormat::UserIds
                && (source.block_users || !source.ban_group_ids.is_empty())
            {
                return Err(
                    "Automatic user actions are only available for exact user-ID lists".into(),
                );
            }
        }
        Ok(())
    }
}

pub fn parse_source(raw: &str, format: SourceFormat) -> Result<BTreeSet<String>, String> {
    let mut result = BTreeSet::new();
    if format == SourceFormat::Domains {
        for line in raw
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
        {
            result.insert(
                normalize_domain(line).ok_or("Domain lists must contain one hostname per line")?,
            );
        }
    } else {
        let prefix = if format == SourceFormat::UserIds {
            "usr_"
        } else {
            "avtr_"
        };
        // Accept newline IDs and JSON arrays of IDs/objects, but reject HTML/error pages.
        let raw = raw.trim();
        let values: Vec<String> = if raw.starts_with('[') {
            let value: Vec<serde_json::Value> =
                serde_json::from_str(raw).map_err(|_| "Invalid list JSON")?;
            value
                .into_iter()
                .map(|value| {
                    value
                        .as_str()
                        .map(str::to_string)
                        .or_else(|| {
                            ["id", "UserId", "userId", "avatarId"]
                                .iter()
                                .find_map(|key| {
                                    value.get(key).and_then(|v| v.as_str()).map(str::to_string)
                                })
                        })
                        .ok_or("List entry has no ID")
                })
                .collect::<Result<Vec<_>, _>>()?
        } else {
            raw.lines()
                .map(str::trim)
                .filter(|line| !line.is_empty() && !line.starts_with('#'))
                .map(str::to_string)
                .collect()
        };
        for value in values {
            let value = value.trim().to_ascii_lowercase();
            if !valid_id(&value, prefix) {
                return Err(format!(
                    "Invalid list ID: {}",
                    value.chars().take(80).collect::<String>()
                ));
            }
            result.insert(value);
        }
    }
    if result.is_empty() || result.len() > 100_000 {
        return Err("List is empty or exceeds 100000 entries; previous cache retained".into());
    }
    Ok(result)
}

/// Extract URL tokens from recognized media messages only; never resolve them.
pub fn logged_urls(data: &str) -> Vec<String> {
    data.split(|c: char| c.is_whitespace() || matches!(c, '\"' | '\'' | '<' | '>'))
        .filter_map(|token| {
            let start = token.find("https://").or_else(|| token.find("http://"))?;
            let value = token[start..].trim_end_matches([')', ']', ',', ';']);
            (value.len() <= 8192).then(|| value.to_string())
        })
        .take(16)
        .collect()
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SafetyLogRow {
    pub account_user_id: String,
    pub kind: String,
    pub created_at: String,
    pub user_id: String,
    pub location: String,
    pub url: String,
    pub data: String,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AvatarBlockEntry {
    pub id: String,
    pub name: String,
}
#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AvatarBlockPreview {
    pub token: String,
    pub account_user_id: String,
    pub source_name: String,
    pub updated_at: String,
    pub offset: u32,
    pub total: u32,
    pub entries: Vec<AvatarBlockEntry>,
}
#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AvatarBlockResult {
    pub id: String,
    pub outcome: String,
}
