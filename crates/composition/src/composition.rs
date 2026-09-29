use std::sync::Arc;

use vrcx_0_application_core::LocalGameContextSource;
use vrcx_0_application_realtime::FriendProjectionObserver;

use crate::{GroupOrderSource, RuntimeHostState};

pub trait RuntimeHostProfileExtension: Send + Sync {
    fn start_profile_services(&self, _state: &RuntimeHostState) {}

    fn stop_profile_services(&self) {}

    fn start_profile_maintenance(&self, _state: &RuntimeHostState) {}
}

pub struct RuntimeHostComposition {
    pub local_game_context: Arc<dyn LocalGameContextSource>,
    pub group_order_source: Arc<dyn GroupOrderSource>,
    pub friend_projection_observer: Option<Arc<dyn FriendProjectionObserver>>,
    pub profile_extension: Option<Arc<dyn RuntimeHostProfileExtension>>,
}
