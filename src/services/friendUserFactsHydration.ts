import { normalizeEndpoint, userFactKey } from '@/domain/users/userFacts';
import type { FriendRosterSnapshot } from '@/platform/tauri/bindings';
import { useUserFactsStore } from '@/state/userFactsStore';

export function hydrateFriendUserFacts(
    snapshot: FriendRosterSnapshot,
    endpoint: string
): void {
    const scope = normalizeEndpoint(endpoint);
    const store = useUserFactsStore.getState();
    const users = Object.entries(snapshot.friendsById).flatMap(
        ([userId, friend]) => {
            if (!friend) return [];
            const id = friend.id?.trim() || userId.trim();
            const key = userFactKey(scope, id);
            if (!key) return [];
            const existing = store.usersByKey[key];
            return [
                {
                    ...friend,
                    ...(typeof friend.last_platform === 'string'
                        ? { last_platform: friend.last_platform }
                        : typeof friend.lastPlatform === 'string'
                          ? { last_platform: friend.lastPlatform }
                          : {}),
                    ...existing,
                    id,
                    endpoint: scope,
                    isFriend: true
                }
            ];
        }
    );
    store.replaceUserFacts(users);
}
