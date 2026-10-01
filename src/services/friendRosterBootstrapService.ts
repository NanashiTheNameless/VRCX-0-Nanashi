import {
    commands,
    type SocialFriendRosterBaselineOutput
} from '@/platform/tauri/bindings';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import {
    getDisplayName,
    isRecord,
    normalizeUserId,
    rosterSnapshotInput,
    type FriendBootstrapOptions,
    type FriendBootstrapResult
} from './friendBootstrapModel';
import { signalFriendLogChanged } from './friendLogMutationService';
import { flushRealtimeRosterUpdates } from './realtimeRosterUpdateQueue';
import { syncStartupServicesTask } from './startupServicesStatus';

const activeBootstraps = new Map<string, Promise<FriendBootstrapResult>>();

function bootstrapTargetKey(
    userId: string,
    endpoint: string = '',
    websocket: string = ''
) {
    const normalizedUserId = normalizeUserId(userId);
    return `${normalizedUserId}\u0000${endpoint}\u0000${websocket}`;
}

function isCurrentBootstrapTarget(
    userId: string,
    endpoint: string = '',
    websocket: string | null = null
) {
    const runtimeState = useRuntimeStore.getState();
    const sessionState = useSessionStore.getState();
    const expectedWebsocket = websocket;

    return (
        runtimeState.auth.currentUserId === userId &&
        runtimeState.auth.currentUserEndpoint === endpoint &&
        (expectedWebsocket === null ||
            runtimeState.auth.currentUserWebsocket === expectedWebsocket) &&
        sessionState.isLoggedIn &&
        sessionState.sessionPhase === 'ready'
    );
}

async function runFriendBootstrap({
    userId,
    endpoint = '',
    websocket,
    currentUserSnapshot,
    preserveLoadedState = false
}: FriendBootstrapOptions): Promise<FriendBootstrapResult> {
    const currentSnapshot = isRecord(currentUserSnapshot)
        ? currentUserSnapshot
        : null;
    const normalizedUserId = normalizeUserId(userId || currentSnapshot?.id);
    if (!normalizedUserId) {
        throw new Error('Friend bootstrap requires an authenticated user id.');
    }
    const normalizedEndpoint = String(endpoint || '');
    const realtimeWebsocket = String(
        websocket ?? useRuntimeStore.getState().auth.currentUserWebsocket ?? ''
    );

    const displayName = getDisplayName(currentSnapshot) || normalizedUserId;

    useFriendRosterStore
        .getState()
        .setRosterLoading(
            normalizedUserId,
            `Loading the friend roster baseline for ${displayName}.`
        );
    useRuntimeStore
        .getState()
        .setStartupTask(
            'services',
            'running',
            `Loading the friend roster baseline for ${displayName}.`
        );
    if (!preserveLoadedState) {
        useSessionStore.getState().setFriendsLoaded(false);
    }

    const result: SocialFriendRosterBaselineOutput =
        await commands.appSocialFriendRosterBaselineGet({
            userId: normalizedUserId,
            endpoint: normalizedEndpoint,
            websocket: realtimeWebsocket,
            currentUserSnapshot: currentSnapshot,
            isFirstLoad: !preserveLoadedState
        });

    const snapshot = result.snapshot;
    const detail = result.detail;

    if (result.stale || !snapshot) {
        if (
            isCurrentBootstrapTarget(
                normalizedUserId,
                normalizedEndpoint,
                realtimeWebsocket
            )
        ) {
            if (!preserveLoadedState) {
                throw new Error(
                    `Friend roster baseline was stale for ${normalizedUserId}.`
                );
            }
            useFriendRosterStore.getState().setRosterReady(detail);
            syncStartupServicesTask([detail]);
        }

        return {
            userId: normalizedUserId,
            count: result.count ?? 0,
            detail,
            stale: true
        };
    }

    if (
        !isCurrentBootstrapTarget(
            normalizedUserId,
            normalizedEndpoint,
            realtimeWebsocket
        )
    ) {
        return {
            userId: normalizedUserId,
            count: result.count ?? 0,
            detail,
            stale: true
        };
    }

    if (preserveLoadedState) {
        useFriendRosterStore.getState().setRosterReady(detail);
    } else {
        flushRealtimeRosterUpdates();
        useFriendRosterStore
            .getState()
            .setRosterSnapshot(
                rosterSnapshotInput(normalizedUserId, snapshot, detail)
            );
    }
    useSessionStore.getState().setFriendsLoaded(true);
    syncStartupServicesTask([detail]);
    if (result.friendLogChanged) {
        signalFriendLogChanged();
    }
    return {
        userId: normalizedUserId,
        count: result.count ?? 0,
        detail,
        stale: false
    };
}

export function bootstrapFriendRoster(
    options: FriendBootstrapOptions
): Promise<FriendBootstrapResult> {
    const normalizedUserId = normalizeUserId(
        options?.userId ||
            (isRecord(options?.currentUserSnapshot)
                ? options.currentUserSnapshot.id
                : '')
    );
    const currentUserSnapshot = isRecord(options?.currentUserSnapshot)
        ? options.currentUserSnapshot
        : null;
    const preserveLoadedState = Boolean(options?.preserveLoadedState);
    if (!normalizedUserId || !currentUserSnapshot) {
        return Promise.reject(
            new Error('Friend bootstrap requires an authenticated user id.')
        );
    }

    const activeKey = bootstrapTargetKey(
        normalizedUserId,
        options?.endpoint,
        options?.websocket ??
            useRuntimeStore.getState().auth.currentUserWebsocket
    );
    if (activeBootstraps.has(activeKey)) {
        return activeBootstraps.get(activeKey)!;
    }

    const promise = runFriendBootstrap({
        ...options,
        userId: normalizedUserId,
        currentUserSnapshot,
        preserveLoadedState
    })
        .catch((error: unknown) => {
            if (
                isCurrentBootstrapTarget(
                    normalizedUserId,
                    options?.endpoint,
                    options?.websocket ??
                        useRuntimeStore.getState().auth.currentUserWebsocket
                )
            ) {
                useFriendRosterStore
                    .getState()
                    .setRosterError(
                        error instanceof Error ? error.message : String(error)
                    );
                if (!preserveLoadedState) {
                    useSessionStore.getState().setFriendsLoaded(false);
                }
                useRuntimeStore
                    .getState()
                    .setStartupTask(
                        'services',
                        'error',
                        error instanceof Error ? error.message : String(error)
                    );
            }

            throw error;
        })
        .finally(() => {
            activeBootstraps.delete(activeKey);
        });

    activeBootstraps.set(activeKey, promise);
    return promise;
}
