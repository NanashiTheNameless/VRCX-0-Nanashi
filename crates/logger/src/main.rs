#![cfg_attr(windows, windows_subsystem = "windows")]

mod app;
mod config;
mod credentials;
#[cfg(windows)]
mod gui;
mod profile_scan;
mod recorder;
mod runtime;
mod server;
mod session;
mod store;
#[cfg(test)]
mod test_support;
mod vrchat;
mod webhook;

use std::future::Future;
use std::process::ExitCode;
use std::sync::Arc;

use tracing_subscriber::EnvFilter;
use vrcx_0_logger_protocol::envelope::SecretKey;

use crate::app::{App, LOGGER_VERSION};
use crate::config::Config;
use crate::store::{KeyCheck, Store, STORAGE_SALT};

fn main() -> ExitCode {
    #[cfg(windows)]
    if !std::env::args()
        .skip(1)
        .any(|arg| arg == "--headless" || arg == "--version")
    {
        return gui::run();
    }
    #[cfg(windows)]
    // SAFETY: AttachConsole has no preconditions; failure only means there is no parent console.
    unsafe {
        windows_sys::Win32::System::Console::AttachConsole(
            windows_sys::Win32::System::Console::ATTACH_PARENT_PROCESS,
        );
    }

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    if std::env::args().skip(1).any(|arg| arg == "--version") {
        println!("{LOGGER_VERSION}");
        return ExitCode::SUCCESS;
    }

    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            tracing::error!("runtime: {error}");
            return ExitCode::FAILURE;
        }
    };
    match runtime.block_on(run()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!("{error}");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), String> {
    let config = Config::from_env()?;
    let (app, listener) = start(&config).await?;
    serve(app, listener, shutdown_signal()).await
}

async fn start(config: &Config) -> Result<(Arc<App>, tokio::net::TcpListener), String> {
    let transport_key =
        SecretKey::transport(&config.password).map_err(|error| error.to_string())?;
    let storage_key =
        SecretKey::derive(&config.password, STORAGE_SALT).map_err(|error| error.to_string())?;

    let (store, check) =
        Store::open(&config.data_dir, storage_key).map_err(|error| error.to_string())?;
    match check {
        KeyCheck::Fresh => tracing::info!(
            data_dir = %config.data_dir.display(),
            "initialized a new logger data directory"
        ),
        KeyCheck::Matched => {}
        KeyCheck::PasswordChanged { dropped_frames } => tracing::warn!(
            dropped_frames,
            "logger password changed; stored credentials and unsynced frames were discarded"
        ),
    }

    let app = Arc::new(App::new(
        transport_key,
        store,
        config.retention_days,
        config.retention_bytes,
    )?);
    app.spawn_maintenance();
    let listener = tokio::net::TcpListener::bind(config.bind)
        .await
        .map_err(|error| format!("bind {}: {error}", config.bind))?;
    tracing::info!(address = %config.bind, version = LOGGER_VERSION, "logger listening");
    Ok((app, listener))
}

async fn serve(
    app: Arc<App>,
    listener: tokio::net::TcpListener,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> Result<(), String> {
    axum::serve(listener, server::router(app))
        .with_graceful_shutdown(shutdown)
        .await
        .map_err(|error| format!("server: {error}"))
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
    tracing::info!("logger shutting down");
}
