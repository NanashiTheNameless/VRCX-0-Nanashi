mod presence;
mod runtime;

pub(crate) use presence::baseline_friend_view;
pub use runtime::RealtimeFriendsRuntime;
pub(crate) use runtime::{
    trust_level_feed_entry, FriendBaselineEffects, RosterDelta, SyntheticFriendEvent,
};
