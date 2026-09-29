//! Port of TS `computeTrustLevel`/`computeUserPlatform` (`shared/utils/userTransforms.ts`); keep in lockstep.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TrustLevelInfo {
    pub rank: TrustRank,
    pub is_moderator: bool,
    pub is_troll: bool,
    pub is_probable_troll: bool,
}

impl TrustLevelInfo {
    pub fn trust_level(self) -> &'static str {
        self.rank.level_label()
    }

    pub fn trust_class(self) -> &'static str {
        self.rank.class_name()
    }

    pub fn trust_sort_num(self) -> f64 {
        let mut sort_num = self.rank.sort_num();
        if self.is_troll || self.is_probable_troll {
            sort_num += 0.1;
        }
        if self.is_moderator {
            sort_num += 0.3;
        }
        sort_num
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrustRank {
    Visitor,
    NewUser,
    User,
    KnownUser,
    TrustedUser,
}

impl TrustRank {
    pub fn from_tags(tags: &[String]) -> Self {
        let has = |needle: &str| tags.iter().any(|tag| tag == needle);
        if has("system_trust_veteran") {
            Self::TrustedUser
        } else if has("system_trust_trusted") {
            Self::KnownUser
        } else if has("system_trust_known") {
            Self::User
        } else if has("system_trust_basic") {
            Self::NewUser
        } else {
            Self::Visitor
        }
    }

    pub fn level_label(self) -> &'static str {
        match self {
            Self::TrustedUser => "Trusted User",
            Self::KnownUser => "Known User",
            Self::User => "User",
            Self::NewUser => "New User",
            Self::Visitor => "Visitor",
        }
    }

    pub fn class_name(self) -> &'static str {
        match self {
            Self::TrustedUser => "x-tag-veteran",
            Self::KnownUser => "x-tag-trusted",
            Self::User => "x-tag-known",
            Self::NewUser => "x-tag-basic",
            Self::Visitor => "x-tag-untrusted",
        }
    }

    pub fn sort_num(self) -> f64 {
        match self {
            Self::TrustedUser => 5.0,
            Self::KnownUser => 4.0,
            Self::User => 3.0,
            Self::NewUser => 2.0,
            Self::Visitor => 1.0,
        }
    }
}

pub fn compute_trust_level(tags: &[String], developer_type: &str) -> TrustLevelInfo {
    let has = |needle: &str| tags.iter().any(|tag| tag == needle);
    let is_moderator =
        (!developer_type.is_empty() && developer_type != "none") || has("admin_moderator");
    let is_troll = has("system_troll");
    let is_probable_troll = has("system_probable_troll") && !is_troll;

    TrustLevelInfo {
        rank: TrustRank::from_tags(tags),
        is_moderator,
        is_troll,
        is_probable_troll,
    }
}

pub fn compute_user_platform(platform: &str, last_platform: &str) -> String {
    if !platform.is_empty() && platform != "offline" && platform != "web" {
        return platform.to_string();
    }
    last_platform.to_string()
}

pub fn trust_level_differs(previous: &str, next: &str) -> bool {
    let previous = previous.trim();
    let next = next.trim();
    !previous.is_empty() && !next.is_empty() && previous != next
}

pub fn trust_level_changed(previous: &str, next: &str) -> bool {
    let previous = previous.trim();
    let next = next.trim();
    trust_level_differs(previous, next)
        && !matches!(
            (previous, next),
            ("Trusted User", "Veteran User") | ("Veteran User", "Trusted User")
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tags(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn moderator_and_troll_adjust_sort_num() {
        let moderator = compute_trust_level(&tags(&["system_trust_known"]), "internal");
        assert!(moderator.is_moderator);
        assert!((moderator.trust_sort_num() - 3.3).abs() < f64::EPSILON);

        let troll = compute_trust_level(&tags(&["system_trust_basic", "system_troll"]), "");
        assert!(troll.is_troll);
        assert!((troll.trust_sort_num() - 2.1).abs() < f64::EPSILON);
    }

    #[test]
    fn probable_troll_only_when_not_already_troll() {
        let trust = compute_trust_level(&tags(&["system_troll", "system_probable_troll"]), "");
        assert!(trust.is_troll);
        assert!(!trust.is_probable_troll);
    }

    #[test]
    fn platform_prefers_live_then_falls_back_to_last() {
        assert_eq!(
            compute_user_platform("standalonewindows", "android"),
            "standalonewindows"
        );
        assert_eq!(compute_user_platform("web", "android"), "android");
        assert_eq!(compute_user_platform("offline", "android"), "android");
        assert_eq!(compute_user_platform("", "android"), "android");
    }

    #[test]
    fn legacy_trusted_and_veteran_labels_are_equivalent() {
        assert!(trust_level_differs("Trusted User", "Veteran User"));
        assert!(!trust_level_changed("Trusted User", "Veteran User"));
        assert!(!trust_level_changed("Veteran User", "Trusted User"));
        assert!(!trust_level_differs("", "Known User"));
        assert!(!trust_level_changed("", "Known User"));
        assert!(trust_level_changed("Known User", "Trusted User"));
    }
}

#[cfg(test)]
mod trust_rank_tests {
    use super::*;

    #[test]
    fn each_rank_keeps_its_label_class_and_sort_pairing() {
        let cases = [
            (TrustRank::Visitor, "Visitor", "x-tag-untrusted", 1.0),
            (TrustRank::NewUser, "New User", "x-tag-basic", 2.0),
            (TrustRank::User, "User", "x-tag-known", 3.0),
            (TrustRank::KnownUser, "Known User", "x-tag-trusted", 4.0),
            (TrustRank::TrustedUser, "Trusted User", "x-tag-veteran", 5.0),
        ];
        for (rank, label, class, sort) in cases {
            assert_eq!(rank.level_label(), label);
            assert_eq!(rank.class_name(), class);
            assert_eq!(rank.sort_num(), sort);
        }
    }

    #[test]
    fn tags_map_to_the_expected_rank() {
        let tag = |value: &str| vec![value.to_string()];
        assert_eq!(TrustRank::from_tags(&[]), TrustRank::Visitor);
        assert_eq!(
            TrustRank::from_tags(&tag("system_trust_basic")),
            TrustRank::NewUser
        );
        assert_eq!(
            TrustRank::from_tags(&tag("system_trust_known")),
            TrustRank::User
        );
        assert_eq!(
            TrustRank::from_tags(&tag("system_trust_trusted")),
            TrustRank::KnownUser
        );
        assert_eq!(
            TrustRank::from_tags(&tag("system_trust_veteran")),
            TrustRank::TrustedUser
        );
    }

    #[test]
    fn highest_tag_wins_when_several_are_present() {
        let tags = vec![
            "system_trust_basic".to_string(),
            "system_trust_veteran".to_string(),
        ];
        assert_eq!(TrustRank::from_tags(&tags), TrustRank::TrustedUser);
    }
}
