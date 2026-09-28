use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use chrono::Local;

const ERROR_LOG_FILE: &str = "error-log.txt";
pub const HEADLESS_ERROR_LOG_FILE: &str = "error-headless.txt";
const MAX_ERROR_LOG_BYTES: u64 = 10 * 1024 * 1024;
const PANIC_BACKTRACE_MARKER: &str = "\n[backtrace]\n";
static ERROR_LOG_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();

pub fn default_app_data_dir() -> Option<PathBuf> {
    crate::app_paths::default_app_data_dir().ok()
}

fn format_timestamp_with_version(app_version: Option<&str>) -> String {
    let now = Local::now();
    let timestamp = format!(
        "[{}] [{}]",
        now.format("%Y-%m-%d %H:%M:%S%.3f %:z"),
        now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    );
    match app_version.map(str::trim).filter(|value| !value.is_empty()) {
        Some(version) => format!("{timestamp} [v{version}]"),
        None => timestamp,
    }
}

const NETWORK_ERROR_MARKERS: &[&str] = &[
    "failed to load resource",
    "web api execution failed",
    "vrchat request failed",
    "github release request failed",
    "translation api error",
    "avatar search failed",
    "media file upload failed",
    "update download failed",
];

/// Words that introduce an HTTP status, as in `status=404`, `HTTP 502`,
/// `code: 429` or `API error (400)`.
const STATUS_KEYWORDS: &[&str] = &["status", "http", "code", "error"];

fn has_network_error_text(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    NETWORK_ERROR_MARKERS
        .iter()
        .any(|marker| lower.contains(marker))
        || (lower.contains("http ") && contains_http_error_status(&lower))
        || (lower.contains("status") && contains_http_error_status(&lower))
        || (lower.contains("request failed") && contains_http_error_status(&lower))
}

/// A standalone 4xx/5xx number right after a status keyword. Digits inside
/// timestamps (`33.596419`, `.512`), ids or sizes do not count.
fn contains_http_error_status(message: &str) -> bool {
    let mut previous_word: Option<&str> = None;
    for token in message
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|token| !token.is_empty())
    {
        if token.bytes().all(|byte| byte.is_ascii_digit()) {
            let is_error_status = token.len() == 3
                && token
                    .parse::<u16>()
                    .is_ok_and(|status| (400..=599).contains(&status));
            if is_error_status && previous_word.is_some_and(|word| STATUS_KEYWORDS.contains(&word))
            {
                return true;
            }
            // Keep `http` in view across the version in `HTTP/1.1 404`.
            if token.len() > 1 {
                previous_word = None;
            }
        } else {
            previous_word = Some(token);
        }
    }
    false
}

pub fn should_skip_error_log(message: &str) -> bool {
    has_network_error_text(message)
}

pub fn append_error_log(app_data: &Path, source: &str, message: &str) {
    append_error_log_to_file(app_data, ERROR_LOG_FILE, source, message);
}

pub fn append_error_log_with_version(
    app_data: &Path,
    source: &str,
    message: &str,
    app_version: &str,
) {
    append_error_log_to_file_with_version(app_data, ERROR_LOG_FILE, source, message, app_version);
}

pub fn append_panic_error_log_with_version(
    app_data: &Path,
    panic_info: &std::panic::PanicHookInfo<'_>,
    app_version: &str,
) {
    let message = format!(
        "{panic_info}{PANIC_BACKTRACE_MARKER}{}",
        std::backtrace::Backtrace::force_capture()
    );
    append_error_log_with_version(app_data, "rust:panic", &message, app_version);
}

pub fn append_headless_error_log(app_data: &Path, source: &str, message: &str) {
    append_error_log_to_file(app_data, HEADLESS_ERROR_LOG_FILE, source, message);
}

pub fn append_error_log_to_file(app_data: &Path, file_name: &str, source: &str, message: &str) {
    append_error_log_to_file_with_optional_version(app_data, file_name, source, message, None);
}

pub fn append_error_log_to_file_with_version(
    app_data: &Path,
    file_name: &str,
    source: &str,
    message: &str,
    app_version: &str,
) {
    append_error_log_to_file_with_optional_version(
        app_data,
        file_name,
        source,
        message,
        Some(app_version),
    );
}

fn append_error_log_to_file_with_optional_version(
    app_data: &Path,
    file_name: &str,
    source: &str,
    message: &str,
    app_version: Option<&str>,
) {
    // The noise filter is for frontend console spam; backend `rust:*` entries
    // (tracing ERROR lines, panics) are always logged on purpose.
    let backend = source.starts_with("rust:");
    if message.trim().is_empty() || (!backend && should_skip_error_log(message)) {
        return;
    }

    let _ = append_error_log_unfiltered_to_file(
        app_data,
        file_name,
        &format!(
            "{} [{}]\n{}\n",
            format_timestamp_with_version(app_version),
            source,
            message.trim_end()
        ),
    );
}

pub fn append_error_log_entry(app_data: &Path, entry: &str) {
    append_error_log_entry_to_file(app_data, ERROR_LOG_FILE, entry);
}

pub fn append_headless_error_log_entry(app_data: &Path, entry: &str) {
    append_error_log_entry_to_file(app_data, HEADLESS_ERROR_LOG_FILE, entry);
}

pub fn append_error_log_entry_to_file(app_data: &Path, file_name: &str, entry: &str) {
    if entry.trim().is_empty() || should_skip_error_log(entry) {
        return;
    }

    let _ = append_error_log_unfiltered_to_file(app_data, file_name, entry.trim_end());
}

fn append_error_log_unfiltered_to_file(
    app_data: &Path,
    file_name: &str,
    entry: &str,
) -> std::io::Result<()> {
    let mutex = ERROR_LOG_MUTEX.get_or_init(|| Mutex::new(()));
    let _guard = mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    std::fs::create_dir_all(app_data)?;
    let path = app_data.join(safe_log_file_name(file_name));
    {
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)?;
        writeln!(file, "{entry}\n")?;
    }
    trim_error_log_to_bytes_if_needed(&path, MAX_ERROR_LOG_BYTES)?;
    Ok(())
}

fn trim_error_log_to_bytes_if_needed(path: &Path, max_bytes: u64) -> std::io::Result<()> {
    let metadata = std::fs::metadata(path)?;
    if metadata.len() <= max_bytes {
        return Ok(());
    }

    let mut file = std::fs::File::open(path)?;
    file.seek(SeekFrom::Start(metadata.len() - max_bytes))?;

    let mut tail = Vec::with_capacity(max_bytes as usize);
    file.read_to_end(&mut tail)?;
    let keep_from = tail
        .windows(2)
        .position(|window| window == b"\n\n")
        .map(|offset| offset + 2)
        .unwrap_or(0);

    std::fs::write(path, &tail[keep_from..])
}

fn safe_log_file_name(file_name: &str) -> &str {
    let trimmed = file_name.trim();
    if trimmed.is_empty() || trimmed.contains('/') || trimmed.contains('\\') {
        ERROR_LOG_FILE
    } else {
        trimmed
    }
}

pub struct ErrorLogWriter {
    app_data: PathBuf,
    file_name: &'static str,
    app_version: Option<&'static str>,
    buffer: Vec<u8>,
}

impl ErrorLogWriter {
    pub fn new(app_data: PathBuf) -> Self {
        Self::with_file_name(app_data, ERROR_LOG_FILE)
    }

    pub fn new_with_version(app_data: PathBuf, app_version: &'static str) -> Self {
        Self::with_file_name_and_version(app_data, ERROR_LOG_FILE, Some(app_version))
    }

    pub fn with_file_name(app_data: PathBuf, file_name: &'static str) -> Self {
        Self::with_file_name_and_version(app_data, file_name, None)
    }

    pub fn with_file_name_and_version(
        app_data: PathBuf,
        file_name: &'static str,
        app_version: Option<&'static str>,
    ) -> Self {
        Self {
            app_data,
            file_name,
            app_version,
            buffer: Vec::new(),
        }
    }
}

impl Write for ErrorLogWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.buffer.extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl Drop for ErrorLogWriter {
    fn drop(&mut self) {
        if self.buffer.is_empty() {
            return;
        }

        let message = String::from_utf8_lossy(&self.buffer);
        append_error_log_to_file_with_optional_version(
            &self.app_data,
            self.file_name,
            "rust:tracing",
            &message,
            self.app_version,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(name: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("vrcx-error-log-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn appends_to_named_log_and_keeps_network_noise_filtered() {
        let dir = test_dir("named");
        append_headless_error_log(&dir, "headless:test", "runtime failed");
        append_headless_error_log(&dir, "headless:test", "request failed with HTTP 404");

        let headless_log = dir.join(HEADLESS_ERROR_LOG_FILE);
        let text = std::fs::read_to_string(headless_log).unwrap();
        assert!(text.contains("[headless:test]"));
        assert!(text.contains("runtime failed"));
        assert!(!text.contains("HTTP 404"));

        let default_log = dir.join(ERROR_LOG_FILE);
        assert!(!default_log.exists());
    }

    #[test]
    fn realtime_transport_failures_survive_the_network_noise_filter() {
        assert!(!should_skip_error_log(
            "[Realtime] websocket auth rejected while the session was still usable generation=4 code=401"
        ));
    }

    #[test]
    fn backend_errors_bypass_the_network_noise_filter() {
        let dir = test_dir("backend");
        let line = "2026-09-28T16:05:33.596419Z ERROR vrcx_0_assistant::agent::turn: assistant LLM request failed status=400";
        assert!(should_skip_error_log(line));
        append_error_log(&dir, "rust:tracing", line);
        append_error_log(&dir, "frontend:test", line);

        let text = std::fs::read_to_string(dir.join(ERROR_LOG_FILE)).unwrap();
        assert!(text.contains("[rust:tracing]"));
        assert!(!text.contains("[frontend:test]"));
    }

    #[test]
    fn status_codes_need_a_keyword_and_ignore_timestamp_digits() {
        assert!(contains_http_error_status("request failed with http 404"));
        assert!(contains_http_error_status("status=503"));
        assert!(contains_http_error_status("http/1.1 429 too many requests"));
        assert!(contains_http_error_status("llm api error (400): bad"));
        assert!(!contains_http_error_status(
            "[2026-09-28 04:21:33.512 -05:00] status ok"
        ));
        assert!(!contains_http_error_status("status: 16:05:33.596419z"));
        assert!(!contains_http_error_status("status 200, wrote 404 rows"));
        assert!(!contains_http_error_status("status 4040"));
    }

    #[test]
    fn trims_log_from_byte_tail_boundary() {
        let dir = test_dir("trim");
        let path = dir.join("trim.txt");
        std::fs::write(&path, b"old entry\n\nmiddle entry\n\nnew entry").unwrap();

        trim_error_log_to_bytes_if_needed(&path, 16).unwrap();

        let text = std::fs::read_to_string(path).unwrap();
        assert_eq!(text, "new entry");
    }

    #[test]
    fn writes_versioned_rust_error_entries() {
        let dir = test_dir("versioned");
        append_error_log_with_version(&dir, "rust:panic", "panic detail", "2.9.2");

        let text = std::fs::read_to_string(dir.join(ERROR_LOG_FILE)).unwrap();
        assert!(text.contains("[v2.9.2] [rust:panic]"));
        assert!(text.contains("panic detail"));
    }
}
