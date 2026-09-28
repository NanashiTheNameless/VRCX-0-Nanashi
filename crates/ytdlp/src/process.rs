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

const DIAGNOSTIC_TAIL_BYTES: usize = 16 * 1024;

async fn read_tail(reader: &mut (impl AsyncReadExt + Unpin)) -> Vec<u8> {
    let mut tail = Vec::new();
    let mut chunk = [0u8; 8192];
    while let Ok(n) = reader.read(&mut chunk).await {
        if n == 0 {
            break;
        }
        tail.extend_from_slice(&chunk[..n]);
        if tail.len() > DIAGNOSTIC_TAIL_BYTES {
            tail.drain(..tail.len() - DIAGNOSTIC_TAIL_BYTES);
        }
    }
    tail
}

/// Like `run`, but keeps the tail of stdout+stderr for diagnosing installer
/// steps (npm, tsc). Only use it for commands whose output cannot carry
/// cookies or signed URLs.
pub(crate) async fn run_diagnosed(
    cmd: &mut Command,
    timeout: Duration,
) -> Result<(bool, String), String> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = spawn(cmd)?;
    let mut stdout = child.stdout.take().ok_or("Missing process output")?;
    let mut stderr = child.stderr.take().ok_or("Missing process output")?;
    let result = tokio::time::timeout(timeout, async {
        let (out, err) = tokio::join!(read_tail(&mut stdout), read_tail(&mut stderr));
        let status = child.wait().await.map_err(|e| e.to_string())?;
        let mut text = String::from_utf8_lossy(&out).into_owned();
        text.push_str(&String::from_utf8_lossy(&err));
        Ok::<_, String>((status.success(), text))
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

/// Like `run`, but keeps yt-dlp's last `ERROR:` line from stderr, cleaned by
/// [`sanitized_error_line`]. Nothing else from the output is kept, because
/// yt-dlp can print cookie values and signed URLs.
pub(crate) async fn run_keeping_error_line(
    cmd: &mut Command,
    timeout: Duration,
) -> Result<(bool, Option<String>), String> {
    cmd.stdout(Stdio::null()).stderr(Stdio::piped());
    let mut child = spawn(cmd)?;
    let mut stderr = child.stderr.take().ok_or("Missing process output")?;
    let result = tokio::time::timeout(timeout, async {
        let tail = read_tail(&mut stderr).await;
        let status = child.wait().await.map_err(|e| e.to_string())?;
        let error = String::from_utf8_lossy(&tail)
            .lines()
            .rev()
            .find(|line| line.trim_start().starts_with("ERROR:"))
            .map(sanitized_error_line);
        Ok::<_, String>((status.success(), error))
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

/// A yt-dlp `ERROR:` line safe to show and log: every URL is cut down to its
/// scheme and host (dropping paths and query strings that can carry signed
/// parameters), and the result is capped at 300 characters.
pub(crate) fn sanitized_error_line(line: &str) -> String {
    let cleaned = line
        .trim()
        .split(' ')
        .map(|word| match word.find("://") {
            Some(index) => {
                let (scheme, rest) = word.split_at(index);
                let host = rest[3..]
                    .split(['/', '?', '#', '"', '\'', ')', ','])
                    .next()
                    .unwrap_or("");
                format!("{scheme}://{host}/…")
            }
            None => word.to_string(),
        })
        .collect::<Vec<_>>()
        .join(" ");
    cleaned.chars().take(300).collect()
}

/// Most useful line of installer output, for a short error suffix: an npm
/// `ERR!` line, else the `Error:` line of a crash (Node ends crashes with a
/// bare `Node.js vX` line), else the last line.
pub(crate) fn last_error_line(output: &str) -> Option<String> {
    let lines: Vec<&str> = output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with("Node.js v"))
        .collect();
    lines
        .iter()
        .rev()
        .find(|line| line.contains("ERR!") && !line.contains("A complete log"))
        .or_else(|| {
            lines
                .iter()
                .find(|line| line.contains("Error:") || line.contains("Error ["))
        })
        .or_else(|| lines.last())
        .map(|line| line.chars().take(300).collect())
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

#[cfg(test)]
mod sanitized_error_line_tests {
    use super::sanitized_error_line;

    #[test]
    fn cuts_urls_to_their_host_and_keeps_the_message() {
        assert_eq!(
            sanitized_error_line(
                "ERROR: [youtube] BaW_jenozKc: Sign in to confirm you're not a bot. See https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp for details"
            ),
            "ERROR: [youtube] BaW_jenozKc: Sign in to confirm you're not a bot. See https://github.com/… for details"
        );
        assert_eq!(
            sanitized_error_line(
                "ERROR: unable to download https://rr1.googlevideo.com/videoplayback?expire=1&sig=SECRET&n=abc"
            ),
            "ERROR: unable to download https://rr1.googlevideo.com/…"
        );
        assert!(!sanitized_error_line("ERROR: x https://h.test/p?sig=SECRET").contains("SECRET"));
        assert_eq!(sanitized_error_line(&"x".repeat(500)).chars().count(), 300);
    }
}

#[cfg(test)]
mod last_error_line_tests {
    use super::last_error_line;

    #[test]
    fn prefers_the_crash_error_over_the_node_version_footer() {
        let output = "node:internal/modules/cjs/loader:1228\n  throw err;\n\nError: Cannot find module 'x'\n    at Module._resolveFilename\n\nNode.js v22.23.3\n";
        assert_eq!(
            last_error_line(output).as_deref(),
            Some("Error: Cannot find module 'x'")
        );
    }

    #[test]
    fn prefers_npm_err_lines() {
        let output =
            "npm ERR! code ENOENT\nnpm ERR! A complete log of this run can be found in: x\n";
        assert_eq!(
            last_error_line(output).as_deref(),
            Some("npm ERR! code ENOENT")
        );
    }
}
