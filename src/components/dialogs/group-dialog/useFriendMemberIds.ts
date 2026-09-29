import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useFriendRosterStore } from '@/state/friendRosterStore';

export function useFriendMemberIds(
    userIds: readonly string[]
): ReadonlySet<string> {
    const friendIds = useFriendRosterStore(
        useShallow((state) =>
            userIds.filter((userId) => Boolean(state.friendsById[userId]))
        )
    );
    return useMemo(() => new Set(friendIds), [friendIds]);
}
