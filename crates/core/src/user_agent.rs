//! User agents for outgoing requests. Every client builds its user agent here
//! so the app name, version, local-build marker and contact link agree.

use std::sync::OnceLock;

pub const APP_NAME: &str = "VRCX-0-Nanashi";

/// Semver build metadata marking builds not made by CI (GitHub Actions sets
/// `GITHUB_ACTIONS=true` for every workflow run), so services can tell a
/// developer's local build from an official one.
pub const BUILD_METADATA: &str = match option_env!("GITHUB_ACTIONS") {
    Some(value) if value.eq_ignore_ascii_case("true") => "",
    _ => "+local",
};

/// The repository this build came from, so a fork's CI builds point at the
/// fork. GitHub Actions sets `GITHUB_REPOSITORY` (`owner/repo`); local builds
/// fall back to the upstream repository.
const BUILD_REPOSITORY: &str = match option_env!("GITHUB_REPOSITORY") {
    Some(repository) => repository,
    None => "NanashiTheNameless/VRCX-0-Nanashi",
};

static APP_VERSION: OnceLock<String> = OnceLock::new();

/// Record the running app's version once at startup; only the app binary
/// knows it, and clients built later read it from here.
pub fn set_app_version(version: &str) {
    let _ = APP_VERSION.set(version.trim().to_string());
}

/// How services that identify API clients can reach the developer.
pub fn contact_url() -> String {
    format!("https://github.com/{BUILD_REPOSITORY}")
}

/// `VRCX-0-Nanashi/<version>` plus `+local` for local builds.
pub fn product_user_agent(version: &str) -> String {
    let version = version.trim();
    match (version.is_empty(), BUILD_METADATA.is_empty()) {
        (true, true) => APP_NAME.into(),
        (true, false) => format!("{APP_NAME}/local"),
        (false, _) => format!("{APP_NAME}/{version}{BUILD_METADATA}"),
    }
}

/// The product user agent for the version recorded at startup.
pub fn app_user_agent() -> String {
    product_user_agent(APP_VERSION.get().map(String::as_str).unwrap_or(""))
}

/// `user_agent` with the contact link: `… (+https://github.com/owner/repo)`.
pub fn with_contact(user_agent: &str) -> String {
    format!("{user_agent} (+{})", contact_url())
}

/// A named app component that talks to GitHub, with the contact link:
/// `VRCX-0-Nanashi/community-lists (+https://github.com/…)`.
pub fn component_user_agent(component: &str) -> String {
    with_contact(&format!("{APP_NAME}/{component}{BUILD_METADATA}"))
}

/// VRChat's own hosts (`vrchat.com`, `vrchat.cloud` and their subdomains).
pub fn is_vrchat_host(host: &str) -> bool {
    let host = host
        .trim()
        .trim_start_matches('.')
        .trim_end_matches('.')
        .to_ascii_lowercase();
    [
        crate::vrchat_endpoints::VRCHAT_SITE_HOST,
        crate::vrchat_endpoints::VRCHAT_CLOUD_ROOT_HOST,
    ]
    .iter()
    .any(|root| {
        host == *root
            || host
                .strip_suffix(root)
                .is_some_and(|prefix| prefix.ends_with('.'))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn product_user_agent_marks_local_builds() {
        assert_eq!(
            product_user_agent(" 3.0.0 "),
            format!("VRCX-0-Nanashi/3.0.0{BUILD_METADATA}")
        );
        let empty = if BUILD_METADATA.is_empty() {
            "VRCX-0-Nanashi"
        } else {
            "VRCX-0-Nanashi/local"
        };
        assert_eq!(product_user_agent(""), empty);
    }

    #[test]
    fn contact_and_component_user_agents_carry_the_repo_link() {
        let link = contact_url();
        assert!(link.starts_with("https://github.com/"));
        assert_eq!(with_contact("A/1"), format!("A/1 (+{link})"));
        assert_eq!(
            component_user_agent("safety-lists"),
            format!("VRCX-0-Nanashi/safety-lists{BUILD_METADATA} (+{link})")
        );
    }

    #[test]
    fn matches_only_vrchat_hosts() {
        for host in [
            "vrchat.com",
            "api.vrchat.cloud",
            "assets.vrchat.com",
            "VRChat.Cloud.",
        ] {
            assert!(is_vrchat_host(host), "{host}");
        }
        for host in ["evilvrchat.com", "vrchat.com.example.test", "github.com"] {
            assert!(!is_vrchat_host(host), "{host}");
        }
    }
}
