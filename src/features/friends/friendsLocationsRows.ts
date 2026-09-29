export {
    isRawWorldReference,
    isSentinelLocationValue,
    normalizeDisplayText,
    normalizeFriendsLocationId,
    resolveDisplayWorldName,
    resolveWorldIdCandidate
} from './friends-locations-rows/normalization';
export {
    buildSameInstanceGroups,
    isShareableInstanceLocation,
    resolveFriendGroupName,
    resolveFriendTravelingWorldId,
    resolveFriendTravelingWorldName,
    resolveFriendWorldName,
    resolvePresenceLocation,
    uniqueFriendsById
} from './friends-locations-rows/presence';
export {
    isFriendInPrivateLocation,
    partitionFriendsByPrivateLocation,
    resolveLocationSummary,
    resolveLocationTarget,
    resolveWorldDialogTarget
} from './friends-locations-rows/targets';
export type {
    FriendLocationFriend,
    SameInstanceGroup
} from './friends-locations-rows/types';
export { resolveCurrentInviteLocation as resolveFriendsLocationsCurrentInviteLocation } from '@/shared/utils/invite';
