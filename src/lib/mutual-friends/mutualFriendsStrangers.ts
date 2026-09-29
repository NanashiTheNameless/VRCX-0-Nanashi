import { normalizeExcludedMutualFriendIds } from './mutualFriendsSettings';
import type { MutualFriendCommunity } from './mutualFriendsTypes';

const ROOM_CIRCLE_MIN_MEMBERS = 2;
const ROOM_CIRCLE_LIMIT = 2;

export function mutualFriendIdsOf(
    rows: readonly { id?: unknown }[] | null | undefined
): string[] {
    return [
        ...new Set(
            normalizeExcludedMutualFriendIds((rows ?? []).map((row) => row?.id))
        )
    ];
}

export function namedCommunityOf(
    index: number | undefined,
    communities: readonly MutualFriendCommunity[]
): MutualFriendCommunity | null {
    const community = index === undefined ? null : communities[index];
    return community?.isNamed ? community : null;
}

export function dominantMutualFriendCommunity(
    friendIds: readonly string[],
    communityIndexById: ReadonlyMap<string, number>,
    communities: readonly MutualFriendCommunity[]
): MutualFriendCommunity | null {
    const counts = new Map<number, number>();
    for (const friendId of friendIds) {
        const community = namedCommunityOf(
            communityIndexById.get(friendId),
            communities
        );
        if (community) {
            counts.set(community.index, (counts.get(community.index) ?? 0) + 1);
        }
    }
    let bestIndex: number | null = null;
    let bestCount = 0;
    for (const [index, count] of counts) {
        if (
            count > bestCount ||
            (count === bestCount && bestIndex !== null && index < bestIndex)
        ) {
            bestIndex = index;
            bestCount = count;
        }
    }
    return bestIndex === null ? null : (communities[bestIndex] ?? null);
}

export function summarizeRoomMutualCircles(
    dominantCommunities: readonly (MutualFriendCommunity | null)[]
): MutualFriendCommunity[] {
    const counts = new Map<
        number,
        { community: MutualFriendCommunity; count: number }
    >();
    for (const community of dominantCommunities) {
        if (!community) {
            continue;
        }
        const entry = counts.get(community.index);
        if (entry) {
            entry.count += 1;
        } else {
            counts.set(community.index, { community, count: 1 });
        }
    }
    return Array.from(counts.values())
        .filter((entry) => entry.count >= ROOM_CIRCLE_MIN_MEMBERS)
        .sort(
            (left, right) =>
                right.count - left.count ||
                left.community.index - right.community.index
        )
        .slice(0, ROOM_CIRCLE_LIMIT)
        .map((entry) => entry.community);
}
