import { useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { PresenceView } from '@/domain/friends/presence';
import {
    normalizeEndpoint,
    normalizeUserId,
    userFactKey,
    type UserFact
} from '@/domain/users/userFacts';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import {
    useRuntimeStore,
    type CurrentUserSnapshotState
} from '@/state/runtimeStore';
import {
    useUserFactsStore,
    type UserFactsStoreState
} from '@/state/userFactsStore';

interface UseKnownUserOptions {
    endpoint?: string;
}

function normalizeUserIdList(
    userIds: readonly string[] | null | undefined
): string[] {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const value of Array.isArray(userIds) ? userIds : []) {
        const userId = normalizeUserId(value);
        if (!userId || seen.has(userId)) {
            continue;
        }
        seen.add(userId);
        ids.push(userId);
    }
    return ids;
}

const rosterPresenceFacts = new WeakMap<
    UserFact,
    { view: PresenceView; fact: UserFact }
>();

function withRosterPresence(
    fact: UserFact,
    view: PresenceView | undefined
): UserFact {
    if (!view || fact.$presence === view) {
        return fact;
    }
    const cached = rosterPresenceFacts.get(fact);
    if (cached?.view === view) {
        return cached.fact;
    }
    const next = { ...fact, $presence: view };
    rosterPresenceFacts.set(fact, { view, fact: next });
    return next;
}

function currentSnapshotToUserFact(
    snapshot: CurrentUserSnapshotState | null | undefined,
    userId: string | null | undefined,
    endpoint: string
): UserFact | null {
    if (!snapshot) {
        return null;
    }
    const normalizedUserId = normalizeUserId(snapshot.id || userId);
    if (!normalizedUserId) {
        return null;
    }
    return {
        ...snapshot,
        id: normalizedUserId,
        endpoint: normalizeEndpoint(snapshot.endpoint || endpoint),
        updatedAt:
            typeof snapshot.updatedAt === 'string' ? snapshot.updatedAt : ''
    };
}

function useKnownUserFact(
    userId: string | null | undefined,
    options: UseKnownUserOptions = {}
) {
    const storeEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const endpoint = normalizeEndpoint(options.endpoint || storeEndpoint);
    const normalizedUserId = normalizeUserId(userId);
    const key = useMemo(
        () => userFactKey(endpoint, normalizedUserId),
        [endpoint, normalizedUserId]
    );
    const fact = useUserFactsStore((state) =>
        key ? state.usersByKey[key] || null : null
    );
    const currentUserSnapshot = useRuntimeStore((state) =>
        normalizedUserId && normalizedUserId === currentUserId
            ? state.auth.currentUserSnapshot
            : null
    );
    const rosterPresence = useFriendRosterStore((state) =>
        normalizedUserId
            ? state.friendsById[normalizedUserId]?.$presence
            : undefined
    );
    return (
        currentSnapshotToUserFact(
            currentUserSnapshot,
            normalizedUserId,
            endpoint
        ) || (fact ? withRosterPresence(fact, rosterPresence) : null)
    );
}

function useKnownUserFacts(
    userIds: readonly string[] | null | undefined,
    options: UseKnownUserOptions = {}
) {
    const storeEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const endpoint = normalizeEndpoint(options.endpoint || storeEndpoint);
    const normalizedUserIds = useMemo(
        () => normalizeUserIdList(userIds),
        [userIds]
    );
    const currentUserFact = useMemo(
        () =>
            currentSnapshotToUserFact(
                currentUserSnapshot,
                currentUserId,
                endpoint
            ),
        [currentUserSnapshot, currentUserId, endpoint]
    );

    const selectUserFacts = useCallback(
        (state: UserFactsStoreState) => {
            const usersById: Record<string, UserFact> = {};
            for (const userId of normalizedUserIds) {
                if (userId === currentUserId && currentUserSnapshot) {
                    if (currentUserFact) {
                        usersById[userId] = currentUserFact;
                    }
                    continue;
                }
                const key = userFactKey(endpoint, userId);
                const fact = key ? state.usersByKey[key] : null;
                if (fact) {
                    usersById[userId] = fact;
                }
            }
            return usersById;
        },
        [
            endpoint,
            normalizedUserIds,
            currentUserFact,
            currentUserId,
            currentUserSnapshot
        ]
    );

    const factsById = useUserFactsStore(useShallow(selectUserFacts));
    const rosterPresenceById = useFriendRosterStore(
        useShallow((state) => {
            const views: Record<string, PresenceView> = {};
            for (const userId of normalizedUserIds) {
                const view = state.friendsById[userId]?.$presence;
                if (view) {
                    views[userId] = view;
                }
            }
            return views;
        })
    );
    return useMemo(() => {
        const usersById: Record<string, UserFact> = {};
        for (const [userId, fact] of Object.entries(factsById)) {
            usersById[userId] = withRosterPresence(
                fact,
                rosterPresenceById[userId]
            );
        }
        return usersById;
    }, [factsById, rosterPresenceById]);
}

export { useKnownUserFact, useKnownUserFacts };
