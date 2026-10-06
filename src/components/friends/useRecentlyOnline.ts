import { useEffect, useState } from 'react';

import { useFeedLiveStore } from '@/state/feedLiveStore';
import type { FeedLiveEntry } from '@/state/feedLiveTypes';

const RECENTLY_ONLINE_MS = 3000;

export function latestOnlineAtMs(
    entries: readonly FeedLiveEntry[],
    userId: string,
    nowMs: number
): number | null {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const { entry } = entries[index];
        const createdAtMs = Date.parse(entry.created_at);
        if (createdAtMs < nowMs - RECENTLY_ONLINE_MS) {
            return null;
        }
        if (entry.type === 'Online' && entry.userId === userId) {
            return createdAtMs;
        }
    }
    return null;
}

export function useRecentlyOnline(userId: string): boolean {
    const onlineAtMs = useFeedLiveStore((state) =>
        userId ? latestOnlineAtMs(state.entries, userId, Date.now()) : null
    );
    const [active, setActive] = useState(false);

    useEffect(() => {
        if (onlineAtMs === null) {
            return undefined;
        }
        const remaining = onlineAtMs + RECENTLY_ONLINE_MS - Date.now();
        if (remaining <= 0) {
            return undefined;
        }
        setActive(true);
        const timer = setTimeout(() => setActive(false), remaining);
        return () => {
            clearTimeout(timer);
            setActive(false);
        };
    }, [onlineAtMs]);

    return active;
}
