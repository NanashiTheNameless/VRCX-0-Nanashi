pub enum AcquireAttempt<T> {
    Acquired(T),
    Contended,
    Failed,
}

pub fn acquire_or_notify_with_retry<T>(
    retries: usize,
    mut acquire: impl FnMut() -> AcquireAttempt<T>,
    mut notify: impl FnMut() -> bool,
    mut wait: impl FnMut(),
) -> Option<T> {
    for attempt in 0..=retries {
        match acquire() {
            AcquireAttempt::Acquired(guard) => return Some(guard),
            AcquireAttempt::Failed => {
                notify();
                return None;
            }
            AcquireAttempt::Contended => {
                if notify() || attempt == retries {
                    return None;
                }
                wait();
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;

    use super::{acquire_or_notify_with_retry, AcquireAttempt};

    #[test]
    fn acquires_without_notifying_or_waiting() {
        let mut notifications = 0;
        let mut waits = 0;

        let guard = acquire_or_notify_with_retry(
            3,
            || AcquireAttempt::Acquired("guard"),
            || {
                notifications += 1;
                false
            },
            || waits += 1,
        );

        assert_eq!(guard, Some("guard"));
        assert_eq!(notifications, 0);
        assert_eq!(waits, 0);
    }

    #[test]
    fn notifies_a_running_instance_without_waiting() {
        let mut waits = 0;

        let guard = acquire_or_notify_with_retry::<()>(
            3,
            || AcquireAttempt::Contended,
            || true,
            || waits += 1,
        );

        assert!(guard.is_none());
        assert_eq!(waits, 0);
    }

    #[test]
    fn waits_for_restart_handoff_when_the_window_is_gone() {
        let mut attempts = VecDeque::from([
            AcquireAttempt::Contended,
            AcquireAttempt::Contended,
            AcquireAttempt::Acquired("guard"),
        ]);
        let mut notifications = 0;
        let mut waits = 0;

        let guard = acquire_or_notify_with_retry(
            3,
            || attempts.pop_front().unwrap(),
            || {
                notifications += 1;
                false
            },
            || waits += 1,
        );

        assert_eq!(guard, Some("guard"));
        assert_eq!(notifications, 2);
        assert_eq!(waits, 2);
    }

    #[test]
    fn stops_after_the_handoff_budget_is_exhausted() {
        let mut attempts = 0;
        let mut waits = 0;

        let guard = acquire_or_notify_with_retry::<()>(
            2,
            || {
                attempts += 1;
                AcquireAttempt::Contended
            },
            || false,
            || waits += 1,
        );

        assert!(guard.is_none());
        assert_eq!(attempts, 3);
        assert_eq!(waits, 2);
    }

    #[test]
    fn does_not_retry_an_unavailable_mutex_api() {
        let mut notifications = 0;
        let mut waits = 0;

        let guard = acquire_or_notify_with_retry::<()>(
            3,
            || AcquireAttempt::Failed,
            || {
                notifications += 1;
                false
            },
            || waits += 1,
        );

        assert!(guard.is_none());
        assert_eq!(notifications, 1);
        assert_eq!(waits, 0);
    }
}
