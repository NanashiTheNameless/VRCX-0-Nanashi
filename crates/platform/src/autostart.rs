use std::fs;
use std::io;
use std::path::Path;

pub fn refresh_entries(
    config_dir: &Path,
    app_name: &str,
    executable: &Path,
    enable: bool,
) -> io::Result<()> {
    let directory = config_dir.join("autostart");
    for name in [
        format!("{app_name}.desktop"),
        "vrcx-0-nanashi.desktop".into(),
    ] {
        let path = directory.join(name);
        let content = match fs::read_to_string(&path) {
            Ok(content) => content,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error),
        };
        let updated = rewrite_entry(&content, executable, enable)?;
        if updated != content {
            fs::write(path, updated)?;
        }
    }
    Ok(())
}

pub fn refresh_current_entries(app_name: &str, executable: &Path, enable: bool) -> io::Result<()> {
    let mut directories = Vec::new();
    if let Some(config) = dirs::config_dir() {
        directories.push(config);
    }
    if let Some(home) = dirs::home_dir() {
        let config = home.join(".config");
        if !directories.contains(&config) {
            directories.push(config);
        }
    }
    for directory in directories {
        refresh_entries(&directory, app_name, executable, enable)?;
    }
    Ok(())
}

fn escape_value(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}

fn unescape_value(value: &str) -> String {
    let mut result = String::new();
    let mut chars = value.chars();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            match chars.next() {
                Some('s') => result.push(' '),
                Some('n') => result.push('\n'),
                Some('r') => result.push('\r'),
                Some('t') => result.push('\t'),
                Some('\\') => result.push('\\'),
                Some(other) => {
                    result.push('\\');
                    result.push(other);
                }
                None => result.push('\\'),
            }
        } else {
            result.push(ch);
        }
    }
    result
}

fn executable_end(command: &str) -> usize {
    if command.starts_with('/') {
        for suffix in [".AppImage", "/vrcx-0"] {
            if let Some(start) = command.find(suffix) {
                let end = start + suffix.len();
                if command[end..].is_empty() || command[end..].starts_with(char::is_whitespace) {
                    return end;
                }
            }
        }
    }
    let mut quoted = false;
    let mut escaped = false;
    for (index, ch) in command.char_indices() {
        if escaped {
            escaped = false;
        } else if ch == '\\' {
            escaped = true;
        } else if ch == '"' {
            quoted = !quoted;
        } else if ch.is_whitespace() && !quoted {
            return index;
        }
    }
    command.len()
}

pub fn rewrite_entry(content: &str, executable: &Path, enable: bool) -> io::Result<String> {
    let path = executable.to_str().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "autostart path is not UTF-8")
    })?;
    let mut quoted = String::from("\"");
    for ch in path.chars() {
        if matches!(ch, '"' | '`' | '$' | '\\') {
            quoted.push('\\');
        }
        quoted.push(ch);
        if ch == '%' {
            quoted.push('%');
        }
    }
    quoted.push('"');
    let mut main_section = false;
    let mut output = Vec::new();
    for line in content.lines() {
        if line.starts_with('[') {
            main_section = line == "[Desktop Entry]";
        }
        if main_section {
            if enable && line.starts_with("Hidden=") {
                output.push("Hidden=false".to_string());
                continue;
            }
            if enable && line.starts_with("X-GNOME-Autostart-enabled=") {
                output.push("X-GNOME-Autostart-enabled=true".to_string());
                continue;
            }
            if let Some(command) = line.strip_prefix("Exec=") {
                let command = unescape_value(command);
                let command = command.trim_start();
                let arguments = &command[executable_end(command)..];
                let arguments = if arguments.trim().is_empty() {
                    " --autostart"
                } else {
                    arguments
                };
                output.push(format!(
                    "Exec={}",
                    escape_value(&format!("{quoted}{arguments}"))
                ));
                continue;
            }
            if line.starts_with("TryExec=") {
                output.push(format!("TryExec={}", escape_value(path)));
                continue;
            }
        }
        output.push(line.to_string());
    }
    let mut result = output.join("\n");
    if content.ends_with('\n') {
        result.push('\n');
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_arguments_and_other_sections_while_repairing_legacy_spaces() {
        for previous in ["/old/My Apps/App.AppImage", "\"/old/My Apps/App.AppImage\""] {
            let content = format!("[Desktop Entry]\nName=App\nExec={previous} --autostart --data-dir \"/data/My Profile\" %U\nTryExec=/old/App.AppImage\n[Desktop Action Test]\nExec=other --keep\n");
            let result =
                rewrite_entry(&content, Path::new("/new/My Apps/App.AppImage"), false).unwrap();
            assert_eq!(result, "[Desktop Entry]\nName=App\nExec=\"/new/My Apps/App.AppImage\" --autostart --data-dir \"/data/My Profile\" %U\nTryExec=/new/My Apps/App.AppImage\n[Desktop Action Test]\nExec=other --keep\n");
            assert_eq!(
                rewrite_entry(&result, Path::new("/new/My Apps/App.AppImage"), false).unwrap(),
                result
            );
        }
    }

    #[test]
    fn escapes_desktop_and_exec_characters_without_changing_arguments() {
        let path = Path::new("/home/A $B`C\\D\"E%F/App.AppImage");
        let result = rewrite_entry(
            "[Desktop Entry]\nExec=old --autostart\nTryExec=old\n",
            path,
            false,
        )
        .unwrap();
        assert!(result.contains(r#"Exec="/home/A \\$B\\`C\\\\D\\"E%%F/App.AppImage" --autostart"#));
        assert!(result.contains(r#"TryExec=/home/A $B`C\\D"E%F/App.AppImage"#));
        assert_eq!(rewrite_entry(&result, path, false).unwrap(), result);
    }

    #[test]
    fn repairs_missing_autostart_flag_without_enabling_disabled_entries() {
        let content = "[Desktop Entry]\nExec=old\nHidden=true\n";
        assert_eq!(
            rewrite_entry(content, Path::new("/app"), false).unwrap(),
            "[Desktop Entry]\nExec=\"/app\" --autostart\nHidden=true\n"
        );
    }

    #[test]
    fn explicit_enable_clears_disabled_flags_and_preserves_custom_arguments() {
        let content = "[Desktop Entry]\nExec=old --autostart --custom\nHidden=true\nX-GNOME-Autostart-enabled=false\n";
        assert_eq!(rewrite_entry(content, Path::new("/app"), true).unwrap(), "[Desktop Entry]\nExec=\"/app\" --autostart --custom\nHidden=false\nX-GNOME-Autostart-enabled=true\n");
    }

    #[test]
    fn refreshes_both_entry_names_without_creating_autostart_entries() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("vrcx-autostart-{}-{nonce}", std::process::id()));
        refresh_entries(&root, "VRCX-0-Nanashi", Path::new("/new/app"), false).unwrap();
        assert!(!root.exists());
        fs::create_dir_all(root.join("autostart")).unwrap();
        for name in ["VRCX-0-Nanashi.desktop", "vrcx-0-nanashi.desktop"] {
            fs::write(
                root.join("autostart").join(name),
                "[Desktop Entry]\nExec=old --autostart --custom\n",
            )
            .unwrap();
        }
        refresh_entries(&root, "VRCX-0-Nanashi", Path::new("/new/app"), false).unwrap();
        for name in ["VRCX-0-Nanashi.desktop", "vrcx-0-nanashi.desktop"] {
            assert_eq!(
                fs::read_to_string(root.join("autostart").join(name)).unwrap(),
                "[Desktop Entry]\nExec=\"/new/app\" --autostart --custom\n"
            );
        }
        fs::remove_dir_all(root).unwrap();
    }
}
