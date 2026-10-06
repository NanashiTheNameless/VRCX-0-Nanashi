use serde::{Deserialize, Serialize};
use vrcx_0_vr_overlay::{OverlaySize, OverlaySurfaceId};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BackendStartError {
    pub message: String,
    pub reason: BackendStartErrorReason,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BackendStartErrorReason {
    Other,
    RuntimeUnavailable,
    Unsupported,
}

impl BackendStartError {
    pub fn permanent(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            reason: BackendStartErrorReason::Unsupported,
        }
    }

    pub fn transient(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            reason: BackendStartErrorReason::Other,
        }
    }

    pub fn runtime_unavailable(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            reason: BackendStartErrorReason::RuntimeUnavailable,
        }
    }
}

impl std::fmt::Display for BackendStartError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct OverlaySurfaceConfig {
    pub surface_id: OverlaySurfaceId,
    pub size: OverlaySize,
    pub physical_width_meters: f32,
    pub placement: OverlayPlacement,
    #[serde(default)]
    pub activation_button: OverlayActivationButton,
    #[serde(default)]
    pub force_visible: bool,
    /// Inactivity timeout in milliseconds. When the overlay is shown, it will
    /// remain visible for this duration after the last interaction.
    #[serde(default = "default_visible_duration_ms")]
    pub visible_duration_ms: u64,
}

fn default_visible_duration_ms() -> u64 {
    15000 // 15 seconds as default
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum OverlayPlacement {
    TrackedDeviceRelative {
        device_hint: String,
    },
    HeadLocked {
        offset_y_meters: f32,
        distance_meters: f32,
    },
}

/// Wrist panels keep their bottom edge where a 0.20 m square panel's bottom
/// edge sat, so a larger or taller panel grows upward instead of downward.
const WRIST_ANCHOR_HALF_HEIGHT_METERS: f32 = 0.10;

impl OverlayPlacement {
    /// Row-major 3x4 pose of the overlay's center relative to its attachment.
    #[cfg_attr(
        not(all(
            any(feature = "steamvr-overlay", feature = "openxr-overlay"),
            any(windows, target_os = "linux")
        )),
        allow(dead_code)
    )]
    pub(crate) fn transform(&self, height_meters: f32) -> [[f32; 4]; 3] {
        let mut m = match self {
            Self::TrackedDeviceRelative { device_hint } if device_hint == "left-hand" => [
                [0.0, 0.0, -1.0, -0.07],
                [0.0, -1.0, 0.0, -0.05],
                [-1.0, 0.0, 0.0, 0.06],
            ],
            Self::TrackedDeviceRelative { device_hint } if device_hint == "right-hand" => [
                [0.0, 0.0, 1.0, 0.07],
                [0.0, -1.0, 0.0, -0.05],
                [1.0, 0.0, 0.0, 0.06],
            ],
            Self::HeadLocked {
                offset_y_meters,
                distance_meters,
            } => {
                return [
                    [1.0, 0.0, 0.0, 0.0],
                    [0.0, 1.0, 0.0, *offset_y_meters],
                    [0.0, 0.0, 1.0, -distance_meters],
                ]
            }
            Self::TrackedDeviceRelative { .. } => [
                [1.0, 0.0, 0.0, 0.0],
                [0.0, 1.0, 0.0, 0.035],
                [0.0, 0.0, 1.0, 0.055],
            ],
        };
        let shift = height_meters / 2.0 - WRIST_ANCHOR_HALF_HEIGHT_METERS;
        for row in &mut m {
            row[3] += row[1] * shift;
        }
        m
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum OverlayActivationButton {
    #[default]
    Grip,
    Menu,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct VrDeviceSnapshot {
    pub label: String,
    pub serial: Option<String>,
    pub status: VrDeviceStatus,
    pub battery_percent: Option<u8>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum VrDeviceStatus {
    Normal,
    LowBattery,
    CriticalBattery,
    Charging,
    TrackingWarning,
    Disconnected,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bottom_edge(placement: &OverlayPlacement, height_meters: f32) -> [f32; 3] {
        let m = placement.transform(height_meters);
        std::array::from_fn(|row| m[row][3] - m[row][1] * height_meters / 2.0)
    }

    #[test]
    fn wrist_panels_grow_upward_from_a_fixed_bottom_edge() {
        for hand in ["left-hand", "right-hand"] {
            let placement = OverlayPlacement::TrackedDeviceRelative {
                device_hint: hand.to_string(),
            };
            let reference = bottom_edge(&placement, 0.20);
            for height in [0.16, 0.20, 0.40, 0.48] {
                let edge = bottom_edge(&placement, height);
                for row in 0..3 {
                    assert!((edge[row] - reference[row]).abs() < 1e-6, "{hand} {height}");
                }
            }
        }
    }

    #[test]
    fn head_locked_placement_ignores_height() {
        let placement = OverlayPlacement::HeadLocked {
            offset_y_meters: -0.3,
            distance_meters: 1.3,
        };
        assert_eq!(placement.transform(0.2), placement.transform(0.9));
    }
}
