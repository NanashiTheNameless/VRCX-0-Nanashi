use std::{path::Path, process::Stdio, time::Duration};
use tokio::{io::AsyncReadExt, process::Command};

pub(crate) fn command(program: &Path) -> Command {
    let mut cmd = Command::new(program);
    cmd.kill_on_drop(true).stdin(Stdio::null());
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::process::CommandExt;
        let parent = std::process::id() as libc::pid_t;
        // Only async-signal-safe syscalls run between fork and exec.
        unsafe {
            cmd.as_std_mut().pre_exec(move || {
                if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
                if libc::getppid() != parent {
                    return Err(std::io::Error::from_raw_os_error(libc::ECHILD));
                }
                Ok(())
            });
        }
    }
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    cmd
}
/// Output is bounded and never included in errors (yt-dlp can print cookie or signed URL data).
pub(crate) async fn run(cmd: &mut Command, timeout: Duration) -> Result<(bool, Vec<u8>), String> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child = spawn(cmd)?;
    let mut stdout = child.stdout.take().ok_or("Missing process output")?;
    let result = tokio::time::timeout(timeout, async {
        let mut output = Vec::new();
        let mut chunk = [0u8; 8192];
        loop {
            let n = stdout.read(&mut chunk).await.map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            if output.len() + n > 1024 * 1024 {
                return Err("Process output limit exceeded".to_string());
            }
            output.extend_from_slice(&chunk[..n]);
        }
        let status = child.wait().await.map_err(|e| e.to_string())?;
        Ok((status.success(), output))
    })
    .await;
    match result {
        Ok(Ok(v)) => Ok(v),
        error => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            match error {
                Ok(Err(e)) => Err(e),
                _ => Err("Operation timed out".into()),
            }
        }
    }
}

pub(crate) struct ManagedChild {
    child: tokio::process::Child,
    #[cfg(windows)]
    _job: WindowsJob,
}
impl std::ops::Deref for ManagedChild {
    type Target = tokio::process::Child;
    fn deref(&self) -> &Self::Target {
        &self.child
    }
}
impl std::ops::DerefMut for ManagedChild {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.child
    }
}
pub(crate) fn spawn(command: &mut Command) -> Result<ManagedChild, String> {
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not start required program: {e}"))?;
    #[cfg(windows)]
    let job = match WindowsJob::attach(&child) {
        Ok(j) => j,
        Err(e) => {
            let _ = child.start_kill();
            return Err(e);
        }
    };
    let _ = &mut child;
    Ok(ManagedChild {
        child,
        #[cfg(windows)]
        _job: job,
    })
}
#[cfg(windows)]
struct WindowsJob(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
unsafe impl Send for WindowsJob {}
#[cfg(windows)]
impl WindowsJob {
    fn attach(child: &tokio::process::Child) -> Result<Self, String> {
        use windows_sys::Win32::{
            Foundation::CloseHandle,
            System::{JobObjects::*, Threading::*},
        };
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return Err("Could not create child-process job".into());
            }
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                std::mem::size_of_val(&limits) as u32,
            ) == 0
            {
                CloseHandle(job);
                return Err("Could not configure child-process job".into());
            }
            let process = OpenProcess(
                PROCESS_SET_QUOTA | PROCESS_TERMINATE,
                0,
                child.id().ok_or("Child process has exited")?,
            );
            if process.is_null() {
                CloseHandle(job);
                return Err("Could not access child process".into());
            }
            let ok = AssignProcessToJobObject(job, process) != 0;
            CloseHandle(process);
            if !ok {
                CloseHandle(job);
                return Err("Could not manage child process lifetime".into());
            }
            Ok(Self(job))
        }
    }
}
#[cfg(windows)]
impl Drop for WindowsJob {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}
