import { create } from 'zustand';

import {
    normalizeExcludedMutualFriendIds,
    normalizeMutualFriendId,
    readExcludedMutualFriendIds,
    writeExcludedMutualFriendIds
} from './mutualFriendsSettings';

type MutualFriendsExclusionStore = {
    excludedFriendIds: string[];
    setExcludedFriendIds: (next: string[]) => void;
    toggleExcludedFriendId: (friendId: string) => void;
};

export const useMutualFriendsExclusionStore =
    create<MutualFriendsExclusionStore>((set, get) => ({
        excludedFriendIds: readExcludedMutualFriendIds(),
        setExcludedFriendIds: (next) => {
            const excludedFriendIds = normalizeExcludedMutualFriendIds(next);
            writeExcludedMutualFriendIds(excludedFriendIds);
            set({ excludedFriendIds });
        },
        toggleExcludedFriendId: (friendId) => {
            const normalizedId = normalizeMutualFriendId(friendId);
            if (!normalizedId) {
                return;
            }
            const current = get().excludedFriendIds;
            get().setExcludedFriendIds(
                current.includes(normalizedId)
                    ? current.filter((id) => id !== normalizedId)
                    : [...current, normalizedId]
            );
        }
    }));
