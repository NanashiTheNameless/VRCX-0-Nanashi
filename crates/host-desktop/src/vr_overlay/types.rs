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
        #[serde(default)]
        adjust: WristPlacementAdjust,
    },
    HeadLocked {
        offset_y_meters: f32,
        distance_meters: f32,
        /// Which edge of the panel sits at `offset_y_meters`; `None` is the
        /// center. An anchored edge stays put as the panel's height changes.
        #[serde(default)]
        anchor: Option<WristAnchor>,
    },
}

/// Which edge of the wrist panel stays put as the panel grows.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum WristAnchor {
    #[default]
    Bottom,
    Center,
    Top,
}

/// Fork: user placement of a wrist panel, in the panel's own axes (x right,
/// y up, z out of its face) relative to the default spot on the wrist.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WristPlacementAdjust {
    pub anchor: WristAnchor,
    pub side_meters: f32,
    pub up_meters: f32,
    pub out_meters: f32,
    /// Positive tilts the panel's top edge out of its face, pivoting on the anchor.
    pub tilt_degrees: f32,
}

/// The default anchor edges sit where a 0.20 m square panel's edges sat.
const WRIST_ANCHOR_HALF_HEIGHT_METERS: f32 = 0.10;

type Affine = [[f32; 4]; 3];

fn compose(a: Affine, b: Affine) -> Affine {
    std::array::from_fn(|row| {
        std::array::from_fn(|col| {
            let linear = (0..3).map(|k| a[row][k] * b[k][col]).sum::<f32>();
            if col == 3 {
                linear + a[row][3]
            } else {
                linear
            }
        })
    })
}

fn translation(x: f32, y: f32, z: f32) -> Affine {
    [[1.0, 0.0, 0.0, x], [0.0, 1.0, 0.0, y], [0.0, 0.0, 1.0, z]]
}

fn rotation_x(degrees: f32) -> Affine {
    let (sin, cos) = degrees.to_radians().sin_cos();
    [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, cos, -sin, 0.0],
        [0.0, sin, cos, 0.0],
    ]
}

impl WristPlacementAdjust {
    /// Pose of the panel's center relative to the default wrist pose.
    fn local_transform(self, height_meters: f32) -> Affine {
        let half = height_meters / 2.0;
        let (anchor_y, center_y) = match self.anchor {
            WristAnchor::Bottom => (-WRIST_ANCHOR_HALF_HEIGHT_METERS, half),
            WristAnchor::Center => (0.0, 0.0),
            WristAnchor::Top => (WRIST_ANCHOR_HALF_HEIGHT_METERS, -half),
        };
        compose(
            compose(
                translation(self.side_meters, self.up_meters + anchor_y, self.out_meters),
                rotation_x(self.tilt_degrees),
            ),
            translation(0.0, center_y, 0.0),
        )
    }
}

impl OverlayPlacement {
    /// Row-major 3x4 pose of the overlay's center relative to its attachment.
    #[cfg_attr(
        not(all(
            any(feature = "steamvr-overlay", feature = "openxr-overlay"),
            any(windows, target_os = "linux")
        )),
        allow(dead_code)
    )]
    pub(crate) fn transform(&self, height_meters: f32) -> Affine {
        match self {
            Self::TrackedDeviceRelative {
                device_hint,
                adjust,
            } => {
                let base = match device_hint.as_str() {
                    "left-hand" => [
                        [0.0, 0.0, -1.0, -0.07],
                        [0.0, -1.0, 0.0, -0.05],
                        [-1.0, 0.0, 0.0, 0.06],
                    ],
                    "right-hand" => [
                        [0.0, 0.0, 1.0, 0.07],
                        [0.0, -1.0, 0.0, -0.05],
                        [1.0, 0.0, 0.0, 0.06],
                    ],
                    _ => [
                        [1.0, 0.0, 0.0, 0.0],
                        [0.0, 1.0, 0.0, 0.035],
                        [0.0, 0.0, 1.0, 0.055],
                    ],
                };
                compose(base, adjust.local_transform(height_meters))
            }
            Self::HeadLocked {
                offset_y_meters,
                distance_meters,
                anchor,
            } => {
                let center_shift = match anchor {
                    None | Some(WristAnchor::Center) => 0.0,
                    Some(WristAnchor::Top) => -height_meters / 2.0,
                    Some(WristAnchor::Bottom) => height_meters / 2.0,
                };
                [
                    [1.0, 0.0, 0.0, 0.0],
                    [0.0, 1.0, 0.0, offset_y_meters + center_shift],
                    [0.0, 0.0, 1.0, -distance_meters],
                ]
            }
        }
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

    fn wrist(hand: &str, adjust: WristPlacementAdjust) -> OverlayPlacement {
        OverlayPlacement::TrackedDeviceRelative {
            device_hint: hand.to_string(),
            adjust,
        }
    }

    /// A point on the panel, `y` meters above its center, in attachment space.
    fn panel_point(placement: &OverlayPlacement, height_meters: f32, y: f32) -> [f32; 3] {
        let m = placement.transform(height_meters);
        std::array::from_fn(|row| m[row][3] + m[row][1] * y)
    }

    fn assert_close(a: [f32; 3], b: [f32; 3]) {
        for row in 0..3 {
            assert!((a[row] - b[row]).abs() < 1e-5, "{a:?} != {b:?}");
        }
    }

    #[test]
    fn the_default_wrist_pose_is_unchanged_for_the_original_panel() {
        let m = wrist("left-hand", WristPlacementAdjust::default()).transform(0.20);
        assert_eq!(
            m,
            [
                [0.0, 0.0, -1.0, -0.07],
                [0.0, -1.0, 0.0, -0.05],
                [-1.0, 0.0, 0.0, 0.06],
            ]
        );
    }

    #[test]
    fn each_anchor_keeps_its_edge_fixed_as_the_panel_grows() {
        for hand in ["left-hand", "right-hand"] {
            for (anchor, edge) in [
                (WristAnchor::Bottom, -0.5),
                (WristAnchor::Center, 0.0),
                (WristAnchor::Top, 0.5),
            ] {
                let placement = wrist(
                    hand,
                    WristPlacementAdjust {
                        anchor,
                        tilt_degrees: 25.0,
                        ..Default::default()
                    },
                );
                let reference = panel_point(&placement, 0.20, edge * 0.20);
                for height in [0.16, 0.40, 0.80] {
                    assert_close(panel_point(&placement, height, edge * height), reference);
                }
            }
        }
    }

    #[test]
    fn offsets_move_the_panel_along_its_own_axes() {
        let base = wrist("left-hand", WristPlacementAdjust::default());
        let moved = wrist(
            "left-hand",
            WristPlacementAdjust {
                side_meters: 0.01,
                up_meters: 0.02,
                out_meters: 0.03,
                ..Default::default()
            },
        );
        let a = base.transform(0.4);
        let b = moved.transform(0.4);
        for row in 0..3 {
            let expected = a[row][3] + a[row][0] * 0.01 + a[row][1] * 0.02 + a[row][2] * 0.03;
            assert!((b[row][3] - expected).abs() < 1e-6);
        }
    }

    #[test]
    fn tilt_rotates_the_panel_about_its_horizontal_axis() {
        let m = wrist(
            "left-hand",
            WristPlacementAdjust {
                tilt_degrees: 90.0,
                ..Default::default()
            },
        )
        .transform(0.2);
        let base = wrist("left-hand", WristPlacementAdjust::default()).transform(0.2);
        for row in 0..3 {
            assert!((m[row][0] - base[row][0]).abs() < 1e-6);
            assert!((m[row][1] - base[row][2]).abs() < 1e-6);
        }
    }

    #[test]
    fn head_locked_placement_keeps_its_anchored_edge() {
        let placement = |anchor| OverlayPlacement::HeadLocked {
            offset_y_meters: -0.3,
            distance_meters: 1.3,
            anchor,
        };
        let center = placement(None);
        assert_eq!(center.transform(0.2), center.transform(0.9));
        for (anchor, edge) in [(WristAnchor::Top, 0.5), (WristAnchor::Bottom, -0.5)] {
            for height in [0.2_f32, 0.9] {
                let m = placement(Some(anchor)).transform(height);
                assert!((m[1][3] + edge * height - -0.3).abs() < 1e-6);
            }
        }
    }
}
