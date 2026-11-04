use std::fmt;

use serde::Serialize;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum HostPlatform {
    Windows,
    Linux,
    Macos,
    #[default]
    Unknown,
}

impl HostPlatform {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Windows => "windows",
            Self::Linux => "linux",
            Self::Macos => "macos",
            Self::Unknown => "unknown",
        }
    }
}

impl fmt::Display for HostPlatform {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum HostArchitecture {
    #[serde(rename = "x86_64")]
    X86_64,
    Aarch64,
    #[default]
    Unknown,
}

impl HostArchitecture {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::X86_64 => "x86_64",
            Self::Aarch64 => "aarch64",
            Self::Unknown => "unknown",
        }
    }
}

impl fmt::Display for HostArchitecture {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

pub const fn current_host_platform() -> HostPlatform {
    if cfg!(target_os = "windows") {
        HostPlatform::Windows
    } else if cfg!(target_os = "linux") {
        HostPlatform::Linux
    } else if cfg!(target_os = "macos") {
        HostPlatform::Macos
    } else {
        HostPlatform::Unknown
    }
}

pub const fn current_host_architecture() -> HostArchitecture {
    if cfg!(target_arch = "aarch64") {
        HostArchitecture::Aarch64
    } else if cfg!(target_arch = "x86_64") {
        HostArchitecture::X86_64
    } else {
        HostArchitecture::Unknown
    }
}

pub const fn current_platform() -> &'static str {
    current_host_platform().as_str()
}

pub const fn current_arch() -> &'static str {
    current_host_architecture().as_str()
}
