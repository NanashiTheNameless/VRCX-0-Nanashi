import type { FriendRosterById } from '@/domain/friends/types';

import { mutualFriendUsername } from './mutualFriendsGraphData';
import {
    isValidMutualFriendId,
    normalizeMutualFriendId
} from './mutualFriendsSettings';
import type {
    MutualFriendPickerOption,
    MutualFriendSnapshot
} from './mutualFriendsTypes';

export function truncateMutualFriendLabel(value: string, maxLength = 18) {
    const text = value;
    return text.length <= maxLength
        ? text
        : `${text.slice(0, Math.max(0, maxLength - 1))}...`;
}

export function buildMutualFriendPickerOption(
    userId: string,
    friendsById: FriendRosterById,
    fallbackName = '',
    degree?: number
): MutualFriendPickerOption | null {
    const normalizedId = normalizeMutualFriendId(userId);
    if (!isValidMutualFriendId(normalizedId)) {
        return null;
    }
    const user = friendsById[normalizedId] ?? null;
    const username = mutualFriendUsername(user);
    const label = user?.displayName || username || fallbackName || 'User';
    return {
        value: normalizedId,
        label,
        displayLabel: Number.isFinite(degree) ? `${label} (${degree})` : label,
        search: [label, username, normalizedId].filter(Boolean).join(' '),
        user,
        degree
    };
}

export function buildMutualFriendExcludePickerOptions(
    snapshot: MutualFriendSnapshot | null | undefined,
    friendsById: FriendRosterById,
    currentUserId: string
) {
    const seen = new Set<string>();
    const items: MutualFriendPickerOption[] = [];

    function pushOption(userId: string, fallbackName = '') {
        const normalizedId = normalizeMutualFriendId(userId);
        if (
            !isValidMutualFriendId(normalizedId) ||
            normalizedId === currentUserId ||
            seen.has(normalizedId)
        ) {
            return;
        }
        const option = buildMutualFriendPickerOption(
            normalizedId,
            friendsById,
            fallbackName
        );
        if (option) {
            seen.add(normalizedId);
            items.push(option);
        }
    }

    if (snapshot instanceof Map) {
        snapshot.forEach((mutualIds, friendId) => {
            pushOption(friendId);
            for (const mutualId of Array.isArray(mutualIds) ? mutualIds : []) {
                pushOption(mutualId);
            }
        });
    }

    return items.sort((left, right) => left.label.localeCompare(right.label));
}
