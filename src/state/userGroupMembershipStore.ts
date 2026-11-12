import type { Query, QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';

import { VRCHAT_STAFF_GROUP_ID } from '@/shared/constants/user';

// Group membership learned from users' own group lists, which the app loads
// at user initialization, for profiles and similar views. A user's own
// list is the most reliable source, so it wins over any stored member list
// of a group (those are often private, partial or stale). Nothing is fetched
// here; lists are only read when something else in the app loads them.

const CACHE_KEY = 'vrcx0.userGroupMembership';
const MAX_REMEMBERED_USERS = 2000;
// A full player list loads many group lists at once; save once per burst.
const CACHE_WRITE_DELAY_MS = 1000;

export type UserGroupMembership = {
    // Every group in the user's list, when it was seen this session.
    all: ReadonlySet<string> | null;
    // Remembered across restarts for tracked groups only: true when the user
    // was in the group, false when their list did not include it.
    known: ReadonlyMap<string, boolean>;
};

type UserGroupMembershipStoreState = {
    byUser: ReadonlyMap<string, UserGroupMembership>;
};

/** true: member; false: not a member; null: not known. */
export function groupMembership(
    entry: UserGroupMembership | null | undefined,
    groupId: string
): boolean | null {
    if (!entry || !groupId) {
        return null;
    }
    if (entry.all) {
        return entry.all.has(groupId);
    }
    return entry.known.get(groupId) ?? null;
}

let trackedGroupIds = new Set<string>([VRCHAT_STAFF_GROUP_ID]);
let pinnedUserIds = new Set<string>();

export function setPinnedUserGroupIds(userIds: Iterable<string>) {
    pinnedUserIds = new Set(userIds);
}

/** Groups whose membership is remembered across restarts. */
export function setTrackedGroupIds(groupIds: Iterable<string>) {
    trackedGroupIds = new Set([VRCHAT_STAFF_GROUP_ID, ...groupIds]);
}

type CachedEntry = { in?: unknown; out?: unknown };

function readCache(): Map<string, UserGroupMembership> {
    const byUser = new Map<string, UserGroupMembership>();
    try {
        const raw = globalThis.localStorage?.getItem(CACHE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (!parsed || typeof parsed !== 'object') {
            return byUser;
        }
        for (const [userId, value] of Object.entries(
            parsed as Record<string, CachedEntry>
        )) {
            if (!userId.startsWith('usr_') || !value) {
                continue;
            }
            const known = new Map<string, boolean>();
            for (const [list, member] of [
                [value.in, true],
                [value.out, false]
            ] as const) {
                for (const groupId of Array.isArray(list) ? list : []) {
                    if (
                        typeof groupId === 'string' &&
                        groupId.startsWith('grp_')
                    ) {
                        known.set(groupId, member);
                    }
                }
            }
            byUser.set(userId, { all: null, known });
        }
    } catch {
        // A missing or broken cache only means membership is learned again.
    }
    return byUser;
}

function writeCache(byUser: ReadonlyMap<string, UserGroupMembership>) {
    const entries = [...byUser.entries()].slice(-MAX_REMEMBERED_USERS);
    const out: Record<string, { in: string[]; out: string[] }> = {};
    for (const [userId, entry] of entries) {
        const member: string[] = [];
        const notMember: string[] = [];
        for (const [groupId, isMember] of entry.known) {
            (isMember ? member : notMember).push(groupId);
        }
        if (member.length || notMember.length) {
            out[userId] = { in: member, out: notMember };
        }
    }
    try {
        globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(out));
    } catch {
        // Only a convenience.
    }
}

export const useUserGroupMembershipStore =
    create<UserGroupMembershipStoreState>(() => ({ byUser: readCache() }));

let cacheWriteTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleCacheWrite() {
    if (cacheWriteTimer !== null) {
        return;
    }
    cacheWriteTimer = setTimeout(
        flushUserGroupMembershipCache,
        CACHE_WRITE_DELAY_MS
    );
}

/** Saves a pending cache write now. */
export function flushUserGroupMembershipCache() {
    if (cacheWriteTimer === null) {
        return;
    }
    clearTimeout(cacheWriteTimer);
    cacheWriteTimer = null;
    writeCache(useUserGroupMembershipStore.getState().byUser);
}

globalThis.addEventListener?.('pagehide', flushUserGroupMembershipCache);

export function recordUserGroups(userId: string, groupIds: readonly string[]) {
    if (!userId.startsWith('usr_')) {
        return;
    }
    const all = new Set(groupIds);
    const previous = useUserGroupMembershipStore.getState().byUser.get(userId);
    const known = new Map(previous?.known ?? []);
    for (const groupId of trackedGroupIds) {
        known.set(groupId, all.has(groupId));
    }
    const byUser = new Map(useUserGroupMembershipStore.getState().byUser);
    byUser.delete(userId);
    byUser.set(userId, { all, known });
    for (const oldest of byUser.keys()) {
        if (byUser.size <= MAX_REMEMBERED_USERS) {
            break;
        }
        if (!pinnedUserIds.has(oldest)) {
            byUser.delete(oldest);
        }
    }
    useUserGroupMembershipStore.setState({ byUser });
    scheduleCacheWrite();
}

/** Group ids in a cached user group list, or null if the data is not one. */
export function groupIdsFromUserGroupData(data: unknown): string[] | null {
    const rows = Array.isArray(data)
        ? data
        : Array.isArray((data as { groups?: unknown } | null)?.groups)
          ? (data as { groups: unknown[] }).groups
          : null;
    if (!rows) {
        return null;
    }
    const ids: string[] = [];
    for (const row of rows) {
        if (!row || typeof row !== 'object') {
            continue;
        }
        const { groupId, id } = row as { groupId?: unknown; id?: unknown };
        const value =
            typeof groupId === 'string' && groupId
                ? groupId
                : typeof id === 'string' && id.startsWith('grp_')
                  ? id
                  : '';
        if (value) {
            ids.push(value);
        }
    }
    return ids;
}

// Query keys from `queryKeys.userGroups` / `userGroupsOverview`:
// ['user', userId, 'groups' | 'groupsOverview', { endpoint }?].
function recordFromQuery(query: Query) {
    const [scope, userId, kind] = query.queryKey;
    if (
        scope !== 'user' ||
        typeof userId !== 'string' ||
        (kind !== 'groups' && kind !== 'groupsOverview')
    ) {
        return;
    }
    const groupIds = groupIdsFromUserGroupData(query.state.data);
    if (groupIds) {
        recordUserGroups(userId, groupIds);
    }
}

let trackedClient: QueryClient | null = null;

export function trackUserGroupMembership(client: QueryClient) {
    if (trackedClient === client) {
        return;
    }
    trackedClient = client;
    const cache = client.getQueryCache();
    for (const query of cache.getAll()) {
        recordFromQuery(query);
    }
    cache.subscribe((event) => {
        if (event.type === 'updated' && event.action.type === 'success') {
            recordFromQuery(event.query);
        }
    });
}

export function resetUserGroupMembershipStoreForTests() {
    if (cacheWriteTimer !== null) {
        clearTimeout(cacheWriteTimer);
        cacheWriteTimer = null;
    }
    trackedClient = null;
    trackedGroupIds = new Set([VRCHAT_STAFF_GROUP_ID]);
    pinnedUserIds = new Set();
    useUserGroupMembershipStore.setState({ byUser: new Map() });
}
