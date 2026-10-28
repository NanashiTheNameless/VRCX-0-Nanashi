mod app;
pub mod bindings_export;
mod bootstrap;
mod commands;
mod desktop_notification_activation;
mod error;
mod localization;
mod menu_action;
mod single_instance_gate;
mod state;

pub use app::run;
