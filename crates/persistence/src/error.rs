pub use vrcx_0_contracts::SqliteErrorCategory;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Database error: {0}")]
    Database(String),

    #[error("Database error: {message}")]
    Sqlite {
        message: String,
        category: Option<SqliteErrorCategory>,
    },

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Invalid data: {0}")]
    InvalidData(String),

    #[error("{0}")]
    Custom(String),
}

impl vrcx_0_contracts::ApplicationErrorSource for Error {
    fn into_application_error(self) -> vrcx_0_contracts::ApplicationErrorPayload {
        use vrcx_0_contracts::ApplicationErrorPayload;

        match self {
            Self::Database(message) => ApplicationErrorPayload::Database(message),
            Self::Sqlite { message, category } => {
                ApplicationErrorPayload::Sqlite { message, category }
            }
            Self::Io(error) => ApplicationErrorPayload::Io(error),
            Self::Json(error) => ApplicationErrorPayload::Json(error),
            Self::InvalidData(message) => ApplicationErrorPayload::PersistenceInvalidData(message),
            Self::Custom(message) => ApplicationErrorPayload::Custom(message),
        }
    }
}

impl Error {
    pub(crate) fn sqlite(error: rusqlite::Error) -> Self {
        Self::Sqlite {
            category: sqlite_error_category(&error),
            message: error.to_string(),
        }
    }

    pub(crate) fn sqlite_with_context(context: &str, error: rusqlite::Error) -> Self {
        Self::Sqlite {
            category: sqlite_error_category(&error),
            message: format!("{context}: {error}"),
        }
    }

    pub(crate) fn database_with_context(context: String, error: Self) -> Self {
        let category = error.sqlite_category();
        Self::database_message(format!("{context}: {error}"), category)
    }

    pub(crate) fn database_message(message: String, category: Option<SqliteErrorCategory>) -> Self {
        match category {
            Some(category) => Self::Sqlite {
                message,
                category: Some(category),
            },
            None => Self::Database(message),
        }
    }

    pub fn sqlite_category(&self) -> Option<SqliteErrorCategory> {
        match self {
            Self::Sqlite { category, .. } => *category,
            _ => None,
        }
    }
}

fn sqlite_error_category(error: &rusqlite::Error) -> Option<SqliteErrorCategory> {
    use rusqlite::ErrorCode;

    match error.sqlite_error_code()? {
        ErrorCode::DatabaseCorrupt | ErrorCode::NotADatabase => {
            Some(SqliteErrorCategory::Malformed)
        }
        ErrorCode::DiskFull => Some(SqliteErrorCategory::DiskFull),
        ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked | ErrorCode::ReadOnly => {
            Some(SqliteErrorCategory::Locked)
        }
        ErrorCode::SystemIoFailure => Some(SqliteErrorCategory::IoError),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sqlite_failure(code: i32) -> rusqlite::Error {
        rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(code), None)
    }

    #[test]
    fn classifies_sqlite_failures_from_stable_error_codes() {
        assert_eq!(
            sqlite_error_category(&sqlite_failure(rusqlite::ffi::SQLITE_CORRUPT)),
            Some(SqliteErrorCategory::Malformed)
        );
        assert_eq!(
            sqlite_error_category(&sqlite_failure(rusqlite::ffi::SQLITE_FULL)),
            Some(SqliteErrorCategory::DiskFull)
        );
        assert_eq!(
            sqlite_error_category(&sqlite_failure(rusqlite::ffi::SQLITE_BUSY)),
            Some(SqliteErrorCategory::Locked)
        );
        assert_eq!(
            sqlite_error_category(&sqlite_failure(rusqlite::ffi::SQLITE_IOERR)),
            Some(SqliteErrorCategory::IoError)
        );
    }

    #[test]
    fn preserves_sqlite_category_when_adding_context() {
        let error = Error::sqlite_with_context(
            "write screenshot index row",
            sqlite_failure(rusqlite::ffi::SQLITE_FULL),
        );

        assert!(matches!(
            &error,
            Error::Sqlite {
                category: Some(SqliteErrorCategory::DiskFull),
                ..
            }
        ));
        assert!(error
            .to_string()
            .starts_with("Database error: write screenshot index row:"));
    }

    #[test]
    fn preserves_sqlite_category_through_database_context() {
        let error = Error::database_with_context(
            "Migration 1 failed".into(),
            Error::sqlite(sqlite_failure(rusqlite::ffi::SQLITE_CORRUPT)),
        );

        assert!(matches!(
            error,
            Error::Sqlite {
                category: Some(SqliteErrorCategory::Malformed),
                ..
            }
        ));
        assert!(error
            .to_string()
            .starts_with("Database error: Migration 1 failed: Database error:"));
    }
}
