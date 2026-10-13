//! Group-policy opt-out for the anonymous adoption count. Windows only: the
//! module is not compiled on other platforms, which have no registry.

use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
use winreg::RegKey;

pub const TELEMETRY_POLICY_KEY: &str = "SOFTWARE\\Policies\\NamelessNanashi\\VRCX-0-Nanashi";
pub const TELEMETRY_POLICY_VALUE: &str = "DisableTelemetry";

/// True when an administrator or the user set the `DisableTelemetry` DWORD to
/// a non-zero value under the policy key in HKLM or HKCU.
pub fn telemetry_disabled_by_policy() -> bool {
    [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER]
        .into_iter()
        .any(|hive| {
            RegKey::predef(hive)
                .open_subkey(TELEMETRY_POLICY_KEY)
                .and_then(|key| key.get_value::<u32, _>(TELEMETRY_POLICY_VALUE))
                .is_ok_and(policy_value_disables)
        })
}

fn policy_value_disables(value: u32) -> bool {
    value != 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn any_non_zero_policy_value_disables_and_zero_does_not() {
        assert!(policy_value_disables(1));
        assert!(policy_value_disables(2));
        assert!(!policy_value_disables(0));
    }

    #[test]
    fn policy_lives_under_the_fork_policy_key() {
        assert_eq!(
            TELEMETRY_POLICY_KEY,
            "SOFTWARE\\Policies\\NamelessNanashi\\VRCX-0-Nanashi"
        );
        assert_eq!(TELEMETRY_POLICY_VALUE, "DisableTelemetry");
    }
}
