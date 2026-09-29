import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { mutualFriendUsername } from '@/lib/mutual-friends/mutualFriendsGraphData';
import { getResolvedThemeMode } from '@/services/themeService';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useShellStore } from '@/state/shellStore';

import { useFriendNameHistory } from './useFriendNameHistory';

export function useMutualFriendsRuntime() {
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const friendsById = useFriendRosterStore((state) => state.friendsById);

    // Get labels from the friend roster using upstream's approach
    const rosterLabelsById = useFriendRosterStore(
        useShallow((state) =>
            Object.fromEntries(
                Object.entries(state.friendsById).map(([id, friend]) => [
                    id,
                    friend.displayName || mutualFriendUsername(friend) || id
                ])
            )
        )
    );

    // Former friends stay in the graph snapshot; keep their last known names.
    // This preserves your local feature that tracks former friends' display names
    // from the friend log history since they're no longer in the roster.
    const historicalNamesById = useFriendNameHistory(currentUserId ?? '');

    // Merge historical names with current roster labels (your local feature)
    const friendLabelsById = useMemo(
        () => ({ ...historicalNamesById, ...rosterLabelsById }),
        [historicalNamesById, rosterLabelsById]
    );

    const orderedFriendIds = useFriendRosterStore(
        (state) => state.orderedFriendIds
    );
    const shellThemeMode = useShellStore((state) => state.themeMode);
    const resolvedTheme = getResolvedThemeMode(shellThemeMode);

    return {
        currentUserId: currentUserId ?? '',
        friendsById,
        friendLabelsById,
        orderedFriendIds,
        resolvedTheme
    };
}
