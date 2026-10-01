import {
    aggregateFriendUserStats,
    type FriendIdentity,
    type FriendMutualStats,
    type FriendStatsById
} from '@/domain/friends/friendStats';
import gameLogRepository from '@/repositories/gameLogRepository';
import mutualGraphPersistenceRepository from '@/repositories/mutualGraphPersistenceRepository';

export async function loadFriendMutualStats(
    ownerUserId: string,
    friendIds: readonly string[]
): Promise<Record<string, FriendMutualStats>> {
    const { snapshot, meta } =
        await mutualGraphPersistenceRepository.getSnapshot(ownerUserId);
    const mutualById: Record<string, FriendMutualStats> = {};
    for (const friendId of friendIds) {
        const metadata = meta.get(friendId);
        mutualById[friendId] = {
            mutualCount:
                metadata?.totalCount != null &&
                Number.isFinite(metadata.totalCount)
                    ? metadata.totalCount
                    : (snapshot.get(friendId)?.length ?? 0),
            mutualOptedOut: metadata?.optedOut === true
        };
    }
    return mutualById;
}

export async function loadFriendStats(
    ownerUserId: string,
    friends: readonly FriendIdentity[]
): Promise<FriendStatsById> {
    const friendIds = friends.map((friend) => friend.id);
    const [statsRows, mutualById] = await Promise.all([
        gameLogRepository.getAllUserStats({
            userIds: friendIds,
            displayNames: friends.map((friend) => friend.displayName)
        }),
        loadFriendMutualStats(ownerUserId, friendIds)
    ]);
    const userStats = aggregateFriendUserStats(statsRows, friends);
    const byUserId: FriendStatsById = {};
    for (const friendId of friendIds) {
        byUserId[friendId] = {
            ...userStats.get(friendId),
            ...mutualById[friendId]
        };
    }
    return byUserId;
}
