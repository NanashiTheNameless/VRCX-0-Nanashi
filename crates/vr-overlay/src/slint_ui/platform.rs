use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
    sync::{Mutex, OnceLock},
};

use slint::{
    platform::{
        self,
        software_renderer::{MinimalSoftwareWindow, PremultipliedRgbaColor, RepaintBufferType},
        Platform, PlatformError, WindowAdapter,
    },
    ComponentHandle, Image, PhysicalSize, Rgba8Pixel, SharedPixelBuffer,
};

use crate::{AvatarBitmap, OverlaySize, RgbaFrame};

thread_local! {
    static LAST_CREATED_WINDOW: RefCell<Option<Rc<MinimalSoftwareWindow>>> = const { RefCell::new(None) };
}

thread_local! {
    static PLATFORM_SET: Cell<bool> = const { Cell::new(false) };
}

static PLATFORM_INIT_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

struct OverlaySlintPlatform;

impl Platform for OverlaySlintPlatform {
    fn create_window_adapter(&self) -> Result<Rc<dyn WindowAdapter>, PlatformError> {
        let window = MinimalSoftwareWindow::new(RepaintBufferType::ReusedBuffer);
        LAST_CREATED_WINDOW.with(|slot| {
            *slot.borrow_mut() = Some(Rc::clone(&window));
        });
        Ok(window)
    }
}

pub(super) type AvatarImageCache = HashMap<usize, (Arc<[u8]>, Image)>;

pub(super) fn cached_avatar_image(
    cache: &mut AvatarImageCache,
    avatar: Option<&AvatarBitmap>,
) -> (bool, Image) {
    let Some(avatar) = avatar else {
        return (false, Image::default());
    };
    let key = avatar_cache_key(avatar);
    if let Some((held, image)) = cache.get(&key) {
        if Arc::ptr_eq(held, &avatar.rgba) {
            return (true, image.clone());
        }
    }
    let (has_avatar, image) = avatar_image(Some(avatar));
    if has_avatar {
        cache.insert(key, (Arc::clone(&avatar.rgba), image.clone()));
    }
    (has_avatar, image)
}

pub(super) fn retain_avatar_images<'a>(
    cache: &mut AvatarImageCache,
    live: impl Iterator<Item = Option<&'a AvatarBitmap>>,
) {
    let live: HashSet<usize> = live.flatten().map(avatar_cache_key).collect();
    cache.retain(|key, _| live.contains(key));
}

pub(super) fn render_window_if_needed(
    window: &MinimalSoftwareWindow,
    buffer: &mut [PremultipliedRgbaColor],
    size: OverlaySize,
) -> Option<RgbaFrame> {
    platform::update_timers_and_animations();
    let redrawn = window.draw_if_needed(|renderer| {
        renderer.render(buffer, size.width as usize);
    });
    redrawn.then(|| RgbaFrame::new(size, pixels_to_rgba(buffer)))
}

/// Renders at the height the component asks for. Repeated rows are only
/// instantiated by a draw, so the measured height can change after rendering;
/// redraw until the window fits it.
pub(super) fn render_fitting_height(
    window: &MinimalSoftwareWindow,
    buffer: &mut Vec<PremultipliedRgbaColor>,
    size: &mut OverlaySize,
    required_height: impl Fn() -> u32,
) -> Option<RgbaFrame> {
    let mut frame = None;
    for _ in 0..3 {
        let height = required_height();
        if height != size.height {
            let next = OverlaySize::new(size.width, height);
            *buffer = vec![PremultipliedRgbaColor::default(); pixel_count(next).ok()?];
            window.set_size(PhysicalSize::new(next.width, next.height));
            *size = next;
            window.request_redraw();
        }
        frame = render_window_if_needed(window, buffer, *size).or(frame);
        if required_height() == size.height {
            break;
        }
    }
    frame
}

pub(super) fn ensure_platform() -> Result<(), String> {
    PLATFORM_SET.with(|set| {
        if set.get() {
            return Ok(());
        }
        let _guard = PLATFORM_INIT_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .map_err(|error| error.to_string())?;
        if set.get() {
            return Ok(());
        }
        let result = platform::set_platform(Box::new(OverlaySlintPlatform))
            .map_err(|error| error.to_string());
        if result.is_ok() {
            set.set(true);
        }
        result
    })
}

pub(super) fn create_component_window<C>(
    create: impl FnOnce() -> Result<C, PlatformError>,
) -> Result<(C, Rc<MinimalSoftwareWindow>), String>
where
    C: ComponentHandle,
{
    ensure_platform()?;
    take_last_created_window();
    let component = create().map_err(|error| error.to_string())?;
    let window = take_last_created_window()
        .ok_or_else(|| "Slint platform did not create a software window".to_string())?;
    Ok((component, window))
}

pub(super) fn pixel_count(size: OverlaySize) -> Result<usize, String> {
    RgbaFrame::expected_byte_len(size)
        .map(|bytes| bytes / 4)
        .ok_or_else(|| format!("invalid Slint panel size {}x{}", size.width, size.height))
}

pub(super) fn pixels_to_rgba(pixels: &[PremultipliedRgbaColor]) -> Arc<[u8]> {
    (0..pixels.len() * 4)
        .map(|index| {
            let pixel = &pixels[index / 4];
            match index % 4 {
                0 => pixel.red,
                1 => pixel.green,
                2 => pixel.blue,
                _ => pixel.alpha,
            }
        })
        .collect()
}

pub(super) fn to_slint_color(color: crate::Color) -> slint::Color {
    slint::Color::from_argb_u8(color.a, color.r, color.g, color.b)
}

fn take_last_created_window() -> Option<Rc<MinimalSoftwareWindow>> {
    LAST_CREATED_WINDOW.with(|slot| slot.borrow_mut().take())
}

fn avatar_cache_key(avatar: &AvatarBitmap) -> usize {
    Arc::as_ptr(&avatar.rgba) as *const u8 as usize
}

fn avatar_image(avatar: Option<&AvatarBitmap>) -> (bool, Image) {
    let Some(avatar) = avatar else {
        return (false, Image::default());
    };
    let expected_len = avatar
        .width
        .checked_mul(avatar.height)
        .and_then(|pixels| pixels.checked_mul(4))
        .map(|bytes| bytes as usize);
    if expected_len != Some(avatar.rgba.len()) {
        return (false, Image::default());
    }
    let buffer = SharedPixelBuffer::<Rgba8Pixel>::clone_from_slice(
        &avatar.rgba,
        avatar.width,
        avatar.height,
    );
    (true, Image::from_rgba8(buffer))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pixels_to_rgba_produces_shared_frame_storage_directly() {
        let pixels = [PremultipliedRgbaColor {
            red: 1,
            green: 2,
            blue: 3,
            alpha: 4,
        }];

        let rgba: Arc<[u8]> = pixels_to_rgba(&pixels);
        let data_ptr = rgba.as_ptr();
        let frame = RgbaFrame::new(OverlaySize::new(1, 1), rgba);

        assert_eq!(frame.data.as_ptr(), data_ptr);
        assert_eq!(frame.data.as_ref(), &[1, 2, 3, 4]);
    }
}
