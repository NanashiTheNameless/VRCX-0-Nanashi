use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::ffi::c_void;
use std::sync::Once;
use std::time::Duration;

use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, SIZE, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
    ClientToScreen, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject,
    EnumDisplayMonitors, GetDC, GetMonitorInfoW, ReleaseDC, SelectObject, AC_SRC_ALPHA,
    AC_SRC_OVER, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, BLENDFUNCTION, DIB_RGB_COLORS, HBITMAP, HDC,
    HGDIOBJ, HMONITOR, MONITORINFO,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::HiDpi::GetDpiForWindow;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    ReleaseCapture, SetCapture, TrackMouseEvent, TME_LEAVE, TRACKMOUSEEVENT,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    AppendMenuW, CreatePopupMenu, CreateWindowExW, DefWindowProcW, DestroyMenu, DestroyWindow,
    DispatchMessageW, GetForegroundWindow, GetMessageW, GetWindowLongPtrW, GetWindowRect, IsWindow,
    KillTimer, LoadCursorW, PostMessageW, PostQuitMessage, RegisterClassExW, SendMessageW,
    SetForegroundWindow, SetTimer, SetWindowLongPtrW, SetWindowPos, ShowWindow, TrackPopupMenu,
    TranslateMessage, UpdateLayeredWindow, CREATESTRUCTW, GWLP_USERDATA, GWL_EXSTYLE, HTBOTTOM,
    HTBOTTOMLEFT, HTBOTTOMRIGHT, HTCAPTION, HTCLIENT, HTLEFT, HTRIGHT, HTTOP, HTTOPLEFT,
    HTTOPRIGHT, HTTRANSPARENT, HWND_NOTOPMOST, HWND_TOPMOST, IDC_ARROW, MA_NOACTIVATE, MF_CHECKED,
    MF_STRING, MINMAXINFO, MSG, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
    SWP_SHOWWINDOW, SW_SHOWNOACTIVATE, TPM_NONOTIFY, TPM_RETURNCMD, TPM_RIGHTBUTTON, ULW_ALPHA,
    WM_APP, WM_CLOSE, WM_DESTROY, WM_DPICHANGED, WM_EXITSIZEMOVE, WM_GETMINMAXINFO, WM_LBUTTONDOWN,
    WM_LBUTTONUP, WM_MOUSEACTIVATE, WM_MOUSEMOVE, WM_NCCALCSIZE, WM_NCCREATE, WM_NCDESTROY,
    WM_NCHITTEST, WM_NCLBUTTONDOWN, WM_NULL, WM_RBUTTONUP, WM_SIZE, WM_TIMER, WNDCLASSEXW,
    WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT, WS_POPUP,
    WS_THICKFRAME,
};

const WM_MOUSELEAVE: u32 = 0x02A3;
const WM_WIDGET_WAKE: u32 = WM_APP + 1;
const WM_WIDGET_DRAG: u32 = WM_APP + 2;
const FRAME_TIMER_ID: usize = 1;
const RESIZE_BORDER: f32 = 6.0;
const MONITORINFOF_PRIMARY: u32 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WidgetRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Clone, Debug)]
pub struct LayeredWindowOptions {
    pub title: String,
    pub bounds: WidgetRect,
    pub topmost: bool,
    pub click_through: bool,
    pub min_size: (i32, i32),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum LayeredWindowEvent {
    Wake,
    Timer,
    PointerMoved { x: f32, y: f32 },
    PointerPressed { x: f32, y: f32 },
    PointerReleased { x: f32, y: f32 },
    PointerLeft,
    DragFinished,
    ContextMenu { screen_x: i32, screen_y: i32 },
    Resized { width: u32, height: u32 },
    ScaleChanged { scale: f32 },
    MoveSizeFinished { bounds: WidgetRect },
}

#[derive(Clone, Debug)]
pub struct LayeredMenuItem {
    pub id: u32,
    pub label: String,
    pub checked: bool,
}

type Handler = Box<dyn FnMut(&LayeredWindow, LayeredWindowEvent)>;

struct Surface {
    dc: HDC,
    bitmap: HBITMAP,
    previous: HGDIOBJ,
    bits: *mut u8,
    width: u32,
    height: u32,
}

impl Drop for Surface {
    fn drop(&mut self) {
        unsafe {
            SelectObject(self.dc, self.previous);
            DeleteObject(self.bitmap as HGDIOBJ);
            DeleteDC(self.dc);
        }
    }
}

impl Surface {
    fn new(width: u32, height: u32) -> Option<Self> {
        unsafe {
            let screen = GetDC(std::ptr::null_mut());
            let dc = CreateCompatibleDC(screen);
            ReleaseDC(std::ptr::null_mut(), screen);
            if dc.is_null() {
                return None;
            }
            let mut info: BITMAPINFO = std::mem::zeroed();
            info.bmiHeader = BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                biHeight: -(height as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                ..std::mem::zeroed()
            };
            let mut bits = std::ptr::null_mut::<c_void>();
            let bitmap = CreateDIBSection(
                dc,
                &info,
                DIB_RGB_COLORS,
                &mut bits,
                std::ptr::null_mut(),
                0,
            );
            if bitmap.is_null() || bits.is_null() {
                DeleteDC(dc);
                return None;
            }
            let previous = SelectObject(dc, bitmap as HGDIOBJ);
            Some(Self {
                dc,
                bitmap,
                previous,
                bits: bits.cast(),
                width,
                height,
            })
        }
    }
}

struct WindowState {
    handler: RefCell<Handler>,
    pending: RefCell<VecDeque<LayeredWindowEvent>>,
    click_through: Cell<bool>,
    tracking_leave: Cell<bool>,
    min_size: (i32, i32),
    surface: RefCell<Option<Surface>>,
}

pub struct LayeredWindow {
    hwnd: isize,
    owned: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct LayeredWindowWaker {
    hwnd: isize,
}

impl LayeredWindow {
    pub fn create(
        options: LayeredWindowOptions,
        handler: impl FnMut(&LayeredWindow, LayeredWindowEvent) + 'static,
    ) -> Result<Self, String> {
        let class_name = wide("VRCX0DesktopWidget");
        register_class(&class_name);
        let mut state = Some(Box::new(WindowState {
            handler: RefCell::new(Box::new(handler)),
            pending: RefCell::new(VecDeque::new()),
            click_through: Cell::new(options.click_through),
            tracking_leave: Cell::new(false),
            min_size: options.min_size,
            surface: RefCell::new(None),
        }));
        let mut ex_style = WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
        if options.topmost {
            ex_style |= WS_EX_TOPMOST;
        }
        if options.click_through {
            ex_style |= WS_EX_TRANSPARENT;
        }
        let title = wide(&options.title);
        let bounds = options.bounds;
        let hwnd = unsafe {
            CreateWindowExW(
                ex_style,
                class_name.as_ptr(),
                title.as_ptr(),
                WS_POPUP | WS_THICKFRAME,
                bounds.x,
                bounds.y,
                bounds.width,
                bounds.height,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                GetModuleHandleW(std::ptr::null()),
                (&mut state as *mut Option<Box<WindowState>>).cast(),
            )
        };
        if hwnd.is_null() {
            return Err(std::io::Error::last_os_error().to_string());
        }
        unsafe {
            ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
        Ok(Self {
            hwnd: hwnd as isize,
            owned: true,
        })
    }

    pub fn raw_handle(&self) -> isize {
        self.hwnd
    }

    pub fn run(&self) {
        unsafe {
            let mut message: MSG = std::mem::zeroed();
            while self.is_open() && GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
    }

    pub fn is_open(&self) -> bool {
        unsafe { IsWindow(self.handle()) != 0 }
    }

    pub fn waker(&self) -> LayeredWindowWaker {
        LayeredWindowWaker { hwnd: self.hwnd }
    }

    pub fn present(&self, bgra: &[u8], width: u32, height: u32) {
        let Some(state) = state(self.handle()) else {
            return;
        };
        let expected = width as usize * height as usize * 4;
        if width == 0 || height == 0 || bgra.len() < expected {
            return;
        }
        let mut surface = state.surface.borrow_mut();
        if surface
            .as_ref()
            .is_none_or(|surface| (surface.width, surface.height) != (width, height))
        {
            *surface = Surface::new(width, height);
        }
        let Some(surface) = surface.as_ref() else {
            return;
        };
        unsafe {
            std::ptr::copy_nonoverlapping(bgra.as_ptr(), surface.bits, expected);
            let size = SIZE {
                cx: width as i32,
                cy: height as i32,
            };
            let source = POINT { x: 0, y: 0 };
            let blend = BLENDFUNCTION {
                BlendOp: AC_SRC_OVER as u8,
                BlendFlags: 0,
                SourceConstantAlpha: 255,
                AlphaFormat: AC_SRC_ALPHA as u8,
            };
            UpdateLayeredWindow(
                self.handle(),
                std::ptr::null_mut(),
                std::ptr::null(),
                &size,
                surface.dc,
                &source,
                0,
                &blend,
                ULW_ALPHA,
            );
        }
    }

    pub fn set_topmost(&self, topmost: bool) {
        let order = if topmost {
            HWND_TOPMOST
        } else {
            HWND_NOTOPMOST
        };
        unsafe {
            SetWindowPos(
                self.handle(),
                order,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    }

    pub fn set_click_through(&self, click_through: bool) {
        if let Some(state) = state(self.handle()) {
            state.click_through.set(click_through);
        }
        unsafe {
            let style = GetWindowLongPtrW(self.handle(), GWL_EXSTYLE);
            let transparent = WS_EX_TRANSPARENT as isize;
            let next = if click_through {
                style | transparent
            } else {
                style & !transparent
            };
            if next != style {
                SetWindowLongPtrW(self.handle(), GWL_EXSTYLE, next);
            }
        }
    }

    pub fn bounds(&self) -> WidgetRect {
        let mut rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        unsafe {
            GetWindowRect(self.handle(), &mut rect);
        }
        rect_from(rect)
    }

    pub fn set_bounds(&self, bounds: WidgetRect) {
        unsafe {
            SetWindowPos(
                self.handle(),
                std::ptr::null_mut(),
                bounds.x,
                bounds.y,
                bounds.width,
                bounds.height,
                SWP_NOZORDER | SWP_NOACTIVATE,
            );
        }
    }

    pub fn scale(&self) -> f32 {
        let dpi = unsafe { GetDpiForWindow(self.handle()) };
        if dpi == 0 {
            1.0
        } else {
            dpi as f32 / 96.0
        }
    }

    pub fn begin_drag(&self) {
        unsafe {
            PostMessageW(self.handle(), WM_WIDGET_DRAG, 0, 0);
        }
    }

    pub fn set_timer(&self, delay: Option<Duration>) {
        unsafe {
            match delay {
                Some(delay) => {
                    let millis = delay.as_millis().clamp(1, u128::from(u32::MAX)) as u32;
                    SetTimer(self.handle(), FRAME_TIMER_ID, millis, None);
                }
                None => {
                    KillTimer(self.handle(), FRAME_TIMER_ID);
                }
            }
        }
    }

    pub fn bring_to_front(&self) {
        let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW;
        unsafe {
            let topmost =
                GetWindowLongPtrW(self.handle(), GWL_EXSTYLE) & WS_EX_TOPMOST as isize != 0;
            SetWindowPos(self.handle(), HWND_TOPMOST, 0, 0, 0, 0, flags);
            if !topmost {
                SetWindowPos(self.handle(), HWND_NOTOPMOST, 0, 0, 0, 0, flags);
            }
        }
    }

    pub fn show_menu(
        &self,
        items: &[LayeredMenuItem],
        screen_x: i32,
        screen_y: i32,
    ) -> Option<u32> {
        unsafe {
            let menu = CreatePopupMenu();
            if menu.is_null() {
                return None;
            }
            for item in items {
                let label = wide(&item.label);
                let flags = if item.checked {
                    MF_STRING | MF_CHECKED
                } else {
                    MF_STRING
                };
                AppendMenuW(menu, flags, item.id as usize, label.as_ptr());
            }
            let previous = GetForegroundWindow();
            SetForegroundWindow(self.handle());
            let selected = TrackPopupMenu(
                menu,
                TPM_RETURNCMD | TPM_RIGHTBUTTON | TPM_NONOTIFY,
                screen_x,
                screen_y,
                0,
                self.handle(),
                std::ptr::null(),
            );
            PostMessageW(self.handle(), WM_NULL, 0, 0);
            DestroyMenu(menu);
            if !previous.is_null() && previous != self.handle() {
                SetForegroundWindow(previous);
            }
            u32::try_from(selected).ok().filter(|id| *id != 0)
        }
    }

    fn handle(&self) -> HWND {
        self.hwnd as HWND
    }
}

impl Drop for LayeredWindow {
    fn drop(&mut self) {
        if self.owned && self.is_open() {
            unsafe {
                DestroyWindow(self.handle());
            }
        }
    }
}

impl LayeredWindowWaker {
    pub fn wake(&self) {
        unsafe {
            PostMessageW(self.hwnd as HWND, WM_WIDGET_WAKE, 0, 0);
        }
    }

    pub fn close(&self) {
        unsafe {
            PostMessageW(self.hwnd as HWND, WM_CLOSE, 0, 0);
        }
    }
}

pub fn screen_work_areas() -> (Vec<WidgetRect>, Option<WidgetRect>) {
    struct Collected {
        areas: Vec<WidgetRect>,
        primary: Option<WidgetRect>,
    }

    unsafe extern "system" fn collect(
        monitor: HMONITOR,
        _: HDC,
        _: *mut RECT,
        data: LPARAM,
    ) -> i32 {
        let collected = unsafe { &mut *(data as *mut Collected) };
        let mut info: MONITORINFO = unsafe { std::mem::zeroed() };
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if unsafe { GetMonitorInfoW(monitor, &mut info) } != 0 {
            let area = rect_from(info.rcWork);
            if info.dwFlags & MONITORINFOF_PRIMARY != 0 {
                collected.primary = Some(area);
            }
            collected.areas.push(area);
        }
        1
    }

    let mut collected = Collected {
        areas: Vec::new(),
        primary: None,
    };
    unsafe {
        EnumDisplayMonitors(
            std::ptr::null_mut(),
            std::ptr::null(),
            Some(collect),
            &mut collected as *mut Collected as LPARAM,
        );
    }
    (collected.areas, collected.primary)
}

fn register_class(class_name: &[u16]) {
    static REGISTER: Once = Once::new();
    REGISTER.call_once(|| unsafe {
        let class = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            lpfnWndProc: Some(window_proc),
            hInstance: GetModuleHandleW(std::ptr::null()),
            hCursor: LoadCursorW(std::ptr::null_mut(), IDC_ARROW),
            lpszClassName: class_name.as_ptr(),
            ..std::mem::zeroed()
        };
        RegisterClassExW(&class);
    });
}

fn state<'a>(hwnd: HWND) -> Option<&'a WindowState> {
    unsafe {
        let pointer = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *const WindowState;
        pointer.as_ref()
    }
}

fn dispatch(hwnd: HWND, event: LayeredWindowEvent) {
    let Some(state) = state(hwnd) else {
        return;
    };
    let Ok(mut handler) = state.handler.try_borrow_mut() else {
        state.pending.borrow_mut().push_back(event);
        return;
    };
    let window = LayeredWindow {
        hwnd: hwnd as isize,
        owned: false,
    };
    handler(&window, event);
    loop {
        let next = state.pending.borrow_mut().pop_front();
        let Some(next) = next else {
            break;
        };
        handler(&window, next);
    }
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match message {
        WM_NCCREATE => {
            let create = unsafe { &*(lparam as *const CREATESTRUCTW) };
            let slot = unsafe { &mut *(create.lpCreateParams as *mut Option<Box<WindowState>>) };
            if let Some(state) = slot.take() {
                unsafe { SetWindowLongPtrW(hwnd, GWLP_USERDATA, Box::into_raw(state) as isize) };
            }
        }
        WM_NCCALCSIZE => return 0,
        WM_NCDESTROY => {
            let pointer = unsafe { SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0) };
            if pointer != 0 {
                drop(unsafe { Box::from_raw(pointer as *mut WindowState) });
            }
        }
        WM_MOUSEACTIVATE => return MA_NOACTIVATE as LRESULT,
        WM_NCHITTEST => return hit_test(hwnd, lparam),
        WM_MOUSEMOVE => {
            if let Some(state) = state(hwnd) {
                if !state.tracking_leave.replace(true) {
                    let mut track = TRACKMOUSEEVENT {
                        cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
                        dwFlags: TME_LEAVE,
                        hwndTrack: hwnd,
                        dwHoverTime: 0,
                    };
                    unsafe { TrackMouseEvent(&mut track) };
                }
            }
            let (x, y) = client_point(lparam);
            dispatch(hwnd, LayeredWindowEvent::PointerMoved { x, y });
            return 0;
        }
        WM_MOUSELEAVE => {
            if let Some(state) = state(hwnd) {
                state.tracking_leave.set(false);
            }
            dispatch(hwnd, LayeredWindowEvent::PointerLeft);
            return 0;
        }
        WM_LBUTTONDOWN => {
            unsafe { SetCapture(hwnd) };
            let (x, y) = client_point(lparam);
            dispatch(hwnd, LayeredWindowEvent::PointerPressed { x, y });
            return 0;
        }
        WM_LBUTTONUP => {
            unsafe { ReleaseCapture() };
            let (x, y) = client_point(lparam);
            dispatch(hwnd, LayeredWindowEvent::PointerReleased { x, y });
            return 0;
        }
        WM_RBUTTONUP => {
            let (x, y) = client_point(lparam);
            let mut point = POINT {
                x: x as i32,
                y: y as i32,
            };
            unsafe { ClientToScreen(hwnd, &mut point) };
            dispatch(
                hwnd,
                LayeredWindowEvent::ContextMenu {
                    screen_x: point.x,
                    screen_y: point.y,
                },
            );
            return 0;
        }
        WM_TIMER if wparam == FRAME_TIMER_ID => {
            dispatch(hwnd, LayeredWindowEvent::Timer);
            return 0;
        }
        WM_WIDGET_WAKE => {
            dispatch(hwnd, LayeredWindowEvent::Wake);
            return 0;
        }
        WM_WIDGET_DRAG => {
            unsafe {
                ReleaseCapture();
                SendMessageW(hwnd, WM_NCLBUTTONDOWN, HTCAPTION as WPARAM, 0);
            }
            dispatch(hwnd, LayeredWindowEvent::DragFinished);
            return 0;
        }
        WM_SIZE => {
            let width = (lparam & 0xffff) as u32;
            let height = ((lparam >> 16) & 0xffff) as u32;
            dispatch(hwnd, LayeredWindowEvent::Resized { width, height });
            return 0;
        }
        WM_DPICHANGED => {
            let suggested = unsafe { &*(lparam as *const RECT) };
            unsafe {
                SetWindowPos(
                    hwnd,
                    std::ptr::null_mut(),
                    suggested.left,
                    suggested.top,
                    suggested.right - suggested.left,
                    suggested.bottom - suggested.top,
                    SWP_NOZORDER | SWP_NOACTIVATE,
                );
            }
            let dpi = (wparam >> 16) & 0xffff;
            dispatch(
                hwnd,
                LayeredWindowEvent::ScaleChanged {
                    scale: dpi as f32 / 96.0,
                },
            );
            return 0;
        }
        WM_EXITSIZEMOVE => {
            let bounds = LayeredWindow {
                hwnd: hwnd as isize,
                owned: false,
            }
            .bounds();
            dispatch(hwnd, LayeredWindowEvent::MoveSizeFinished { bounds });
            return 0;
        }
        WM_GETMINMAXINFO => {
            if let Some(state) = state(hwnd) {
                let scale = LayeredWindow {
                    hwnd: hwnd as isize,
                    owned: false,
                }
                .scale();
                let info = unsafe { &mut *(lparam as *mut MINMAXINFO) };
                info.ptMinTrackSize.x = (state.min_size.0 as f32 * scale).round() as i32;
                info.ptMinTrackSize.y = (state.min_size.1 as f32 * scale).round() as i32;
                return 0;
            }
        }
        WM_CLOSE => {
            unsafe { DestroyWindow(hwnd) };
            return 0;
        }
        WM_DESTROY => {
            unsafe { PostQuitMessage(0) };
            return 0;
        }
        _ => {}
    }
    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}

fn hit_test(hwnd: HWND, lparam: LPARAM) -> LRESULT {
    let Some(state) = state(hwnd) else {
        return HTCLIENT as LRESULT;
    };
    if state.click_through.get() {
        return HTTRANSPARENT as LRESULT;
    }
    let window = LayeredWindow {
        hwnd: hwnd as isize,
        owned: false,
    };
    let bounds = window.bounds();
    let border = (RESIZE_BORDER * window.scale()).round() as i32;
    let x = (lparam & 0xffff) as i16 as i32;
    let y = ((lparam >> 16) & 0xffff) as i16 as i32;
    let left = x < bounds.x + border;
    let right = x >= bounds.x + bounds.width - border;
    let top = y < bounds.y + border;
    let bottom = y >= bounds.y + bounds.height - border;
    let hit = match (left, right, top, bottom) {
        (true, _, true, _) => HTTOPLEFT,
        (_, true, true, _) => HTTOPRIGHT,
        (true, _, _, true) => HTBOTTOMLEFT,
        (_, true, _, true) => HTBOTTOMRIGHT,
        (true, _, _, _) => HTLEFT,
        (_, true, _, _) => HTRIGHT,
        (_, _, true, _) => HTTOP,
        (_, _, _, true) => HTBOTTOM,
        _ => HTCLIENT,
    };
    hit as LRESULT
}

fn client_point(lparam: LPARAM) -> (f32, f32) {
    let x = (lparam & 0xffff) as i16 as f32;
    let y = ((lparam >> 16) & 0xffff) as i16 as f32;
    (x, y)
}

fn rect_from(rect: RECT) -> WidgetRect {
    WidgetRect {
        x: rect.left,
        y: rect.top,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
    }
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(test)]
mod tests;
