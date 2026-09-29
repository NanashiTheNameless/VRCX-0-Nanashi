import { useShallow } from 'zustand/react/shallow';

import { useFriendRosterStore } from '@/state/friendRosterStore';

import { mutualFriendUsername } from './mutualFriendsGraphData';

export function useMutualFriendLabels(): Record<string, string> {
    return useFriendRosterStore(
        useShallow((state) =>
            Object.fromEntries(
                Object.entries(state.friendsById).map(([id, friend]) => [
                    id,
                    friend.displayName || mutualFriendUsername(friend) || id
                ])
            )
        )
    );
}
