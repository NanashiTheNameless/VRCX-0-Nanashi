use std::time::{Duration, Instant};

const DEFAULT_VISIBLE_DURATION: Duration = Duration::from_secs(10);
const DEFAULT_SWITCH_COOLDOWN: Duration = Duration::from_secs(1);

#[derive(Clone, Copy, Debug)]
pub(super) struct WristVisibilityPolicy {
    visible_duration: Duration,
    /// A press this soon after the press that opened the menu is treated as
    /// part of the same press (a double press), so it does not switch the page.
    switch_cooldown: Duration,
    opened_until: Option<Instant>,
    opened_at: Option<Instant>,
    activations: u64,
}

impl Default for WristVisibilityPolicy {
    fn default() -> Self {
        Self::new(DEFAULT_VISIBLE_DURATION, DEFAULT_SWITCH_COOLDOWN)
    }
}

impl WristVisibilityPolicy {
    pub fn new(visible_duration: Duration, switch_cooldown: Duration) -> Self {
        Self {
            visible_duration,
            switch_cooldown,
            opened_until: None,
            opened_at: None,
            activations: 0,
        }
    }

    /// Applies changed settings without closing the menu or losing the press count.
    pub fn configure(&mut self, visible_duration: Duration, switch_cooldown: Duration) {
        self.visible_duration = visible_duration;
        self.switch_cooldown = switch_cooldown;
    }

    /// Every press, including one while the menu is already open: the press
    /// restarts the timeout instead of being ignored. A press within the switch
    /// cooldown of opening restarts the timeout but is not counted.
    pub fn open(&mut self, now: Instant) {
        let already_open = self.opened_until.is_some_and(|until| now <= until);
        if !already_open {
            self.opened_at = Some(now);
        }
        let in_cooldown = already_open
            && self.opened_at.is_some_and(|opened_at| {
                now.saturating_duration_since(opened_at) < self.switch_cooldown
            });
        self.opened_until = Some(now + self.visible_duration);
        if !in_cooldown {
            self.activations = self.activations.wrapping_add(1);
        }
    }

    /// How many times the menu was opened, so the frame producer can tell a new
    /// press from the menu simply staying open.
    pub fn activations(&self) -> u64 {
        self.activations
    }

    pub fn close(&mut self) {
        self.opened_until = None;
        self.opened_at = None;
    }

    pub fn evaluate(&mut self, now: Instant, device_present: bool) -> bool {
        let open = self.opened_until.is_some_and(|until| now <= until);
        if !open {
            self.opened_until = None;
        }
        device_present && open
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const VISIBLE: Duration = Duration::from_secs(10);
    const SWITCH_COOLDOWN: Duration = Duration::from_secs(1);

    #[test]
    fn closed_by_default() {
        let mut policy = WristVisibilityPolicy::new(VISIBLE, SWITCH_COOLDOWN);
        assert!(!policy.evaluate(Instant::now(), true));
    }

    #[test]
    fn open_keeps_surface_visible_until_window_expires() {
        let mut policy = WristVisibilityPolicy::new(VISIBLE, SWITCH_COOLDOWN);
        let now = Instant::now();
        policy.open(now);
        assert!(policy.evaluate(now, true));
        assert!(policy.evaluate(now + VISIBLE, true));
        assert!(!policy.evaluate(now + VISIBLE + Duration::from_millis(1), true));
        assert!(!policy.evaluate(now, true));
    }

    #[test]
    fn missing_device_hides_surface_without_clearing_window() {
        let mut policy = WristVisibilityPolicy::new(VISIBLE, SWITCH_COOLDOWN);
        let now = Instant::now();
        policy.open(now);
        assert!(!policy.evaluate(now, false));
        assert!(policy.evaluate(now, true));
    }

    #[test]
    fn close_hides_immediately() {
        let mut policy = WristVisibilityPolicy::new(VISIBLE, SWITCH_COOLDOWN);
        let now = Instant::now();
        policy.open(now);
        policy.close();
        assert!(!policy.evaluate(now, true));
    }

    #[test]
    fn pressing_while_open_restarts_the_timeout_and_counts_the_press() {
        let mut policy = WristVisibilityPolicy::new(VISIBLE, SWITCH_COOLDOWN);
        let now = Instant::now();
        policy.open(now);
        assert_eq!(policy.activations(), 1);

        let later = now + VISIBLE - Duration::from_millis(1);
        policy.open(later);
        assert_eq!(policy.activations(), 2);

        // The window restarts, so it is still open well past the original end.
        assert!(policy.evaluate(later + VISIBLE, true));
        assert!(!policy.evaluate(later + VISIBLE + Duration::from_millis(1), true));
    }

    #[test]
    fn double_press_opens_without_counting_the_second_press() {
        let mut policy = WristVisibilityPolicy::new(VISIBLE, SWITCH_COOLDOWN);
        let now = Instant::now();
        policy.open(now);
        assert_eq!(policy.activations(), 1);

        let double = now + SWITCH_COOLDOWN - Duration::from_millis(1);
        policy.open(double);
        assert_eq!(policy.activations(), 1);
        // The ignored press still restarts the timeout.
        assert!(policy.evaluate(double + VISIBLE, true));

        // A press after the cooldown counts again.
        policy.open(now + SWITCH_COOLDOWN);
        assert_eq!(policy.activations(), 2);
    }

    #[test]
    fn zero_cooldown_counts_every_press() {
        let mut policy = WristVisibilityPolicy::new(VISIBLE, Duration::ZERO);
        let now = Instant::now();
        policy.open(now);
        policy.open(now);
        assert_eq!(policy.activations(), 2);
    }

    #[test]
    fn configure_applies_to_an_open_menu() {
        let mut policy = WristVisibilityPolicy::new(VISIBLE, SWITCH_COOLDOWN);
        let now = Instant::now();
        policy.open(now);
        policy.configure(VISIBLE, Duration::from_millis(100));

        policy.open(now + Duration::from_millis(200));
        assert_eq!(policy.activations(), 2);
        assert!(policy.evaluate(now, true));
    }

    #[test]
    fn cooldown_only_follows_the_press_that_opened_the_menu() {
        let mut policy = WristVisibilityPolicy::new(VISIBLE, SWITCH_COOLDOWN);
        let now = Instant::now();
        policy.open(now);
        let switch = now + SWITCH_COOLDOWN + Duration::from_secs(1);
        policy.open(switch);
        assert_eq!(policy.activations(), 2);

        // Quick presses while already switching pages are not swallowed.
        policy.open(switch + Duration::from_millis(100));
        assert_eq!(policy.activations(), 3);
    }

    #[test]
    fn reopening_after_close_starts_a_new_cooldown() {
        let mut policy = WristVisibilityPolicy::new(VISIBLE, SWITCH_COOLDOWN);
        let now = Instant::now();
        policy.open(now);
        policy.close();

        let reopen = now + Duration::from_millis(100);
        policy.open(reopen);
        assert_eq!(policy.activations(), 2);
        policy.open(reopen + Duration::from_millis(100));
        assert_eq!(policy.activations(), 2);
    }
}
