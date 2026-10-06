use std::rc::Rc;

use slint::{
    platform::software_renderer::{MinimalSoftwareWindow, PremultipliedRgbaColor},
    ComponentHandle, ModelRc, PhysicalSize, SharedString, VecModel,
};

use crate::{FeedRelation, FeedSeverity, MainSurfaceModel, OverlaySize, RgbaFrame, ToastCard};

use super::platform::{
    cached_avatar_image, create_component_window, pixel_count, render_fitting_height,
    retain_avatar_images, to_slint_color, AvatarImageCache,
};
use super::surface::SlintSurfaceHost;
use super::{HmdToastItem, HmdToastPanel};

pub struct SlintHmdHost {
    /// Canvas width from the model; `size` is the rendered frame, as tall as
    /// the cards need.
    base_size: OverlaySize,
    size: OverlaySize,
    window: Rc<MinimalSoftwareWindow>,
    component: HmdToastPanel,
    buffer: Vec<PremultipliedRgbaColor>,
    avatar_images: AvatarImageCache,
}

impl SlintSurfaceHost for SlintHmdHost {
    type Model = MainSurfaceModel;
    const LABEL: &'static str = "HMD";

    fn new(size: OverlaySize) -> Result<Self, String> {
        let (component, window) = create_component_window(HmdToastPanel::new)?;
        window.set_size(PhysicalSize::new(size.width, size.height));
        component.show().map_err(|error| error.to_string())?;
        Ok(Self {
            base_size: size,
            size,
            window,
            component,
            buffer: vec![PremultipliedRgbaColor::default(); pixel_count(size)?],
            avatar_images: AvatarImageCache::new(),
        })
    }

    fn size(&self) -> OverlaySize {
        self.size
    }

    fn accepts_size(&self, size: OverlaySize) -> bool {
        self.base_size == size
    }

    fn model_size(model: &MainSurfaceModel) -> OverlaySize {
        model.size
    }

    fn window(&self) -> &slint::Window {
        self.component.window()
    }

    fn write_model(&mut self, model: &MainSurfaceModel) {
        retain_avatar_images(
            &mut self.avatar_images,
            model.toasts.iter().map(visible_toast_avatar),
        );
        self.component.set_dark_background(model.dark_background);
        self.component.set_compact(model.compact);
        self.component.set_stack_upward(model.stack_upward);
        self.component
            .set_text_scale(f32::from(model.text_percent) / 100.0);
        self.component
            .set_toasts(hmd_toast_model(model, &mut self.avatar_images));
    }

    fn render_if_needed(&mut self) -> Option<RgbaFrame> {
        let component = &self.component;
        render_fitting_height(&self.window, &mut self.buffer, &mut self.size, || {
            (component.get_required_height().ceil() as u32).max(1)
        })
    }
}

fn visible_toast_avatar(toast: &ToastCard) -> Option<&crate::AvatarBitmap> {
    if toast.show_avatar {
        toast.avatar.as_ref()
    } else {
        None
    }
}

pub(super) fn hmd_toast_model(
    model: &MainSurfaceModel,
    cache: &mut AvatarImageCache,
) -> ModelRc<HmdToastItem> {
    let mut items = model
        .toasts
        .iter()
        .rev()
        .take(3)
        .map(|toast| hmd_toast_item(toast, model.accent, cache))
        .collect::<Vec<_>>();
    if model.stack_upward {
        items.reverse();
    }
    ModelRc::new(VecModel::from(items))
}

fn hmd_toast_item(
    toast: &ToastCard,
    accent: crate::Color,
    cache: &mut AvatarImageCache,
) -> HmdToastItem {
    let (has_avatar, avatar) = cached_avatar_image(cache, visible_toast_avatar(toast));
    HmdToastItem {
        actor: SharedString::from(toast.actor_name.trim()),
        action: SharedString::from(toast.action.as_str()),
        avatar,
        has_avatar,
        show_avatar: toast.show_avatar,
        is_favorite: toast.relation == FeedRelation::Favorite,
        relation_color: hmd_relation_color(toast.relation),
        severity_color: hmd_severity_color(toast.severity, accent),
    }
}

fn hmd_relation_color(relation: FeedRelation) -> slint::Color {
    match relation {
        FeedRelation::Favorite => slint::Color::from_rgb_u8(245, 205, 84),
        FeedRelation::Friend => slint::Color::from_rgb_u8(246, 246, 246),
        FeedRelation::None => slint::Color::from_rgb_u8(238, 238, 238),
    }
}

fn hmd_severity_color(severity: FeedSeverity, accent: crate::Color) -> slint::Color {
    match severity {
        FeedSeverity::Important => slint::Color::from_rgb_u8(245, 158, 11),
        FeedSeverity::Warning => slint::Color::from_rgb_u8(239, 68, 68),
        FeedSeverity::Normal => to_slint_color(accent),
    }
}
