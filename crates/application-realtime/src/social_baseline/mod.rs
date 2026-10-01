pub mod service;
pub mod types;

pub use service::{
    build_favorites_baseline, build_favorites_baseline_from_friend_ids,
    build_favorites_baseline_from_friend_records, build_synced_friend_roster_baseline,
    SocialBaselineDeps,
};
pub use types::{
    FavoriteBaselineSnapshot, SocialFavoritesBaselineInput, SocialFavoritesBaselineOutput,
    SocialFavoritesBaselineRequest, SocialFriendRosterBaselineInput,
    SocialFriendRosterBaselineOutput,
};
