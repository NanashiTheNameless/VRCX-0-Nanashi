use std::fs::File;
use std::path::PathBuf;
use std::process::ExitCode;

use vrcx_0_nanashi_collector::{is_tmpfs, read_session};

#[derive(Default)]
struct Arguments {
    collector_mode: bool,
    session_fd: Option<i32>,
    rows_fd: Option<i32>,
    control_fd: Option<i32>,
    data_dir: Option<PathBuf>,
}

/// Exit code the supervisor reads as "this build cannot collect".
const UNAVAILABLE: u8 = 78;

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(code) => {
            eprintln!("{code}");
            ExitCode::from(UNAVAILABLE)
        }
    }
}

fn run() -> Result<(), &'static str> {
    let args = parse_args(std::env::args_os().skip(1))?;
    if !args.collector_mode {
        return Err("collector_unavailable: --collector-mode is required");
    }
    let data_dir = args.data_dir.as_deref().ok_or(
        "collector_unavailable: --data-dir must point to a supervisor-owned tmpfs directory",
    )?;
    let canonical_dir = data_dir
        .canonicalize()
        .map_err(|_| "collector_unavailable: collector data directory is unavailable")?;
    if !canonical_dir.is_dir() || !is_tmpfs(&canonical_dir).unwrap_or(false) {
        return Err("collector_unavailable: collector data directory must reside on tmpfs");
    }

    let session_fd = args
        .session_fd
        .ok_or("collector_unavailable: --session-fd is required")?;
    let rows_fd = args
        .rows_fd
        .ok_or("collector_unavailable: --rows-fd is required")?;
    let control_fd = args
        .control_fd
        .ok_or("collector_unavailable: --control-fd is required")?;
    if session_fd == rows_fd || session_fd == control_fd || rows_fd == control_fd {
        return Err("collector_unavailable: inherited descriptors must be distinct");
    }

    let mut session_pipe = open_pipe(session_fd)?;
    let session = read_session(&mut session_pipe)
        .map_err(|_| "collector_unavailable: invalid inherited session message")?;
    drop(session_pipe);
    record(canonical_dir, session, rows_fd, control_fd)
}

#[cfg(unix)]
fn record(
    data_dir: PathBuf,
    session: vrcx_0_nanashi_collector::SessionMessage,
    rows_fd: i32,
    control_fd: i32,
) -> Result<(), &'static str> {
    use std::os::fd::FromRawFd;
    use std::os::unix::net::UnixStream;
    use vrcx_0_nanashi_collector::runtime::{run, Outcome};
    // SAFETY: both descriptors were inherited from the supervisor for this
    // process alone, and each is wrapped exactly once.
    let (rows, control) = unsafe {
        (
            UnixStream::from_raw_fd(rows_fd),
            UnixStream::from_raw_fd(control_fd),
        )
    };
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|_| "collector_unavailable: the async runtime could not start")?;
    match runtime.block_on(run(data_dir, session, rows, control)) {
        Outcome::Stopped => Ok(()),
        Outcome::Unavailable(_) => {
            Err("collector_unavailable: the recording runtime could not start")
        }
    }
}

#[cfg(not(unix))]
fn record(
    _data_dir: PathBuf,
    _session: vrcx_0_nanashi_collector::SessionMessage,
    _rows_fd: i32,
    _control_fd: i32,
) -> Result<(), &'static str> {
    Err("collector_unavailable: the collector requires a Unix host")
}

fn parse_args(args: impl Iterator<Item = std::ffi::OsString>) -> Result<Arguments, &'static str> {
    let mut parsed = Arguments::default();
    let mut args = args.peekable();
    while let Some(arg) = args.next() {
        let arg = arg
            .to_str()
            .ok_or("collector_unavailable: command line contains a non-text option")?;
        match arg {
            "--collector-mode" => parsed.collector_mode = true,
            "--session-fd" => parsed.session_fd = Some(parse_fd(args.next())?),
            "--rows-fd" => parsed.rows_fd = Some(parse_fd(args.next())?),
            "--control-fd" => parsed.control_fd = Some(parse_fd(args.next())?),
            "--data-dir" => {
                let path = args
                    .next()
                    .ok_or("collector_unavailable: --data-dir requires a path")?;
                parsed.data_dir = Some(PathBuf::from(path));
            }
            _ => return Err("collector_unavailable: unsupported collector argument"),
        }
    }
    Ok(parsed)
}

fn parse_fd(value: Option<std::ffi::OsString>) -> Result<i32, &'static str> {
    value
        .and_then(|value| value.into_string().ok())
        .and_then(|value| value.parse::<i32>().ok())
        .filter(|fd| *fd >= 3)
        .ok_or("collector_unavailable: invalid inherited file descriptor")
}

#[cfg(unix)]
fn open_pipe(fd: i32) -> Result<File, &'static str> {
    use std::os::fd::FromRawFd;
    // SAFETY: descriptors are inherited from the supervisor and ownership is
    // transferred to this File handle for closure on exit.
    Ok(unsafe { File::from_raw_fd(fd) })
}

#[cfg(not(unix))]
fn open_pipe(_fd: i32) -> Result<File, &'static str> {
    Err("collector_unavailable: inherited file descriptors require a Unix host")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Result<Arguments, &'static str> {
        parse_args(values.iter().map(std::ffi::OsString::from))
    }

    #[test]
    fn collector_mode_requires_explicit_descriptors_and_data_dir() {
        let parsed = args(&["--collector-mode"]).unwrap();
        assert!(parsed.collector_mode);
        assert!(parsed.session_fd.is_none());
        assert!(parse_fd(Some("2".into())).is_err());
        assert!(args(&["--session-cookie", "not-accepted"]).is_err());
    }

    #[test]
    fn cookie_values_are_never_accepted_as_arguments() {
        assert!(args(&["--collector-mode", "--auth", "fixture-cookie"]).is_err());
        assert!(args(&["--collector-mode", "--session-fd", "5", "fixture-cookie"]).is_err());
    }
}
