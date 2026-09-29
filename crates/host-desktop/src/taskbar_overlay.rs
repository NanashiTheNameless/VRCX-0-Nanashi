#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(target_os = "windows")]
static TASKBAR_OVERLAY_NOTIFY: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "windows")]
const DOT_RGB: (u8, u8, u8) = (255, 0, 0);

#[cfg(target_os = "windows")]
const OVERLAY_DESCRIPTION: &[u16] = &[
    b'N' as u16,
    b'e' as u16,
    b'w' as u16,
    b' ' as u16,
    b'n' as u16,
    b'o' as u16,
    b't' as u16,
    b'i' as u16,
    b'f' as u16,
    b'i' as u16,
    b'c' as u16,
    b'a' as u16,
    b't' as u16,
    b'i' as u16,
    b'o' as u16,
    b'n' as u16,
    0,
];

#[cfg(target_os = "windows")]
pub fn set_taskbar_overlay_notification(window_handle: isize, notify: bool) {
    TASKBAR_OVERLAY_NOTIFY.store(notify, Ordering::Release);
    apply_overlay(window_handle, notify);
}

#[cfg(target_os = "windows")]
pub fn reapply_taskbar_overlay_notification(window_handle: isize) {
    apply_overlay(
        window_handle,
        TASKBAR_OVERLAY_NOTIFY.load(Ordering::Acquire),
    );
}

#[cfg(target_os = "windows")]
pub fn forget_taskbar_overlay_notification() {
    TASKBAR_OVERLAY_NOTIFY.store(false, Ordering::Release);
}

#[cfg(target_os = "windows")]
fn apply_overlay(window_handle: isize, notify: bool) {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, HICON};

    if window_handle == 0 {
        return;
    }
    let window = HWND(window_handle as *mut core::ffi::c_void);

    with_taskbar_list(|taskbar| {
        if !notify {
            if let Err(error) =
                unsafe { taskbar.SetOverlayIcon(window, HICON::default(), PCWSTR::null()) }
            {
                tracing::warn!(%error, "Failed to clear the taskbar overlay icon");
            }
            return;
        }

        let Some(icon) = create_dot_icon(window) else {
            return;
        };
        let result =
            unsafe { taskbar.SetOverlayIcon(window, icon, PCWSTR(OVERLAY_DESCRIPTION.as_ptr())) };
        if let Err(error) = result {
            tracing::warn!(%error, "Failed to set the taskbar overlay icon");
        }
        let _ = unsafe { DestroyIcon(icon) };
    });
}

#[cfg(target_os = "windows")]
fn with_taskbar_list(action: impl FnOnce(&windows::Win32::UI::Shell::ITaskbarList3)) {
    use std::cell::RefCell;

    use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{ITaskbarList3, TaskbarList};

    thread_local! {
        static COM_READY: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
        static TASKBAR: RefCell<Option<ITaskbarList3>> = const { RefCell::new(None) };
    }

    COM_READY.with(|ready| {
        if ready.get() {
            return;
        }
        let result = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        if result.is_err() && result != RPC_E_CHANGED_MODE {
            tracing::warn!(result = %result.0, "Failed to initialize COM for the taskbar overlay");
        }
        ready.set(true);
    });

    TASKBAR.with(|cell| {
        let mut slot = cell.borrow_mut();
        if slot.is_none() {
            let created = unsafe { CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER) }
                .and_then(|taskbar: ITaskbarList3| unsafe { taskbar.HrInit() }.map(|()| taskbar));
            match created {
                Ok(taskbar) => *slot = Some(taskbar),
                Err(error) => {
                    tracing::warn!(%error, "Failed to create the taskbar list instance");
                    return;
                }
            }
        }
        if let Some(taskbar) = slot.as_ref() {
            action(taskbar);
        }
    });
}

#[cfg(target_os = "windows")]
fn create_dot_icon(
    window: windows::Win32::Foundation::HWND,
) -> Option<windows::Win32::UI::WindowsAndMessaging::HICON> {
    use windows::Win32::Graphics::Gdi::{
        CreateBitmap, CreateDIBSection, DeleteObject, BITMAPINFO, BITMAPV5HEADER, BI_BITFIELDS,
        DIB_RGB_COLORS,
    };
    use windows::Win32::UI::HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi};
    use windows::Win32::UI::WindowsAndMessaging::{CreateIconIndirect, ICONINFO, SM_CXSMICON};

    let dpi = match unsafe { GetDpiForWindow(window) } {
        0 => 96,
        dpi => dpi,
    };
    let size = overlay_icon_size(unsafe { GetSystemMetricsForDpi(SM_CXSMICON, dpi) });

    let mut header = BITMAPV5HEADER {
        bV5Size: std::mem::size_of::<BITMAPV5HEADER>() as u32,
        bV5Width: size as i32,
        bV5Height: -(size as i32),
        bV5Planes: 1,
        bV5BitCount: 32,
        bV5Compression: BI_BITFIELDS,
        bV5RedMask: 0x00FF_0000,
        bV5GreenMask: 0x0000_FF00,
        bV5BlueMask: 0x0000_00FF,
        bV5AlphaMask: 0xFF00_0000,
        ..Default::default()
    };

    let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
    let color = unsafe {
        CreateDIBSection(
            None,
            &mut header as *mut BITMAPV5HEADER as *const BITMAPINFO,
            DIB_RGB_COLORS,
            &mut bits,
            None,
            0,
        )
    }
    .ok()?;
    if bits.is_null() {
        let _ = unsafe { DeleteObject(color.into()) };
        return None;
    }

    let pixels = render_dot_premultiplied_bgra(size);
    unsafe {
        std::ptr::copy_nonoverlapping(pixels.as_ptr(), bits as *mut u32, pixels.len());
    }

    let mask = unsafe { CreateBitmap(size as i32, size as i32, 1, 1, None) };
    let info = ICONINFO {
        fIcon: true.into(),
        xHotspot: 0,
        yHotspot: 0,
        hbmMask: mask,
        hbmColor: color,
    };
    let icon = unsafe { CreateIconIndirect(&info) };

    let _ = unsafe { DeleteObject(mask.into()) };
    let _ = unsafe { DeleteObject(color.into()) };

    match icon {
        Ok(icon) => Some(icon),
        Err(error) => {
            tracing::warn!(%error, "Failed to build the taskbar overlay icon");
            None
        }
    }
}

#[cfg(target_os = "windows")]
fn overlay_icon_size(raw_small_icon_metric: i32) -> u32 {
    if raw_small_icon_metric <= 0 {
        return 16;
    }
    (raw_small_icon_metric as u32).clamp(8, 64)
}

#[cfg(target_os = "windows")]
fn render_dot_premultiplied_bgra(size: u32) -> Vec<u32> {
    const SAMPLES: u32 = 4;

    let radius = size as f32 / 4.0;
    let center = size as f32 / 2.0;
    let mut pixels = Vec::with_capacity((size * size) as usize);

    for y in 0..size {
        for x in 0..size {
            let mut covered = 0u32;
            for sub_y in 0..SAMPLES {
                for sub_x in 0..SAMPLES {
                    let sample_x = x as f32 + (sub_x as f32 + 0.5) / SAMPLES as f32 - center;
                    let sample_y = y as f32 + (sub_y as f32 + 0.5) / SAMPLES as f32 - center;
                    if sample_x * sample_x + sample_y * sample_y <= radius * radius {
                        covered += 1;
                    }
                }
            }
            let alpha = (covered * 255) / (SAMPLES * SAMPLES);
            let scale = |channel: u8| (channel as u32 * alpha) / 255;
            pixels.push(
                (alpha << 24)
                    | (scale(DOT_RGB.0) << 16)
                    | (scale(DOT_RGB.1) << 8)
                    | scale(DOT_RGB.2),
            );
        }
    }

    pixels
}

#[cfg(not(target_os = "windows"))]
pub fn set_taskbar_overlay_notification(_window_handle: isize, _notify: bool) {}

#[cfg(not(target_os = "windows"))]
pub fn reapply_taskbar_overlay_notification(_window_handle: isize) {}

#[cfg(not(target_os = "windows"))]
pub fn forget_taskbar_overlay_notification() {}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::{overlay_icon_size, render_dot_premultiplied_bgra, DOT_RGB};

    #[test]
    fn overlay_icon_size_keeps_usual_metrics_and_clamps_unusable_ones() {
        assert_eq!(overlay_icon_size(0), 16);
        assert_eq!(overlay_icon_size(-4), 16);
        for metric in [16, 20, 24, 32] {
            assert_eq!(overlay_icon_size(metric), metric as u32);
        }
        assert_eq!(overlay_icon_size(4), 8);
        assert_eq!(overlay_icon_size(512), 64);
    }

    #[test]
    fn fills_the_center_and_leaves_the_corners_transparent() {
        let size = 16u32;
        let pixels = render_dot_premultiplied_bgra(size);
        let center = pixels[((size / 2) * size + size / 2) as usize];
        assert_eq!(
            center,
            0xFF00_0000 | ((DOT_RGB.0 as u32) << 16) | ((DOT_RGB.1 as u32) << 8) | DOT_RGB.2 as u32
        );

        let last = (size - 1) as usize;
        let stride = size as usize;
        for corner in [0, last, last * stride, last * stride + last] {
            assert_eq!(pixels[corner], 0);
        }
        assert_eq!(pixels[size as usize / 2], 0);
    }

    #[test]
    fn keeps_every_channel_premultiplied_by_alpha() {
        for size in [8u32, 16, 24, 64] {
            for pixel in render_dot_premultiplied_bgra(size) {
                let alpha = pixel >> 24;
                assert!((pixel >> 16) & 0xFF <= alpha);
                assert!((pixel >> 8) & 0xFF <= alpha);
                assert!(pixel & 0xFF <= alpha);
            }
        }
    }
}
