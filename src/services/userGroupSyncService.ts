import { normalizeEndpoint } from '@/domain/users/userFacts';
import { queryClient } from '@/lib/queryClient';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import { isVrchatRequestError } from '@/repositories/vrchatRequest';
import { isRecord } from '@/shared/utils/record';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';
import { useUserFactsStore } from '@/state/userFactsStore';
import {
    setPinnedUserGroupIds,
    trackUserGroupMembership
} from '@/state/userGroupMembershipStore';

const REQUEST_GAP_MS = 500;
const RETRY_DELAY_MS = 60_000;

export function startUserGroupSync(): () => void {
    trackUserGroupMembership(queryClient);
    let stopped = false;
    let running = false;
    let scope = '';
    let generation = 0;
    let candidates = new Set<string>();
    const retryAt = new Map<string, number>();
    let nextRequestAt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function schedule() {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        if (stopped || running || !scope) return;
        let next = Infinity;
        for (const userId of candidates) {
            next = Math.min(next, retryAt.get(userId) ?? 0);
        }
        if (next !== Infinity) {
            timer = setTimeout(
                () => void loadNext(),
                Math.max(0, Math.max(next, nextRequestAt) - Date.now())
            );
        }
    }

    async function loadNext() {
        timer = null;
        if (stopped || running || !scope) return;
        const now = Date.now();
        const userId = [...candidates].find(
            (id) => (retryAt.get(id) ?? 0) <= now
        );
        if (!userId) {
            schedule();
            return;
        }
        const requestGeneration = generation;
        running = true;
        try {
            await groupProfileRepository.getUserGroups({ userId, retry: 0 });
            if (generation === requestGeneration) retryAt.set(userId, Infinity);
        } catch (error) {
            if (generation === requestGeneration) {
                const status = isVrchatRequestError(error)
                    ? error.status
                    : isRecord(error) && error.code === 'vrchat_api'
                      ? error.statusCode
                      : 0;
                retryAt.set(
                    userId,
                    status === 403 || status === 404
                        ? Infinity
                        : Date.now() + RETRY_DELAY_MS
                );
                if (status === 429 || status === 401) {
                    nextRequestAt = Date.now() + RETRY_DELAY_MS;
                }
            }
        } finally {
            nextRequestAt = Math.max(
                nextRequestAt,
                Date.now() + REQUEST_GAP_MS
            );
            running = false;
            schedule();
        }
    }

    function update() {
        const runtime = useRuntimeStore.getState();
        const { currentUserId, currentUserEndpoint } = runtime.auth;
        const endpoint = normalizeEndpoint(currentUserEndpoint);
        const nextScope =
            currentUserId && useSessionStore.getState().sessionPhase === 'ready'
                ? `${currentUserId}::${endpoint}`
                : '';
        if (nextScope !== scope) {
            scope = nextScope;
            generation++;
            retryAt.clear();
        }
        setPinnedUserGroupIds(
            scope
                ? [
                      ...runtime.gameState.currentLocationPlayerIds,
                      currentUserId || ''
                  ]
                : []
        );
        const friends = useFriendRosterStore.getState();
        candidates = new Set(
            [
                ...runtime.gameState.currentLocationPlayerIds,
                currentUserId || '',
                ...(friends.currentUserId === currentUserId
                    ? Object.keys(friends.friendsById)
                    : []),
                ...(useUserFactsStore.getState().userIdsByEndpoint[endpoint] ??
                    [])
            ].filter((id) => id.startsWith('usr_'))
        );
        schedule();
    }

    const unsubscribers = [
        useRuntimeStore.subscribe((state, previous) => {
            if (
                state.auth !== previous.auth ||
                state.gameState.currentLocationPlayerIds !==
                    previous.gameState.currentLocationPlayerIds
            )
                update();
        }),
        useSessionStore.subscribe(update),
        useFriendRosterStore.subscribe(update),
        useUserFactsStore.subscribe(update)
    ];
    update();
    return () => {
        stopped = true;
        generation++;
        setPinnedUserGroupIds([]);
        if (timer !== null) clearTimeout(timer);
        for (const unsubscribe of unsubscribers) unsubscribe();
    };
}
