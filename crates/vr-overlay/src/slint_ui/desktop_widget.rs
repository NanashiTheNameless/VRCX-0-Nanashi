use std::cell::RefCell;
use std::rc::Rc;

use slint::{
    platform::{
        software_renderer::{MinimalSoftwareWindow, PremultipliedRgbaColor},
        PointerEventButton, WindowEvent,
    },
    ComponentHandle, LogicalPosition, Model, ModelRc, PhysicalSize, SharedString, VecModel,
};

use crate::{DesktopWidgetAction, DesktopWidgetRow, DesktopWidgetSurfaceModel};

use super::platform::{
    cached_avatar_image, create_component_window, retain_avatar_images, AvatarImageCache,
};
use super::{DesktopWidgetPanel, DesktopWidgetRowItem};

pub struct SlintDesktopWidgetHost {
    window: Rc<MinimalSoftwareWindow>,
    component: DesktopWidgetPanel,
    rows: Rc<VecModel<DesktopWidgetRowItem>>,
    row_ids: Rc<RefCell<Vec<u64>>>,
    actions: Rc<RefCell<Vec<DesktopWidgetAction>>>,
    avatar_images: AvatarImageCache,
    buffer: Vec<PremultipliedRgbaColor>,
    width: u32,
    height: u32,
    scale: f32,
}

impl SlintDesktopWidgetHost {
    pub fn new(width: u32, height: u32, scale: f32) -> Result<Self, String> {
        let (component, window) = create_component_window(DesktopWidgetPanel::new)?;
        let rows = Rc::new(VecModel::default());
        component.set_rows(ModelRc::from(Rc::clone(&rows)));
        let row_ids = Rc::new(RefCell::new(Vec::new()));
        let actions = Rc::new(RefCell::new(Vec::new()));
        let row_action = |make: fn(u64) -> DesktopWidgetAction| {
            let row_ids = Rc::clone(&row_ids);
            let actions = Rc::clone(&actions);
            move |index: i32| {
                let id = usize::try_from(index)
                    .ok()
                    .and_then(|index| row_ids.borrow().get(index).copied());
                if let Some(id) = id {
                    actions.borrow_mut().push(make(id));
                }
            }
        };
        component.on_actor_clicked(row_action(DesktopWidgetAction::Actor));
        component.on_detail_clicked(row_action(DesktopWidgetAction::Detail));
        let drag_actions = Rc::clone(&actions);
        component.on_drag_requested(move || {
            drag_actions.borrow_mut().push(DesktopWidgetAction::Drag);
        });
        let mut host = Self {
            window,
            component,
            rows,
            row_ids,
            actions,
            avatar_images: AvatarImageCache::new(),
            buffer: Vec::new(),
            width: 0,
            height: 0,
            scale: 1.0,
        };
        host.set_scale_factor(scale);
        host.resize(width, height);
        host.component.show().map_err(|error| error.to_string())?;
        Ok(host)
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        let width = width.max(1);
        let height = height.max(1);
        if (width, height) == (self.width, self.height) {
            return;
        }
        self.width = width;
        self.height = height;
        self.buffer = vec![PremultipliedRgbaColor::default(); width as usize * height as usize];
        self.window.set_size(PhysicalSize::new(width, height));
        self.window.request_redraw();
    }

    pub fn set_scale_factor(&mut self, scale: f32) {
        if scale <= 0.0 || (scale - self.scale).abs() < f32::EPSILON {
            return;
        }
        self.scale = scale;
        self.window.dispatch_event(WindowEvent::ScaleFactorChanged {
            scale_factor: scale,
        });
        self.window
            .set_size(PhysicalSize::new(self.width, self.height));
        self.window.request_redraw();
    }

    pub fn write_model(&mut self, model: &DesktopWidgetSurfaceModel) {
        retain_avatar_images(
            &mut self.avatar_images,
            model.rows.iter().map(|row| row.avatar.as_ref()),
        );
        self.component
            .set_background_alpha(f32::from(model.background_opacity.min(100)) / 100.0);
        self.component.set_grab_floor(model.interactive);
        self.component
            .set_show_frame(model.interactive && model.hovered);
        self.component.set_newest_on_top(model.newest_on_top);
        if model.newest_on_top {
            self.sync_rows(model.rows.iter().rev());
        } else {
            self.sync_rows(model.rows.iter());
        }
        self.window.request_redraw();
    }

    pub fn render_bgra(&mut self, out: &mut [u8]) -> bool {
        slint::platform::update_timers_and_animations();
        let width = self.width as usize;
        let buffer = &mut self.buffer;
        let redrawn = self.window.draw_if_needed(|renderer| {
            renderer.render(buffer, width);
        });
        if redrawn {
            for (pixel, target) in self.buffer.iter().zip(out.as_chunks_mut::<4>().0) {
                *target = [pixel.blue, pixel.green, pixel.red, pixel.alpha];
            }
        }
        redrawn
    }

    pub fn is_animating(&self) -> bool {
        self.component.window().has_active_animations()
            || slint::platform::duration_until_next_timer_update().is_some()
    }

    pub fn pointer_moved(&mut self, x: f32, y: f32) {
        let position = self.logical(x, y);
        self.window
            .dispatch_event(WindowEvent::PointerMoved { position });
    }

    pub fn pointer_pressed(&mut self, x: f32, y: f32) {
        let position = self.logical(x, y);
        self.window.dispatch_event(WindowEvent::PointerPressed {
            position,
            button: PointerEventButton::Left,
        });
    }

    pub fn pointer_released(&mut self, x: f32, y: f32) {
        let position = self.logical(x, y);
        self.window.dispatch_event(WindowEvent::PointerReleased {
            position,
            button: PointerEventButton::Left,
        });
    }

    pub fn pointer_left(&mut self) {
        self.window.dispatch_event(WindowEvent::PointerExited);
    }

    pub fn take_actions(&mut self) -> Vec<DesktopWidgetAction> {
        std::mem::take(&mut *self.actions.borrow_mut())
    }

    fn logical(&self, x: f32, y: f32) -> LogicalPosition {
        LogicalPosition::new(x / self.scale, y / self.scale)
    }

    fn sync_rows<'a>(&mut self, rows: impl Iterator<Item = &'a DesktopWidgetRow> + Clone) {
        let mut ids = self.row_ids.borrow_mut();
        let mut index = 0;
        while index < ids.len() {
            if rows.clone().any(|row| row.id == ids[index]) {
                index += 1;
            } else {
                ids.remove(index);
                self.rows.remove(index);
            }
        }
        for (target, row) in rows.enumerate() {
            let item = row_item(row, &mut self.avatar_images);
            match ids.iter().position(|id| *id == row.id) {
                Some(current) if current == target => {
                    if self.rows.row_data(target).as_ref() != Some(&item) {
                        self.rows.set_row_data(target, item);
                    }
                }
                Some(current) => {
                    ids.remove(current);
                    self.rows.remove(current);
                    ids.insert(target, row.id);
                    self.rows.insert(target, item);
                }
                None => {
                    ids.insert(target, row.id);
                    self.rows.insert(target, item);
                }
            }
        }
    }
}

fn row_item(row: &DesktopWidgetRow, cache: &mut AvatarImageCache) -> DesktopWidgetRowItem {
    let (has_avatar, avatar) = cached_avatar_image(cache, row.avatar.as_ref());
    DesktopWidgetRowItem {
        time: SharedString::from(row.time_text.as_str()),
        actor: SharedString::from(row.actor.as_str()),
        detail: SharedString::from(row.detail.as_str()),
        favorite: row.favorite,
        warning: row.warning,
        show_avatar_slot: row.show_avatar_slot,
        has_avatar,
        avatar,
    }
}

#[cfg(test)]
mod tests;
