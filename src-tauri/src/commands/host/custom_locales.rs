#![allow(non_snake_case)]

//! Fork: user-supplied UI translations stored as `<data dir>/locales/<code>.json`.
//! Each file has the same shape as `src/localization/en.json`; an optional
//! top-level `"language"` string is used as the display name, and an optional
//! `"_meta"` object records how the file was generated (code, provider,
//! endpoint, model, AI instructions; never API keys). The file name is the
//! authoritative code. Missing keys fall back to English in the frontend.

use std::path::{Path, PathBuf};

use serde_json::Value;
use tauri::State;
use vrcx_0_host_desktop::shell_actions;

use crate::error::AppError;
use crate::state::AppState;

const LOCALES_DIR: &str = "locales";
const MAX_LOCALE_FILE_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Clone, Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CustomLocaleEntry {
    pub code: String,
    pub name: String,
    pub messages: Value,
}

fn locales_dir(state: &AppState) -> PathBuf {
    state.runtime_host().app_data_path().join(LOCALES_DIR)
}

/// Locale codes become file names, so keep them to a safe subset. Non-standard
/// codes such as `en_pt`, `enp`, `qes` or `tlh_aa` are allowed.
fn validate_code(code: &str) -> Result<String, AppError> {
    let code = code.trim();
    let valid = (2..=32).contains(&code.len())
        && code
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
        && !code.eq_ignore_ascii_case("en");
    if valid {
        Ok(code.to_string())
    } else {
        Err(AppError::Custom(
            "Language code must be 2-32 letters, digits, '-' or '_' and must not be \"en\".".into(),
        ))
    }
}

fn read_entry(path: &Path) -> Option<CustomLocaleEntry> {
    let code = path.file_stem()?.to_str()?.to_string();
    validate_code(&code).ok()?;
    if std::fs::metadata(path).ok()?.len() > MAX_LOCALE_FILE_BYTES {
        tracing::warn!(path = %path.display(), "custom locale file too large; skipped");
        return None;
    }
    let text = std::fs::read_to_string(path).ok()?;
    let messages: Value = match serde_json::from_str(&text) {
        Ok(value @ Value::Object(_)) => value,
        Ok(_) | Err(_) => {
            tracing::warn!(path = %path.display(), "custom locale file is not a JSON object; skipped");
            return None;
        }
    };
    let name = messages
        .get("language")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| code.clone());
    Some(CustomLocaleEntry {
        code,
        name,
        messages,
    })
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__custom_locales_list(state: State<'_, AppState>) -> Vec<CustomLocaleEntry> {
    let Ok(entries) = std::fs::read_dir(locales_dir(&state)) else {
        return Vec::new();
    };
    let mut locales = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("json"))
        .filter_map(|path| read_entry(&path))
        .collect::<Vec<_>>();
    locales.sort_by(|left, right| left.code.cmp(&right.code));
    locales
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__custom_locale_save(
    state: State<'_, AppState>,
    code: String,
    messages: Value,
) -> Result<CustomLocaleEntry, AppError> {
    let code = validate_code(&code)?;
    if !messages.is_object() {
        return Err(AppError::Custom(
            "Language file must be a JSON object.".into(),
        ));
    }
    let dir = locales_dir(&state);
    std::fs::create_dir_all(&dir).map_err(|error| AppError::Custom(error.to_string()))?;
    let path = dir.join(format!("{code}.json"));
    let text = serde_json::to_string_pretty(&messages)
        .map_err(|error| AppError::Custom(error.to_string()))?;
    let temp = dir.join(format!(".{code}.json.tmp"));
    std::fs::write(&temp, text).map_err(|error| AppError::Custom(error.to_string()))?;
    std::fs::rename(&temp, &path).map_err(|error| AppError::Custom(error.to_string()))?;
    read_entry(&path)
        .ok_or_else(|| AppError::Custom("Saved language file could not be read.".into()))
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__custom_locale_delete(state: State<'_, AppState>, code: String) -> Result<(), AppError> {
    let code = validate_code(&code)?;
    let path = locales_dir(&state).join(format!("{code}.json"));
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(AppError::Custom(error.to_string())),
    }
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__custom_locales_open_folder(state: State<'_, AppState>) -> Result<bool, AppError> {
    let dir = locales_dir(&state);
    std::fs::create_dir_all(&dir).map_err(|error| AppError::Custom(error.to_string()))?;
    Ok(shell_actions::open_existing_folder(&dir)?)
}

#[cfg(test)]
mod tests {
    use super::validate_code;

    #[test]
    fn locale_codes_are_file_name_safe() {
        assert_eq!(validate_code(" de ").unwrap(), "de");
        assert!(validate_code("pt-BR").is_ok());
        assert!(validate_code("x-custom1").is_ok());
        assert!(validate_code("x_custom1").is_ok());
        assert!(validate_code("tlh_aa").is_ok());
        assert!(validate_code("en").is_err());
        assert!(validate_code("../evil").is_err());
        assert!(validate_code("a").is_err());
        assert!(validate_code("de/x").is_err());
    }
}
