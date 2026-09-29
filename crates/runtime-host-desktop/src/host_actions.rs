use std::sync::{Arc, Mutex};

use vrcx_0_application_core::{RuntimeVrchatAuthFailureObserver, RuntimeVrchatAuthFailurePayload};

pub trait RuntimeHostActions: Send + Sync {
    fn focus_main_window(&self);
    fn set_tray_icon_notification(&self, notify: bool);
    fn vrchat_auth_failed(&self, failure: &RuntimeVrchatAuthFailurePayload);
    fn refresh_tray_menu(&self);
}

#[derive(Clone, Default)]
pub struct RuntimeHost {
    state: Arc<Mutex<RuntimeHostState>>,
}

#[derive(Default)]
struct RuntimeHostState {
    actions: Option<Arc<dyn RuntimeHostActions>>,
    tray_icon_notification: Option<bool>,
}

impl RuntimeHost {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_actions<A>(&self, actions: A)
    where
        A: RuntimeHostActions + 'static,
    {
        let actions: Arc<dyn RuntimeHostActions> = Arc::new(actions);
        let tray_icon_notification = {
            let mut state = self.state.lock().unwrap();
            state.actions = Some(Arc::clone(&actions));
            state.tray_icon_notification
        };
        if let Some(notify) = tray_icon_notification {
            actions.set_tray_icon_notification(notify);
        }
    }

    fn actions(&self) -> Option<Arc<dyn RuntimeHostActions>> {
        self.state.lock().unwrap().actions.clone()
    }

    pub fn focus_main_window(&self) {
        if let Some(actions) = self.actions() {
            actions.focus_main_window();
        }
    }

    pub fn set_tray_icon_notification(&self, notify: bool) {
        let actions = {
            let mut state = self.state.lock().unwrap();
            state.tray_icon_notification = Some(notify);
            state.actions.clone()
        };
        if let Some(actions) = actions {
            actions.set_tray_icon_notification(notify);
        }
    }

    pub(crate) fn refresh_tray_menu(&self) {
        if let Some(actions) = self.actions() {
            actions.refresh_tray_menu();
        }
    }
}

impl RuntimeVrchatAuthFailureObserver for RuntimeHost {
    fn runtime_vrchat_auth_failed(&self, failure: &RuntimeVrchatAuthFailurePayload) {
        if let Some(actions) = self.actions() {
            actions.vrchat_auth_failed(failure);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    use super::{
        RuntimeHost, RuntimeHostActions, RuntimeVrchatAuthFailureObserver,
        RuntimeVrchatAuthFailurePayload,
    };

    struct LockCheckingActions {
        host: RuntimeHost,
        tray_calls: Arc<AtomicUsize>,
    }

    impl RuntimeHostActions for LockCheckingActions {
        fn focus_main_window(&self) {}

        fn set_tray_icon_notification(&self, _notify: bool) {
            assert!(self.host.state.try_lock().is_ok());
            self.tray_calls.fetch_add(1, Ordering::Relaxed);
        }

        fn vrchat_auth_failed(&self, _failure: &RuntimeVrchatAuthFailurePayload) {}

        fn refresh_tray_menu(&self) {}
    }

    #[test]
    fn tray_actions_run_after_runtime_host_state_is_unlocked() {
        let host = RuntimeHost::new();
        let tray_calls = Arc::new(AtomicUsize::new(0));
        host.set_tray_icon_notification(true);
        host.set_actions(LockCheckingActions {
            host: host.clone(),
            tray_calls: Arc::clone(&tray_calls),
        });
        host.set_tray_icon_notification(false);

        assert_eq!(tray_calls.load(Ordering::Relaxed), 2);
    }

    struct AuthFailureRecordingActions {
        failures: Arc<std::sync::Mutex<Vec<String>>>,
    }

    impl RuntimeHostActions for AuthFailureRecordingActions {
        fn focus_main_window(&self) {}

        fn set_tray_icon_notification(&self, _notify: bool) {}

        fn vrchat_auth_failed(&self, failure: &RuntimeVrchatAuthFailurePayload) {
            self.failures.lock().unwrap().push(failure.reason.clone());
        }

        fn refresh_tray_menu(&self) {}
    }

    #[test]
    fn auth_failures_are_forwarded_to_the_host_actions() {
        let host = RuntimeHost::new();
        let failures = Arc::new(std::sync::Mutex::new(Vec::new()));
        host.set_actions(AuthFailureRecordingActions {
            failures: Arc::clone(&failures),
        });

        host.runtime_vrchat_auth_failed(&RuntimeVrchatAuthFailurePayload {
            owner_user_id: vrcx_0_core::OwnerId::new("usr_a"),
            endpoint: "https://api.vrchat.cloud/api/1".into(),
            path: "auth/user".into(),
            reason: "HTTP 401".into(),
            status_code: 401,
            auth_scope_generation: 1,
            realtime_transport: None,
        });

        assert_eq!(*failures.lock().unwrap(), vec!["HTTP 401".to_string()]);
    }
}
