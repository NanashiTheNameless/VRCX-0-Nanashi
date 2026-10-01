import { presenceSection, type PresenceView } from '@/domain/friends/presence';
import type { FriendLocationTimeEntry } from '@/state/friendLocationTimeStore';
import { useFriendLocationTimeStore } from '@/state/friendLocationTimeStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';

export function resolveFriendLocationTimeEpoch(
    presence: PresenceView | null | undefined,
    entry: FriendLocationTimeEntry | null | undefined,
    location: string
): number {
    const expectedLocation = location.trim();
    if (
        !presence ||
        !entry ||
        (entry.source !== 'gameLog' &&
            presenceSection(presence) !== 'online') ||
        entry.location !== expectedLocation ||
        !entry.sinceMs
    ) {
        return 0;
    }
    return entry.sinceMs;
}

export function useFriendLocationTimeEpoch(
    userId: string,
    location: string
): number {
    const normalizedUserId = userId.trim();
    const presence = useFriendRosterStore((state) =>
        normalizedUserId
            ? (state.friendsById[normalizedUserId]?.$presence ?? null)
            : null
    );
    const entry = useFriendLocationTimeStore((state) =>
        normalizedUserId ? (state.byUserId[normalizedUserId] ?? null) : null
    );
    return resolveFriendLocationTimeEpoch(presence, entry, location);
}
