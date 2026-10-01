import {
    normalizeDisplayText,
    resolveDisplayWorldName,
    sourceFromFriend
} from './normalization';
import type { FriendLocationFriend } from './types';

export function resolveFriendWorldName(
    friend: FriendLocationFriend | null | undefined
) {
    const source = sourceFromFriend(friend);
    return resolveDisplayWorldName(
        source?.worldName,
        source?.world?.name,
        source?.locationName
    );
}

export function resolveFriendGroupName(
    friend: FriendLocationFriend | null | undefined
) {
    const source = sourceFromFriend(friend);
    return normalizeDisplayText(
        source?.groupName || source?.group?.name || source?.group?.displayName
    );
}
