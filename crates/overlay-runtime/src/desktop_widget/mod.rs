mod feed;
mod runtime;
mod settings;
#[cfg(windows)]
mod window;

pub use feed::{DesktopWidgetRowPart, DesktopWidgetTarget};
pub use runtime::{
    DesktopWidgetHost, DesktopWidgetMenuCommand, DesktopWidgetRuntime, DesktopWidgetState,
    DesktopWidgetView, DesktopWidgetWindow, DesktopWidgetWindows,
};
pub use settings::{
    is_desktop_widget_config_key, place_on_screens, DesktopWidgetBounds, DesktopWidgetSettings,
    DESKTOP_WIDGET_BOUNDS_CONFIG_KEY, DESKTOP_WIDGET_CLICK_THROUGH_CONFIG_KEY,
    DESKTOP_WIDGET_ENABLED_CONFIG_KEY, DESKTOP_WIDGET_NEWEST_ON_TOP_CONFIG_KEY,
    DESKTOP_WIDGET_OPACITY_CONFIG_KEY, DESKTOP_WIDGET_PINNED_CONFIG_KEY,
};
pub use vrcx_0_vr_overlay::DesktopWidgetRow;
#[cfg(windows)]
pub use window::NativeDesktopWidgetWindows;
