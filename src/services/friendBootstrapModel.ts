import type { FriendRosterSnapshotInput } from '@/domain/friends/types';
import type { FriendRosterSnapshot } from '@/platform/tauri/bindings';
import { isRecord } from '@/shared/utils/record';

export type CurrentUserFriendSnapshot = Record<string, unknown> & {
    id?: string;
};
export type FriendBootstrapOptions = {
    userId?: string;
    endpoint?: string;
    websocket?: string;
    currentUserSnapshot?: CurrentUserFriendSnapshot | null;
    preserveLoadedState?: boolean;
};
export type FriendBootstrapResult = {
    userId: string;
    count: number;
    detail: string;
    stale: boolean;
};

export function normalizeUserId(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export { isRecord };

function definedById<T>(byId: Partial<Record<string, T>>): Record<string, T> {
    const values: Record<string, T> = {};
    for (const [key, value] of Object.entries(byId)) {
        if (value !== undefined) {
            values[key] = value;
        }
    }
    return values;
}

export function rosterSnapshotInput(
    currentUserId: string,
    snapshot: FriendRosterSnapshot,
    detail: string
): FriendRosterSnapshotInput {
    return {
        currentUserId,
        friendsById: definedById(snapshot.friendsById),
        presenceById: definedById(snapshot.presenceById),
        generation: snapshot.generation,
        detail
    };
}

export function getDisplayName(
    user: Record<string, unknown> | null | undefined
) {
    return (
        normalizeUserId(user?.displayName) ||
        normalizeUserId(user?.username) ||
        normalizeUserId(user?.id)
    );
}
