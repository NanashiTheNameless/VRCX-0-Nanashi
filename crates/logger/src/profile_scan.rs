use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use vrcx_0_logger_protocol::wire::ProfileCheck;

use crate::runtime::lock;
use crate::store::Store;

const ENABLED_COUNTER: &str = "profile_scan_enabled";

pub struct ProfileScan {
    store: Arc<Store>,
    enabled: AtomicBool,
    friends: Mutex<Vec<String>>,
    checked_at: Mutex<HashMap<String, i64>>,
}

impl ProfileScan {
    pub fn new(store: Arc<Store>) -> Self {
        let enabled = store.counter(ENABLED_COUNTER).is_ok_and(|value| value == 1);
        Self {
            store,
            enabled: AtomicBool::new(enabled),
            friends: Mutex::new(Vec::new()),
            checked_at: Mutex::new(HashMap::new()),
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Acquire)
    }

    pub fn configure(&self, enabled: bool, checks: Vec<ProfileCheck>) {
        if self.enabled.swap(enabled, Ordering::AcqRel) != enabled {
            if let Err(error) = self.store.set_counter(ENABLED_COUNTER, u64::from(enabled)) {
                tracing::warn!(error = %error, "failed to persist the profile scan setting");
            }
        }
        let mut checked_at = lock(&self.checked_at);
        for check in checks {
            let entry = checked_at.entry(check.user_id).or_insert(check.checked_at);
            *entry = (*entry).max(check.checked_at);
        }
    }

    pub fn set_friends(&self, friends: Vec<String>) {
        *lock(&self.friends) = friends;
    }

    pub fn mark_checked(&self, user_id: &str, at: i64) {
        lock(&self.checked_at).insert(user_id.to_string(), at);
    }

    pub fn next_stale(&self, checked_before: i64) -> Option<String> {
        let friends = lock(&self.friends);
        let checked_at = lock(&self.checked_at);
        friends
            .iter()
            .filter_map(|user_id| match checked_at.get(user_id) {
                None => Some((None, user_id)),
                Some(&at) if at < checked_before => Some((Some(at), user_id)),
                Some(_) => None,
            })
            .min_by_key(|(at, _)| *at)
            .map(|(_, user_id)| user_id.clone())
    }
}

#[cfg(test)]
mod tests {
    use vrcx_0_logger_protocol::wire::PresenceRequest;

    use super::*;
    use crate::app::App;
    use crate::test_support::{fresh_app, open_store, start, temp_dir, Desktop, ACCOUNT, PASSWORD};

    const DUE_BEFORE: i64 = 100;

    fn check(user_id: &str, checked_at: i64) -> ProfileCheck {
        ProfileCheck {
            user_id: user_id.into(),
            checked_at,
        }
    }

    async fn desktop_reports(app: &Arc<App>, enabled: bool, checks: Vec<ProfileCheck>) {
        Desktop::new(app)
            .report_presence(PresenceRequest {
                account_id: ACCOUNT.into(),
                leaving: true,
                profile_scan: enabled,
                profile_checks: checks,
            })
            .await;
    }

    fn check_order(app: &App) -> Vec<String> {
        let mut order = Vec::new();
        while let Some(user_id) = app.profile_scan.next_stale(DUE_BEFORE) {
            app.profile_scan.mark_checked(&user_id, DUE_BEFORE + 1);
            order.push(user_id);
        }
        order
    }

    #[tokio::test]
    async fn bio_checks_go_to_never_checked_friends_first_then_the_stalest() {
        let app = fresh_app();
        desktop_reports(&app, true, vec![check("usr_a", 50), check("usr_b", 10)]).await;
        app.profile_scan
            .set_friends(vec!["usr_a".into(), "usr_b".into(), "usr_c".into()]);

        assert_eq!(check_order(&app), ["usr_c", "usr_b", "usr_a"]);
    }

    #[tokio::test]
    async fn a_friend_the_desktop_checked_recently_is_not_checked_again() {
        let app = fresh_app();
        desktop_reports(&app, true, vec![check("usr_a", DUE_BEFORE + 50)]).await;
        app.profile_scan
            .set_friends(vec!["usr_a".into(), "usr_b".into()]);

        assert_eq!(check_order(&app), ["usr_b"]);
    }

    #[tokio::test]
    async fn an_older_seed_from_the_desktop_never_rolls_a_check_back() {
        let app = fresh_app();
        app.profile_scan.set_friends(vec!["usr_a".into()]);
        app.profile_scan.mark_checked("usr_a", DUE_BEFORE + 100);

        desktop_reports(&app, true, vec![check("usr_a", 50)]).await;

        assert!(check_order(&app).is_empty());
    }

    #[tokio::test]
    async fn the_bio_check_setting_survives_a_restart() {
        let dir = temp_dir();
        let app = start(open_store(&dir, PASSWORD).0);
        assert!(!app.profile_scan.is_enabled());

        desktop_reports(&app, true, Vec::new()).await;
        let restarted = start(open_store(&dir, PASSWORD).0);
        assert!(restarted.profile_scan.is_enabled());

        desktop_reports(&restarted, false, Vec::new()).await;
        let restarted_again = start(open_store(&dir, PASSWORD).0);
        assert!(!restarted_again.profile_scan.is_enabled());
    }
}
