mod vrchat_api;
mod worlds;

#[cfg(test)]
pub(crate) use vrchat_api::TestVrchatRequestPort;
pub use vrchat_api::{
    VrchatApiFuture, VrchatApiPort, VrchatApiRuntime, VrchatRequestFuture, VrchatRequestPort,
};
pub use vrcx_0_contracts::vrchat_requests::{
    AvatarListSort, AvatarReleaseStatus, AvatarUpdateRequest, CalendarListParams, EmojiLoopStyle,
    EmojiUploadParams, GroupSearchParams, ImageAnimationStyle, ImageMaskTag,
    InstanceCreateGroupAccessType, InstanceCreateMinimumAvatarPerformance, InstanceCreateRegion,
    InstanceCreateRequest, InstanceCreateType, InventoryItemUpdateRequest, InventoryListParams,
    InventoryOrder, InviteMessageType, MediaAssetUploadRequest, MediaFileListParams, MediaFileTag,
    PrintUploadParams, ProfileDecorationEquipSlot, QueryOrder, ReleaseStatusFilter,
    RequestInviteRequest, UserSearchCustomField, UserSearchParams, UserSearchSort,
    WorldSearchParams, WorldSearchSort, WorldUpdateRequest,
};
pub use worlds::{
    deserialize_nonnegative_i32, WorldRemoteFuture, WorldRemoteOperation, WorldRemotePort,
    WorldRemoteRuntime, WorldRemoteScope, WorldResponseProjectionPort,
};
