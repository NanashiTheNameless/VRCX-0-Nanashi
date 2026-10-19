use std::collections::BTreeMap;

use vrcx_0_host_desktop::vr_overlay::VrDeviceSnapshot;
use vrcx_0_vr_overlay::DeviceRole;

use super::surfaces::wrist::device_role;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct TrackerDisconnect {
    pub(crate) count: usize,
    pub(crate) battery_percent: Option<u8>,
}

#[derive(Clone, Copy, Debug)]
struct TrackerState {
    connected: bool,
    battery_percent: Option<u8>,
}

#[derive(Debug, Default)]
pub(crate) struct TrackerWatch {
    trackers: BTreeMap<String, TrackerState>,
}

impl TrackerWatch {
    pub(crate) fn observe(&mut self, devices: &[VrDeviceSnapshot]) -> Option<TrackerDisconnect> {
        if !devices
            .iter()
            .any(|device| device_role(&device.label) == DeviceRole::Hmd)
        {
            self.reset();
            return None;
        }
        let present = devices
            .iter()
            .filter(|device| device_role(&device.label) == DeviceRole::Tracker)
            .filter_map(|device| {
                let serial = device.serial.as_deref()?.trim();
                (!serial.is_empty()).then(|| (serial.to_string(), device.battery_percent))
            })
            .collect::<BTreeMap<_, _>>();
        let mut disconnected = Vec::new();
        for (serial, state) in &mut self.trackers {
            match present.get(serial) {
                Some(battery_percent) => {
                    state.connected = true;
                    state.battery_percent = *battery_percent;
                }
                None if state.connected => {
                    state.connected = false;
                    disconnected.push(state.battery_percent);
                }
                None => {}
            }
        }
        for (serial, battery_percent) in present {
            self.trackers.entry(serial).or_insert(TrackerState {
                connected: true,
                battery_percent,
            });
        }
        match disconnected.as_slice() {
            [] => None,
            [battery_percent] => Some(TrackerDisconnect {
                count: 1,
                battery_percent: *battery_percent,
            }),
            _ => Some(TrackerDisconnect {
                count: disconnected.len(),
                battery_percent: None,
            }),
        }
    }

    pub(crate) fn reset(&mut self) {
        self.trackers.clear();
    }
}

#[cfg(test)]
mod tests {
    use vrcx_0_host_desktop::vr_overlay::VrDeviceStatus;

    use super::*;

    fn device(label: &str, serial: Option<&str>, battery_percent: Option<u8>) -> VrDeviceSnapshot {
        VrDeviceSnapshot {
            label: label.to_string(),
            serial: serial.map(str::to_string),
            status: VrDeviceStatus::Normal,
            battery_percent,
        }
    }

    fn hmd() -> VrDeviceSnapshot {
        device("HMD", Some("hmd-serial"), Some(80))
    }

    #[test]
    fn reports_a_tracker_that_disappears_with_its_last_battery() {
        let mut watch = TrackerWatch::default();
        assert_eq!(
            watch.observe(&[
                hmd(),
                device("T1", Some("a"), Some(70)),
                device("T2", Some("b"), Some(12)),
            ]),
            None
        );

        assert_eq!(
            watch.observe(&[hmd(), device("T1", Some("a"), Some(70))]),
            Some(TrackerDisconnect {
                count: 1,
                battery_percent: Some(12),
            })
        );
        assert_eq!(
            watch.observe(&[hmd(), device("T1", Some("a"), Some(70))]),
            None
        );
    }

    #[test]
    fn reports_again_after_the_tracker_reconnects_and_drops_out() {
        let mut watch = TrackerWatch::default();
        watch.observe(&[hmd(), device("T1", Some("a"), Some(50))]);
        watch.observe(&[hmd()]);

        assert_eq!(
            watch.observe(&[hmd(), device("T1", Some("a"), Some(45))]),
            None
        );
        assert_eq!(
            watch.observe(&[hmd()]),
            Some(TrackerDisconnect {
                count: 1,
                battery_percent: Some(45),
            })
        );
    }

    #[test]
    fn merges_trackers_that_disappear_in_the_same_poll() {
        let mut watch = TrackerWatch::default();
        watch.observe(&[
            hmd(),
            device("T1", Some("a"), Some(50)),
            device("T2", Some("b"), Some(60)),
            device("T3", Some("c"), None),
        ]);

        assert_eq!(
            watch.observe(&[hmd(), device("T1", Some("c"), None)]),
            Some(TrackerDisconnect {
                count: 2,
                battery_percent: None,
            })
        );
    }

    #[test]
    fn follows_serials_instead_of_labels() {
        let mut watch = TrackerWatch::default();
        watch.observe(&[
            hmd(),
            device("T1", Some("a"), Some(50)),
            device("T2", Some("b"), Some(60)),
        ]);

        assert_eq!(
            watch.observe(&[hmd(), device("T1", Some("b"), Some(60))]),
            Some(TrackerDisconnect {
                count: 1,
                battery_percent: Some(50),
            })
        );
    }

    #[test]
    fn ignores_trackers_without_serials_and_non_tracker_devices() {
        let mut watch = TrackerWatch::default();
        watch.observe(&[
            hmd(),
            device("L", Some("left"), Some(40)),
            device("R", Some("right"), Some(40)),
            device("T1", None, Some(40)),
        ]);

        assert_eq!(watch.observe(&[hmd()]), None);
    }

    #[test]
    fn a_snapshot_without_the_hmd_forgets_every_tracker_silently() {
        let mut watch = TrackerWatch::default();
        watch.observe(&[hmd(), device("T1", Some("a"), Some(50))]);

        assert_eq!(watch.observe(&[]), None);
        assert_eq!(watch.observe(&[hmd()]), None);
    }

    #[test]
    fn reset_forgets_trackers_without_reporting_them() {
        let mut watch = TrackerWatch::default();
        watch.observe(&[hmd(), device("T1", Some("a"), Some(50))]);
        watch.reset();

        assert_eq!(watch.observe(&[hmd()]), None);
    }
}
