mod desktop_widget;
mod hmd;
mod platform;
mod surface;
mod wrist;

slint::include_modules!();

pub use desktop_widget::SlintDesktopWidgetHost;
pub use hmd::SlintHmdHost;
pub use surface::{SlintHmdRenderer, SlintSurfaceHost, SlintSurfaceRenderer, SlintWristRenderer};
pub use wrist::SlintWristHost;

#[cfg(test)]
mod tests;
