use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;

pub const PASSWORD_ENV: &str = "VRCX0_LOGGER_PASSWORD";
const PASSWORD_FILE_ENV: &str = "VRCX0_LOGGER_PASSWORD_FILE";
pub const HOST_ENV: &str = "VRCX0_LOGGER_HOST";
pub const PORT_ENV: &str = "VRCX0_LOGGER_PORT";
pub const DATA_DIR_ENV: &str = "VRCX0_LOGGER_DATA_DIR";
pub const RETENTION_DAYS_ENV: &str = "VRCX0_LOGGER_RETENTION_DAYS";
pub const MAX_STORAGE_MB_ENV: &str = "VRCX0_LOGGER_MAX_STORAGE_MB";

pub const DEFAULT_HOST: &str = "0.0.0.0";
pub const DEFAULT_PORT: u16 = 8787;
const DEFAULT_DATA_DIR: &str = "data";
pub const DEFAULT_MAX_STORAGE_MB: u64 = 1024;

pub struct Config {
    pub password: String,
    pub bind: SocketAddr,
    pub data_dir: PathBuf,
    pub retention_days: Option<u32>,
    pub retention_bytes: Option<u64>,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        Self::from_sources(
            |name| std::env::var(name).ok(),
            |path| std::fs::read_to_string(path).map_err(|error| error.to_string()),
        )
    }

    pub fn from_sources(
        env: impl Fn(&str) -> Option<String>,
        read_file: impl Fn(&str) -> Result<String, String>,
    ) -> Result<Self, String> {
        let env = |name: &str| env(name).filter(|value| !value.trim().is_empty());
        let password = match (env(PASSWORD_ENV), env(PASSWORD_FILE_ENV)) {
            (Some(_), Some(_)) => {
                return Err(format!(
                    "set only one of {PASSWORD_ENV} or {PASSWORD_FILE_ENV}"
                ))
            }
            (Some(password), None) => password,
            (None, Some(path)) => read_file(&path)
                .map_err(|error| format!("read {PASSWORD_FILE_ENV} ({path}): {error}"))?
                .trim_end_matches(['\r', '\n'])
                .to_string(),
            (None, None) => {
                return Err(format!("{PASSWORD_ENV} or {PASSWORD_FILE_ENV} is required"))
            }
        };

        let host = env(HOST_ENV)
            .unwrap_or_else(|| DEFAULT_HOST.to_string())
            .trim()
            .parse::<IpAddr>()
            .map_err(|error| format!("invalid {HOST_ENV}: {error}"))?;
        let port = parse_number(&env, PORT_ENV)?.unwrap_or(DEFAULT_PORT);
        let data_dir = PathBuf::from(env(DATA_DIR_ENV).unwrap_or_else(|| DEFAULT_DATA_DIR.into()));
        let retention_days = parse_limit(&env, RETENTION_DAYS_ENV)?;
        let max_storage_mb = match parse_number::<u64>(&env, MAX_STORAGE_MB_ENV)? {
            None => Some(DEFAULT_MAX_STORAGE_MB),
            Some(0) => None,
            Some(limit) => Some(limit),
        };

        Ok(Self {
            password,
            bind: SocketAddr::new(host, port),
            data_dir,
            retention_days,
            retention_bytes: max_storage_mb.map(|mb| mb.saturating_mul(1024 * 1024)),
        })
    }
}

fn parse_number<T: std::str::FromStr>(
    env: &impl Fn(&str) -> Option<String>,
    name: &str,
) -> Result<Option<T>, String> {
    env(name)
        .map(|value| {
            value
                .trim()
                .parse::<T>()
                .map_err(|_| format!("invalid {name}: {value}"))
        })
        .transpose()
}

fn parse_limit<T: std::str::FromStr + Default + PartialEq>(
    env: &impl Fn(&str) -> Option<String>,
    name: &str,
) -> Result<Option<T>, String> {
    match parse_number::<T>(env, name)? {
        Some(value) if value == T::default() => Err(format!("{name} must be greater than 0")),
        value => Ok(value),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use vrcx_0_logger_protocol::envelope::{EnvelopeError, SecretKey};

    use super::*;

    fn config(vars: &[(&str, &str)], file: Option<&str>) -> Result<Config, String> {
        let vars: HashMap<String, String> = vars
            .iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect();
        Config::from_sources(
            |name| vars.get(name).cloned(),
            |_| {
                file.map(str::to_string)
                    .ok_or_else(|| "missing".to_string())
            },
        )
    }

    const PASSWORD: (&str, &str) = (PASSWORD_ENV, "long enough password");

    #[test]
    fn the_recorder_refuses_to_start_without_a_password() {
        assert!(config(&[], None).is_err());
    }

    #[test]
    fn a_password_shorter_than_eight_characters_refuses_to_start() {
        let config = config(&[(PASSWORD_ENV, "7 chars")], None).unwrap();

        assert_eq!(
            SecretKey::transport(&config.password).unwrap_err(),
            EnvelopeError::PasswordTooShort
        );
    }

    #[test]
    fn the_password_can_come_from_a_file_without_its_trailing_newline() {
        let config = config(
            &[(PASSWORD_FILE_ENV, "/run/secrets/logger")],
            Some(" long enough password \r\n"),
        )
        .unwrap();

        assert_eq!(config.password, " long enough password ");
    }

    #[test]
    fn an_unreadable_password_file_refuses_to_start() {
        assert!(config(&[(PASSWORD_FILE_ENV, "/run/secrets/missing")], None).is_err());
    }

    #[test]
    fn the_password_cannot_come_from_both_the_environment_and_a_file() {
        assert!(config(
            &[PASSWORD, (PASSWORD_FILE_ENV, "/run/secrets/logger")],
            Some("long enough password")
        )
        .is_err());
    }

    #[test]
    fn settings_left_empty_use_their_defaults() {
        let config = config(
            &[
                (PASSWORD_ENV, "correct horse battery"),
                (PASSWORD_FILE_ENV, ""),
                (PORT_ENV, ""),
                (RETENTION_DAYS_ENV, ""),
                (MAX_STORAGE_MB_ENV, " "),
            ],
            None,
        )
        .unwrap();

        assert_eq!(config.bind.port(), DEFAULT_PORT);
        assert_eq!(config.retention_days, None);
        assert_eq!(config.retention_bytes, Some(1024 * 1024 * 1024));
    }

    #[test]
    fn records_are_kept_for_any_age_within_one_gigabyte_unless_configured() {
        let config = config(&[PASSWORD], None).unwrap();

        assert_eq!(config.bind, "0.0.0.0:8787".parse().unwrap());
        assert_eq!(config.data_dir, PathBuf::from("data"));
        assert_eq!(config.retention_days, None);
        assert_eq!(config.retention_bytes, Some(1024 * 1024 * 1024));
    }

    #[test]
    fn a_storage_limit_of_zero_removes_the_limit() {
        let config = config(&[PASSWORD, (MAX_STORAGE_MB_ENV, "0")], None).unwrap();

        assert_eq!(config.retention_bytes, None);
    }

    #[test]
    fn host_port_data_dir_and_retention_limits_come_from_the_environment() {
        let config = config(
            &[
                PASSWORD,
                (HOST_ENV, "127.0.0.1"),
                (PORT_ENV, "9900"),
                (DATA_DIR_ENV, "/var/lib/vrcx0-logger"),
                (RETENTION_DAYS_ENV, "30"),
                (MAX_STORAGE_MB_ENV, "512"),
            ],
            None,
        )
        .unwrap();

        assert_eq!(config.bind, "127.0.0.1:9900".parse().unwrap());
        assert_eq!(config.data_dir, PathBuf::from("/var/lib/vrcx0-logger"));
        assert_eq!(config.retention_days, Some(30));
        assert_eq!(config.retention_bytes, Some(512 * 1024 * 1024));
    }

    #[test]
    fn zero_or_invalid_retention_limits_refuse_to_start() {
        for limit in [
            (RETENTION_DAYS_ENV, "0"),
            (RETENTION_DAYS_ENV, "a month"),
            (MAX_STORAGE_MB_ENV, "-512"),
        ] {
            assert!(config(&[PASSWORD, limit], None).is_err(), "{limit:?}");
        }
    }

    #[test]
    fn an_invalid_port_or_host_refuses_to_start() {
        for setting in [
            (PORT_ENV, "70000"),
            (PORT_ENV, "http"),
            (HOST_ENV, "not a host"),
        ] {
            assert!(config(&[PASSWORD, setting], None).is_err(), "{setting:?}");
        }
    }
}
