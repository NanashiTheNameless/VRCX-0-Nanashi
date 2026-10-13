use std::cell::RefCell;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::thread::JoinHandle;
use std::time::Duration;

use vrcx_0_host_desktop::desktop_widget_window::{
    screen_work_areas, LayeredMenuItem, LayeredWindow, LayeredWindowEvent, LayeredWindowOptions,
    LayeredWindowWaker, WidgetRect,
};
use vrcx_0_i18n::{text, DesktopWidgetKey};
use vrcx_0_vr_overlay::{DesktopWidgetAction, DesktopWidgetSurfaceModel, SlintDesktopWidgetHost};

use super::feed::DesktopWidgetRowPart;
use super::runtime::{
    DesktopWidgetMenuCommand, DesktopWidgetRuntime, DesktopWidgetView, DesktopWidgetWindow,
    DesktopWidgetWindows,
};
use super::settings::{place_on_screens, DesktopWidgetBounds};

const ANIMATION_FRAME: Duration = Duration::from_millis(16);
const MIN_SIZE: (i32, i32) = (160, 80);
const MENU_PIN: u32 = 1;
const MENU_CLICK_THROUGH: u32 = 2;
const MENU_CLOSE: u32 = 3;

#[derive(Default)]
pub struct NativeDesktopWidgetWindows {
    #[cfg(test)]
    last_handle: Arc<Mutex<Option<isize>>>,
}

impl NativeDesktopWidgetWindows {
    pub fn new() -> Self {
        Self::default()
    }

    #[cfg(test)]
    pub(crate) fn last_window_handle(&self) -> Option<isize> {
        *self.last_handle.lock().unwrap()
    }
}

#[derive(Default)]
struct Shared {
    waker: Option<LayeredWindowWaker>,
    closed: bool,
}

struct NativeDesktopWidgetWindow {
    shared: Arc<Mutex<Shared>>,
    bring_to_front: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

struct WindowThreadParts {
    runtime: Weak<DesktopWidgetRuntime>,
    shared: Arc<Mutex<Shared>>,
    bring_to_front: Arc<AtomicBool>,
    #[cfg(test)]
    last_handle: Arc<Mutex<Option<isize>>>,
}

impl DesktopWidgetWindows for NativeDesktopWidgetWindows {
    fn open(&self, runtime: Weak<DesktopWidgetRuntime>) -> Box<dyn DesktopWidgetWindow> {
        let shared = Arc::new(Mutex::new(Shared::default()));
        let bring_to_front = Arc::new(AtomicBool::new(false));
        let parts = WindowThreadParts {
            runtime,
            shared: Arc::clone(&shared),
            bring_to_front: Arc::clone(&bring_to_front),
            #[cfg(test)]
            last_handle: Arc::clone(&self.last_handle),
        };
        let thread = std::thread::Builder::new()
            .name("vrcx-desktop-widget".to_string())
            .spawn(move || run_window(parts));
        let thread = match thread {
            Ok(thread) => Some(thread),
            Err(error) => {
                tracing::warn!(error = %error, "failed to start the desktop widget thread");
                None
            }
        };
        Box::new(NativeDesktopWidgetWindow {
            shared,
            bring_to_front,
            thread,
        })
    }
}

impl DesktopWidgetWindow for NativeDesktopWidgetWindow {
    fn refresh(&self) {
        let waker = self.shared.lock().ok().and_then(|shared| shared.waker);
        if let Some(waker) = waker {
            waker.wake();
        }
    }

    fn bring_to_front(&self) {
        self.bring_to_front.store(true, Ordering::SeqCst);
        self.refresh();
    }

    fn close(mut self: Box<Self>) {
        let waker = self.shared.lock().ok().and_then(|mut shared| {
            shared.closed = true;
            shared.waker.take()
        });
        if let Some(waker) = waker {
            waker.close();
        }
        let Some(thread) = self.thread.take() else {
            return;
        };
        if thread.thread().id() != std::thread::current().id() {
            let _ = thread.join();
        }
    }
}

struct WidgetLoop {
    runtime: Weak<DesktopWidgetRuntime>,
    view: DesktopWidgetView,
    host: SlintDesktopWidgetHost,
    frame: Vec<u8>,
    width: u32,
    height: u32,
    hovered: bool,
    pinned: bool,
    click_through: bool,
    bring_to_front: Arc<AtomicBool>,
}

fn run_window(parts: WindowThreadParts) {
    let WindowThreadParts {
        runtime,
        shared,
        bring_to_front,
        #[cfg(test)]
        last_handle,
    } = parts;
    let Some(view) = runtime.upgrade().map(|runtime| runtime.view()) else {
        return;
    };
    let settings = view.settings;
    let (screens, primary) = screen_work_areas();
    let screens = screens.into_iter().map(bounds_from).collect::<Vec<_>>();
    let primary = primary
        .map(bounds_from)
        .or_else(|| screens.first().copied());
    let provisional = primary.map_or(
        DesktopWidgetBounds {
            x: 0,
            y: 0,
            width: 320,
            height: 240,
        },
        |primary| place_on_screens(settings.bounds, &screens, primary, 1.0),
    );
    let state: Rc<RefCell<Option<WidgetLoop>>> = Rc::new(RefCell::new(None));
    let handler_state = Rc::clone(&state);
    let window = LayeredWindow::create(
        LayeredWindowOptions {
            title: "VRCX-0".to_string(),
            bounds: rect_from(provisional),
            topmost: settings.pinned,
            click_through: settings.click_through,
            min_size: MIN_SIZE,
        },
        move |window, event| {
            if let Ok(mut widget) = handler_state.try_borrow_mut() {
                if let Some(widget) = widget.as_mut() {
                    widget.handle(window, event);
                }
            }
        },
    );
    let window = match window {
        Ok(window) => window,
        Err(error) => {
            tracing::warn!(error = %error, "failed to create the desktop widget window");
            return;
        }
    };
    let scale = window.scale();
    if settings.bounds.is_none() {
        if let Some(primary) = primary {
            window.set_bounds(rect_from(place_on_screens(
                None,
                &screens,
                primary,
                f64::from(scale),
            )));
        }
    }
    let bounds = window.bounds();
    let width = bounds.width.max(1) as u32;
    let height = bounds.height.max(1) as u32;
    let host = match SlintDesktopWidgetHost::new(width, height, scale) {
        Ok(host) => host,
        Err(error) => {
            tracing::warn!(error = %error, "failed to create the desktop widget view");
            return;
        }
    };
    {
        let Ok(mut shared) = shared.lock() else {
            return;
        };
        if shared.closed {
            return;
        }
        shared.waker = Some(window.waker());
    }
    #[cfg(test)]
    {
        *last_handle.lock().unwrap() = Some(window.raw_handle());
    }
    *state.borrow_mut() = Some(WidgetLoop {
        runtime,
        view,
        host,
        frame: vec![0; width as usize * height as usize * 4],
        width,
        height,
        hovered: false,
        pinned: settings.pinned,
        click_through: settings.click_through,
        bring_to_front,
    });
    if let Some(widget) = state.borrow_mut().as_mut() {
        widget.redraw(&window);
    }
    window.run();
    state.borrow_mut().take();
}

impl WidgetLoop {
    fn handle(&mut self, window: &LayeredWindow, event: LayeredWindowEvent) {
        match event {
            LayeredWindowEvent::Wake => {
                let Some(runtime) = self.runtime.upgrade() else {
                    window.waker().close();
                    return;
                };
                self.view = runtime.view();
            }
            LayeredWindowEvent::Timer => {
                self.present(window);
                return;
            }
            LayeredWindowEvent::PointerMoved { x, y } => {
                self.hovered = true;
                self.host.pointer_moved(x, y);
            }
            LayeredWindowEvent::PointerPressed { x, y } => {
                self.host.pointer_pressed(x, y);
                self.run_actions(window);
            }
            LayeredWindowEvent::PointerReleased { x, y } => {
                self.host.pointer_released(x, y);
                self.run_actions(window);
            }
            LayeredWindowEvent::DragFinished | LayeredWindowEvent::PointerLeft => {
                self.hovered = false;
                self.host.pointer_left();
                self.host.take_actions();
            }
            LayeredWindowEvent::ContextMenu { screen_x, screen_y } => {
                self.show_menu(window, screen_x, screen_y);
            }
            LayeredWindowEvent::Resized { width, height } => self.resize(width, height),
            LayeredWindowEvent::ScaleChanged { scale } => self.host.set_scale_factor(scale),
            LayeredWindowEvent::MoveSizeFinished { bounds } => {
                if let Some(runtime) = self.runtime.upgrade() {
                    runtime.save_bounds(bounds_from(bounds));
                }
            }
        }
        self.redraw(window);
    }

    fn run_actions(&mut self, window: &LayeredWindow) {
        let Some(runtime) = self.runtime.upgrade() else {
            return;
        };
        for action in self.host.take_actions() {
            match action {
                DesktopWidgetAction::Drag => window.begin_drag(),
                DesktopWidgetAction::Actor(id) => runtime.activate(id, DesktopWidgetRowPart::Actor),
                DesktopWidgetAction::Detail(id) => {
                    runtime.activate(id, DesktopWidgetRowPart::Detail)
                }
            }
        }
    }

    fn show_menu(&mut self, window: &LayeredWindow, screen_x: i32, screen_y: i32) {
        let Some(runtime) = self.runtime.upgrade() else {
            return;
        };
        let language = runtime.app_language();
        let items = [
            LayeredMenuItem {
                id: MENU_PIN,
                label: text(&language, DesktopWidgetKey::DesktopWidgetMenuPin),
                checked: self.pinned,
            },
            LayeredMenuItem {
                id: MENU_CLICK_THROUGH,
                label: text(&language, DesktopWidgetKey::DesktopWidgetMenuClickThrough),
                checked: self.click_through,
            },
            LayeredMenuItem {
                id: MENU_CLOSE,
                label: text(&language, DesktopWidgetKey::DesktopWidgetMenuClose),
                checked: false,
            },
        ];
        let command = match window.show_menu(&items, screen_x, screen_y) {
            Some(MENU_PIN) => DesktopWidgetMenuCommand::TogglePinned,
            Some(MENU_CLICK_THROUGH) => DesktopWidgetMenuCommand::ToggleClickThrough,
            Some(MENU_CLOSE) => DesktopWidgetMenuCommand::Close,
            _ => return,
        };
        if let Err(error) = runtime.menu_command(command) {
            tracing::warn!(error = %error, "failed to apply desktop widget menu command");
        }
    }

    fn resize(&mut self, width: u32, height: u32) {
        let width = width.max(1);
        let height = height.max(1);
        if (width, height) == (self.width, self.height) {
            return;
        }
        self.width = width;
        self.height = height;
        self.frame = vec![0; width as usize * height as usize * 4];
        self.host.resize(width, height);
    }

    fn redraw(&mut self, window: &LayeredWindow) {
        let settings = self.view.settings;
        if settings.pinned != self.pinned {
            self.pinned = settings.pinned;
            window.set_topmost(self.pinned);
        }
        if settings.click_through != self.click_through {
            self.click_through = settings.click_through;
            window.set_click_through(self.click_through);
            self.hovered &= !self.click_through;
        }
        if self.bring_to_front.swap(false, Ordering::SeqCst) {
            pull_onto_screen(window);
            window.bring_to_front();
        }
        self.host.write_model(&DesktopWidgetSurfaceModel {
            rows: self.view.rows.clone(),
            background_opacity: settings.background_opacity,
            interactive: !self.click_through,
            hovered: self.hovered,
            newest_on_top: settings.newest_on_top,
        });
        self.present(window);
    }

    fn present(&mut self, window: &LayeredWindow) {
        if self.host.render_bgra(&mut self.frame) {
            window.present(&self.frame, self.width, self.height);
        }
        window.set_timer(self.host.is_animating().then_some(ANIMATION_FRAME));
    }
}

fn pull_onto_screen(window: &LayeredWindow) {
    let (screens, primary) = screen_work_areas();
    let screens = screens.into_iter().map(bounds_from).collect::<Vec<_>>();
    let Some(primary) = primary
        .map(bounds_from)
        .or_else(|| screens.first().copied())
    else {
        return;
    };
    let current = bounds_from(window.bounds());
    let placed = place_on_screens(Some(current), &screens, primary, f64::from(window.scale()));
    if placed != current {
        window.set_bounds(rect_from(placed));
    }
}

fn rect_from(bounds: DesktopWidgetBounds) -> WidgetRect {
    WidgetRect {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
    }
}

fn bounds_from(rect: WidgetRect) -> DesktopWidgetBounds {
    DesktopWidgetBounds {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
    }
}

#[cfg(test)]
mod tests;
