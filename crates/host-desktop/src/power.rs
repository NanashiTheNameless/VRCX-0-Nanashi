//! Keeps the host system awake so the background runtime (realtime socket,
//! game log, notifications) keeps receiving live updates.
//!
//! A sleeping (S3/suspended) machine halts the CPU, so no process can run
//! while it is asleep. What we can do is stop the OS from putting the machine
//! to sleep on idle, while still letting the display turn off:
//!
//! - Windows: `SetThreadExecutionState(ES_SYSTEM_REQUIRED | ES_AWAYMODE_REQUIRED)`
//!   held by a dedicated thread. Away mode (when enabled by the system) makes a
//!   manual "Sleep" look asleep (display off, audio muted) while still running.
//! - macOS: a `caffeinate -i -w <pid>` child process.
//! - Linux: a `systemd-inhibit --what=sleep:idle` child that exits with us.

use std::sync::{Mutex, OnceLock};

enum KeepAwakeGuard {
    #[cfg(windows)]
    Thread {
        stop: std::sync::mpsc::Sender<()>,
        handle: std::thread::JoinHandle<()>,
    },
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    Child(std::process::Child),
}

impl KeepAwakeGuard {
    fn release(self) {
        match self {
            #[cfg(windows)]
            Self::Thread { stop, handle } => {
                let _ = stop.send(());
                let _ = handle.join();
            }
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            Self::Child(mut child) => {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn guard_slot() -> &'static Mutex<Option<KeepAwakeGuard>> {
    static SLOT: OnceLock<Mutex<Option<KeepAwakeGuard>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

/// Whether a keep-awake hold is currently active.
pub fn is_keep_awake_active() -> bool {
    guard_slot()
        .lock()
        .map(|guard| guard.is_some())
        .unwrap_or(false)
}

/// Enables or disables the keep-awake hold. Idempotent.
pub fn set_keep_awake(enabled: bool) -> Result<(), String> {
    let mut slot = guard_slot()
        .lock()
        .map_err(|error| format!("keep-awake state poisoned: {error}"))?;
    if !enabled {
        if let Some(guard) = slot.take() {
            guard.release();
            tracing::info!("released system keep-awake hold");
        }
        return Ok(());
    }
    if slot.is_some() {
        return Ok(());
    }
    *slot = Some(acquire()?);
    tracing::info!("acquired system keep-awake hold");
    Ok(())
}

#[cfg(windows)]
fn acquire() -> Result<KeepAwakeGuard, String> {
    use windows_sys::Win32::System::Power::{
        SetThreadExecutionState, ES_AWAYMODE_REQUIRED, ES_CONTINUOUS, ES_SYSTEM_REQUIRED,
    };

    let (stop, stop_rx) = std::sync::mpsc::channel::<()>();
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<bool>();
    let handle = std::thread::Builder::new()
        .name("keep-awake".into())
        .spawn(move || {
            // Execution state is per-thread, so this thread must stay alive
            // for as long as the hold is wanted.
            let previous = unsafe {
                SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_AWAYMODE_REQUIRED)
            };
            let acquired = previous != 0
                || unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) } != 0;
            let _ = ready_tx.send(acquired);
            if !acquired {
                return;
            }
            let _ = stop_rx.recv();
            unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
        })
        .map_err(|error| format!("failed to start keep-awake thread: {error}"))?;
    match ready_rx.recv() {
        Ok(true) => Ok(KeepAwakeGuard::Thread { stop, handle }),
        _ => {
            let _ = handle.join();
            Err("SetThreadExecutionState failed".into())
        }
    }
}

#[cfg(target_os = "macos")]
fn acquire() -> Result<KeepAwakeGuard, String> {
    std::process::Command::new("caffeinate")
        .args(["-i", "-w", &std::process::id().to_string()])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(KeepAwakeGuard::Child)
        .map_err(|error| format!("failed to start caffeinate: {error}"))
}

#[cfg(target_os = "linux")]
fn acquire() -> Result<KeepAwakeGuard, String> {
    // `tail --pid` exits when this process exits, so the inhibitor lock can
    // never outlive the app even after a crash.
    std::process::Command::new("systemd-inhibit")
        .args([
            "--what=sleep:idle",
            "--who=VRCX-0-Nanashi",
            "--why=Keeping live VRChat updates running in the background",
            "--mode=block",
            "tail",
            &format!("--pid={}", std::process::id()),
            "-f",
            "/dev/null",
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(KeepAwakeGuard::Child)
        .map_err(|error| format!("failed to start systemd-inhibit: {error}"))
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
fn acquire() -> Result<KeepAwakeGuard, String> {
    Err("keeping the system awake is not supported on this platform".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabling_without_a_hold_is_a_no_op() {
        assert!(set_keep_awake(false).is_ok());
        assert!(!is_keep_awake_active());
    }
}
