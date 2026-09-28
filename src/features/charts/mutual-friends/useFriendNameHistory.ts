import { useEffect, useState } from 'react';

import { getFriendLogHistory } from '@/repositories/friendLogHistoryRepository';

const EMPTY_NAMES: Readonly<Record<string, string>> = Object.freeze({});

/**
 * Last known display name of everyone who appears in the friend log,
 * including people who are no longer friends, so the graph can keep naming
 * them instead of falling back to raw user ids.
 */
export function buildFriendNameHistory(
    rows: readonly { userId: string; displayName: string; created_at: string }[]
): Record<string, string> {
    const latest = new Map<string, { name: string; at: string }>();
    for (const row of rows) {
        const userId = row.userId.trim();
        const name = row.displayName.trim();
        if (!userId || !name) {
            continue;
        }
        const existing = latest.get(userId);
        if (!existing || row.created_at >= existing.at) {
            latest.set(userId, { name, at: row.created_at });
        }
    }
    return Object.fromEntries(
        Array.from(latest, ([userId, { name }]) => [userId, name])
    );
}

export function useFriendNameHistory(
    currentUserId: string,
    reloadToken: unknown = null
): Readonly<Record<string, string>> {
    const [names, setNames] = useState<{
        userId: string;
        byId: Readonly<Record<string, string>>;
    }>({ userId: '', byId: EMPTY_NAMES });

    useEffect(() => {
        if (!currentUserId) {
            return undefined;
        }
        let active = true;
        getFriendLogHistory(currentUserId)
            .then((rows) => {
                if (active) {
                    setNames({
                        userId: currentUserId,
                        byId: buildFriendNameHistory(rows)
                    });
                }
            })
            .catch((error: unknown) => {
                console.warn('Failed to load friend name history:', error);
            });
        return () => {
            active = false;
        };
    }, [currentUserId, reloadToken]);

    return names.userId === currentUserId ? names.byId : EMPTY_NAMES;
}
