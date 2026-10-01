export {
    isRawWorldReference,
    normalizeDisplayText,
    resolveDisplayWorldName,
    resolveWorldIdCandidate,
    uniqueFriendsById
} from './friends-locations-rows/normalization';
export {
    resolveFriendGroupName,
    resolveFriendWorldName
} from './friends-locations-rows/names';
export {
    isFriendInPrivateLocation,
    locationTarget,
    partitionFriendsByPrivateLocation,
    resolveLocationSummary,
    friendLocationTarget,
    resolveWorldDialogTarget,
    summarizeLocation
} from './friends-locations-rows/targets';
export type {
    FriendLocationFriend,
    FriendLocationTarget,
    SameInstanceGroup
} from './friends-locations-rows/types';
