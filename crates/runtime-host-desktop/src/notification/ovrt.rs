use vrcx_0_application_activity::notification::RenderedNotification;
use vrcx_0_host_desktop::overlay_notifications::OvrToolkit;

use super::NotificationDeliveryPlan;

const NOTIFICATION_APP_TITLE: &str = "VRCX-0-Nanashi";

pub(super) fn send_ovrt_notification(
    ovrt: &OvrToolkit,
    plan: NotificationDeliveryPlan,
    render: &RenderedNotification,
    local_image: Option<&str>,
) {
    ovrt.send_notification(
        plan.ovrt_hud,
        plan.ovrt_wrist,
        NOTIFICATION_APP_TITLE,
        &render.text,
        local_image,
    );
}
