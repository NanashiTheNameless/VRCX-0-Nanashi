use std::path::Path;

use vrcx_0_platform::Error;

pub fn open_calendar_file(ics_content: &str) -> Result<(), Error> {
    validate_calendar_content(ics_content)?;

    let temp_dir = std::env::temp_dir().join("VRCX-0-Nanashi");
    std::fs::create_dir_all(&temp_dir)?;
    let ics_path = temp_dir.join("event.ics");
    std::fs::write(&ics_path, ics_content)?;
    open::that(ics_path.to_string_lossy().as_ref())
        .map_err(|e| Error::Custom(format!("open ics: {e}")))?;
    Ok(())
}

pub fn write_calendar_file(path: &Path, ics_content: &str) -> Result<(), Error> {
    validate_calendar_content(ics_content)?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    std::fs::write(path, ics_content)?;
    Ok(())
}

pub fn validate_calendar_content(ics_content: &str) -> Result<(), Error> {
    if !ics_content.starts_with("BEGIN:VCALENDAR") || !ics_content.ends_with("END:VCALENDAR") {
        return Err(Error::Custom("invalid iCalendar content".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-calendar-{name}-{}-{nonce}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn complete_vcalendar_content_can_be_written() {
        let dir = TestDir::new("complete");
        let path = dir.path.join("exports").join("event.ics");
        let content = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR";

        write_calendar_file(&path, content).unwrap();

        assert_eq!(std::fs::read_to_string(path).unwrap(), content);
    }

    #[test]
    fn incomplete_vcalendar_content_is_rejected_before_writing() {
        let dir = TestDir::new("incomplete");
        let path = dir.path.join("exports").join("event.ics");

        assert!(write_calendar_file(&path, "BEGIN:VCALENDAR\r\nVERSION:2.0").is_err());
        assert!(!path.exists());
        assert!(validate_calendar_content("VERSION:2.0\r\nEND:VCALENDAR").is_err());
    }
}
