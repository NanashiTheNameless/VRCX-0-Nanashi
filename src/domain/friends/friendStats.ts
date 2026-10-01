export type FriendStats = {
    joinCount?: number;
    lastSeen?: string;
    timeSpent?: number;
    mutualCount: number;
    mutualOptedOut: boolean;
};

export type FriendStatsById = Record<string, FriendStats>;

export type FriendMutualStats = Pick<
    FriendStats,
    'mutualCount' | 'mutualOptedOut'
>;

type FriendUserStatsRow = {
    userId: string;
    displayName: string;
    lastSeen: string;
    timeSpent: number;
    joinCount: number;
};

export type FriendIdentity = {
    id: string;
    displayName: string;
};

type AggregatedUserStats = {
    lastSeen: string;
    timeSpent: number;
    joinCount: number;
};

function normalizeId(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

export function aggregateFriendUserStats(
    statsRows: readonly FriendUserStatsRow[],
    friends: readonly FriendIdentity[]
): Map<string, AggregatedUserStats> {
    const dataByDisplayName = new Map<string, string>();
    const friendsByDisplayName = new Map<string, string>();
    const statsById = new Map<string, AggregatedUserStats>();

    for (const row of statsRows) {
        const displayName = row.displayName.trim();
        const userId = normalizeId(row.userId);
        if (displayName && userId) {
            dataByDisplayName.set(displayName, userId);
        }
    }
    for (const friend of friends) {
        const displayName = friend.displayName.trim();
        const userId = normalizeId(friend.id);
        if (displayName && userId) {
            friendsByDisplayName.set(displayName, userId);
        }
    }
    for (const row of statsRows) {
        const displayName = row.displayName.trim();
        const userId =
            normalizeId(row.userId) ||
            normalizeId(dataByDisplayName.get(displayName)) ||
            normalizeId(friendsByDisplayName.get(displayName));
        if (!userId) {
            continue;
        }
        const current = statsById.get(userId);
        if (!current) {
            statsById.set(userId, {
                lastSeen: row.lastSeen,
                timeSpent: row.timeSpent,
                joinCount: row.joinCount
            });
            continue;
        }
        if (Date.parse(row.lastSeen) > Date.parse(current.lastSeen)) {
            current.lastSeen = row.lastSeen;
        }
        current.timeSpent += row.timeSpent;
        current.joinCount += row.joinCount;
    }
    return statsById;
}
