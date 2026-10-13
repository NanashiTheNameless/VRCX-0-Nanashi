use std::sync::{Arc, Mutex};
use std::time::Duration;

use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetTopWindow, GetWindow, GetWindowLongPtrW, GWL_EXSTYLE, GW_HWNDNEXT,
    WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT,
};

use super::{LayeredWindow, LayeredWindowEvent, LayeredWindowOptions, WidgetRect};

#[test]
fn a_click_through_widget_stays_on_top_and_lets_clicks_through() {
    let window = open(true, true);

    assert!(window.has_style(WS_EX_TOPMOST));
    assert!(window.has_style(WS_EX_TRANSPARENT));
}

#[test]
fn turning_click_through_and_pin_off_makes_an_ordinary_clickable_window() {
    let window = open(true, true);

    window.set_click_through(false);
    window.set_topmost(false);

    assert!(!window.has_style(WS_EX_TRANSPARENT));
    assert!(!window.has_style(WS_EX_TOPMOST));
}

#[test]
fn the_widget_stays_out_of_the_taskbar_and_never_takes_focus() {
    let window = open(true, false);

    assert!(window.has_style(WS_EX_TOOLWINDOW));
    assert!(window.has_style(WS_EX_NOACTIVATE));
    assert_ne!(
        unsafe { GetForegroundWindow() } as isize,
        window.raw_handle()
    );
}

#[test]
fn bringing_an_unpinned_widget_to_the_front_raises_it_without_pinning_or_focusing_it() {
    let widget = open(false, false);
    let covering = open(false, false);
    assert!(is_above(covering.raw_handle(), widget.raw_handle()));

    widget.bring_to_front();

    assert!(is_above(widget.raw_handle(), covering.raw_handle()));
    assert!(!widget.has_style(WS_EX_TOPMOST));
    assert_ne!(
        unsafe { GetForegroundWindow() } as isize,
        widget.raw_handle()
    );
}

#[test]
fn the_widget_opens_exactly_where_it_was_left() {
    let window = open(false, false);

    assert_eq!(window.bounds(), bounds());
}

#[test]
fn another_thread_can_wake_the_widget_and_then_close_it() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let recorded = Arc::clone(&events);
    let window = LayeredWindow::create(options(false, false), move |_, event| {
        if matches!(event, LayeredWindowEvent::Wake) {
            recorded.lock().unwrap().push("wake");
        }
    })
    .unwrap();
    let waker = window.waker();

    let remote = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(50));
        waker.wake();
        std::thread::sleep(Duration::from_millis(50));
        waker.close();
    });
    window.run();
    remote.join().unwrap();

    assert_eq!(*events.lock().unwrap(), ["wake"]);
    assert!(!window.is_open());
}

fn is_above(upper: isize, lower: isize) -> bool {
    let mut current = unsafe { GetTopWindow(std::ptr::null_mut()) };
    while !current.is_null() {
        if current as isize == upper {
            return true;
        }
        if current as isize == lower {
            return false;
        }
        current = unsafe { GetWindow(current, GW_HWNDNEXT) };
    }
    false
}

fn open(topmost: bool, click_through: bool) -> LayeredWindow {
    LayeredWindow::create(options(topmost, click_through), |_, _| {}).unwrap()
}

fn options(topmost: bool, click_through: bool) -> LayeredWindowOptions {
    LayeredWindowOptions {
        title: "VRCX-0 test widget".to_string(),
        bounds: bounds(),
        topmost,
        click_through,
        min_size: (160, 80),
    }
}

fn bounds() -> WidgetRect {
    WidgetRect {
        x: 120,
        y: 140,
        width: 320,
        height: 220,
    }
}

impl LayeredWindow {
    fn has_style(&self, style: u32) -> bool {
        let styles = unsafe { GetWindowLongPtrW(self.raw_handle() as _, GWL_EXSTYLE) } as u32;
        styles & style == style
    }
}
