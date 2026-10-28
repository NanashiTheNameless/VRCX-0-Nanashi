pub const MINIMUM_PROFILE_VERSION: &str = "3.0.1";

pub fn supports_current_profile(version: &str) -> bool {
    let Ok(version) = semver::Version::parse(version.strip_prefix('v').unwrap_or(version)) else {
        return false;
    };
    (version.major, version.minor, version.patch) >= (3, 0, 1)
}
