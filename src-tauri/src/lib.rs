mod adapters;
mod app;
pub mod bindings_export;
mod bootstrap;
mod commands;
mod deep_link;
mod desktop_notification_activation;
mod error;
mod localization;
#[cfg(target_os = "macos")]
mod macos_menu;
mod menu_action;
mod single_instance_gate;
mod state;

pub use app::run;
