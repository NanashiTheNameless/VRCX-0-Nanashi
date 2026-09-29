// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import type { Dispatch, SetStateAction } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppToastOptions } from '@/services/toastService';

import type { FriendListRow } from './friendListRows';

const mocks = vi.hoisted(() => ({
    confirm: vi.fn(),
    deleteFriend: vi.fn(),
    deleteFriends: vi.fn(),
    getMutualSnapshot: vi.fn(),
    runtimeState: {
        auth: {
            currentUserId: 'usr_self',
            currentUserEndpoint: 'https://api.vrchat.cloud/api/1',
            currentUserSnapshot: { id: 'usr_self' }
        },
        mutualGraph: {
            runId: 0,
            status: 'idle',
            ownerUserId: '',
            processedFriends: 0,
            totalFriends: 0
        },
        friendProfileLoad: { status: 'idle' }
    },
    friendState: {
        applyFriendPatch: vi.fn(),
        friendsById: {} as Record<string, FriendListRow>
    },
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
    toastWarning: vi.fn()
}));

vi.mock('@/services/toastService', () => ({
    toast: {
        add: (options: AppToastOptions) => {
            switch (options.type) {
                case 'error':
                    return mocks.toastError(options);
                case 'success':
                    return mocks.toastSuccess(options);
                case 'warning':
                    return mocks.toastWarning(options);
                default:
                    throw new Error('Unhandled toast type: ' + options.type);
            }
        }
    }
}));

vi.mock('@/state/runtimeStore', () => {
    const useRuntimeStore = (
        selector: (state: typeof mocks.runtimeState) => unknown
    ) => selector(mocks.runtimeState);
    useRuntimeStore.getState = () => mocks.runtimeState;
    return { useRuntimeStore };
});

vi.mock('@/state/friendRosterStore', () => {
    const useFriendRosterStore = (
        selector: (state: typeof mocks.friendState) => unknown
    ) => selector(mocks.friendState);
    useFriendRosterStore.getState = () => mocks.friendState;
    return { useFriendRosterStore };
});

vi.mock('@/state/modalStore', () => ({
    useModalStore: (
        selector: (state: { confirm: typeof mocks.confirm }) => unknown
    ) => selector({ confirm: mocks.confirm })
}));

vi.mock('@/services/friendRelationshipService', () => ({
    default: {
        deleteFriend: mocks.deleteFriend,
        deleteFriends: mocks.deleteFriends
    }
}));

vi.mock('@/repositories/mutualGraphPersistenceRepository', () => ({
    default: { getSnapshot: mocks.getMutualSnapshot }
}));

vi.mock('@/services/dialogService', () => ({ openUserDialog: vi.fn() }));
vi.mock('@/services/friendProfileLoadService', () => ({
    openFriendProfileLoadDialog: vi.fn(),
    startFriendProfileLoad: vi.fn()
}));
vi.mock('@/services/mutualGraphFetchService', () => ({
    startMutualGraphFetch: vi.fn()
}));

import { useFriendListRowActions } from './useFriendListRowActions';

type MutualSnapshot = {
    snapshot: Map<string, string[]>;
    meta: Map<string, { optedOut: boolean }>;
};

function deferred<Value>() {
    let resolve: (value: Value) => void = () => undefined;
    const promise = new Promise<Value>((nextResolve) => {
        resolve = nextResolve;
    });
    return { promise, resolve };
}

const friend: FriendListRow = {
    id: 'usr_friend',
    displayName: 'Friend',
    stateBucket: 'online'
};

function renderActions() {
    let deletingFriendIds = new Set<string>();
    let selectedFriendIds = new Set(['usr_friend']);
    const setDeletingFriendIds = vi.fn<Dispatch<SetStateAction<Set<string>>>>(
        (next) => {
            deletingFriendIds =
                typeof next === 'function' ? next(deletingFriendIds) : next;
        }
    );
    const setSelectedFriendIds = vi.fn<Dispatch<SetStateAction<Set<string>>>>(
        (next) => {
            selectedFriendIds =
                typeof next === 'function' ? next(selectedFriendIds) : next;
        }
    );
    const hook = renderHook(() =>
        useFriendListRowActions({
            filteredRows: [friend],
            resetTableLayout: vi.fn(),
            rosterRows: [friend],
            selectedFriendIds,
            setDeletingFriendIds,
            setIsBulkDeleting: vi.fn(),
            setMutualProgress: vi.fn(),
            setSelectedFriendIds
        })
    );
    return {
        ...hook,
        deletingFriendIds: () => deletingFriendIds,
        selectedFriendIds: () => selectedFriendIds
    };
}

describe('useFriendListRowActions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.runtimeState.auth.currentUserId = 'usr_self';
        mocks.runtimeState.auth.currentUserEndpoint =
            'https://api.vrchat.cloud/api/1';
        mocks.friendState.friendsById = { usr_friend: friend };
        mocks.runtimeState.mutualGraph = {
            runId: 0,
            status: 'idle',
            ownerUserId: '',
            processedFriends: 0,
            totalFriends: 0
        };
        mocks.getMutualSnapshot.mockResolvedValue({
            snapshot: new Map(),
            meta: new Map()
        });
    });

    it('does not unfriend when destructive confirmation is cancelled', async () => {
        mocks.confirm.mockResolvedValue({ ok: false, reason: 'cancelled' });
        const { result } = renderActions();

        await act(async () => result.current.confirmDeleteFriend(friend));

        expect(mocks.deleteFriend).not.toHaveBeenCalled();
        expect(mocks.toastSuccess).not.toHaveBeenCalled();
    });

    it('locks the row, removes the selection, and warns on partial success', async () => {
        mocks.confirm.mockResolvedValue({ ok: true, value: undefined });
        const rendered = renderActions();
        let deletingDuringRequest: string[] = [];
        mocks.deleteFriend.mockImplementation(async () => {
            deletingDuringRequest = [...rendered.deletingFriendIds()];
            return {
                stale: false,
                localError: new Error('local persistence failed')
            };
        });

        await act(async () =>
            rendered.result.current.confirmDeleteFriend(friend)
        );

        expect(mocks.deleteFriend).toHaveBeenCalledWith({
            friend,
            userId: 'usr_friend',
            endpoint: 'https://api.vrchat.cloud/api/1',
            currentUserId: 'usr_self'
        });
        expect(rendered.selectedFriendIds()).not.toContain('usr_friend');
        expect(deletingDuringRequest).toEqual(['usr_friend']);
        expect(rendered.deletingFriendIds()).not.toContain('usr_friend');
        expect(mocks.toastWarning).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'warning',
                title: 'dialog.user.toast.applied_on_vrchat_but_local_update_failed'
            })
        );
        expect(mocks.toastSuccess).not.toHaveBeenCalled();
    });

    it('preserves current presence when applying completed mutual stats', async () => {
        mocks.runtimeState.mutualGraph = {
            runId: 1,
            status: 'completed',
            ownerUserId: 'usr_self',
            processedFriends: 1,
            totalFriends: 1
        };
        mocks.getMutualSnapshot.mockResolvedValue({
            snapshot: new Map([['usr_friend', ['usr_mutual']]]),
            meta: new Map([['usr_friend', { optedOut: false }]])
        });

        renderActions();

        await act(async () => {
            await Promise.resolve();
        });

        expect(mocks.friendState.applyFriendPatch).toHaveBeenCalledWith({
            userId: 'usr_friend',
            patch: {
                $mutualCount: 1,
                $mutualOptedOut: false
            },
            stateBucketAuthority: 'preserve'
        });
    });

    it('ignores a completed snapshot after the authenticated user changes', async () => {
        const pendingSnapshot = deferred<MutualSnapshot>();
        mocks.runtimeState.mutualGraph = {
            runId: 1,
            status: 'completed',
            ownerUserId: 'usr_self',
            processedFriends: 1,
            totalFriends: 1
        };
        mocks.getMutualSnapshot.mockReturnValue(pendingSnapshot.promise);

        renderActions();
        await act(async () => {
            await Promise.resolve();
        });
        mocks.runtimeState.auth.currentUserId = 'usr_other';
        mocks.runtimeState.auth.currentUserEndpoint =
            'https://api.vrchat.cloud/api/1?user=other';
        mocks.friendState.friendsById = {
            usr_other_friend: {
                ...friend,
                id: 'usr_other_friend'
            }
        };
        await act(async () => {
            pendingSnapshot.resolve({
                snapshot: new Map([['usr_friend', ['usr_mutual']]]),
                meta: new Map()
            });
            await pendingSnapshot.promise;
        });

        expect(mocks.friendState.applyFriendPatch).not.toHaveBeenCalled();
    });

    it('ignores a completed snapshot after a newer run starts', async () => {
        const pendingSnapshot = deferred<MutualSnapshot>();
        mocks.runtimeState.mutualGraph = {
            runId: 1,
            status: 'completed',
            ownerUserId: 'usr_self',
            processedFriends: 1,
            totalFriends: 1
        };
        mocks.getMutualSnapshot.mockReturnValue(pendingSnapshot.promise);

        renderActions();
        await act(async () => {
            await Promise.resolve();
        });
        mocks.runtimeState.mutualGraph = {
            runId: 2,
            status: 'running',
            ownerUserId: 'usr_self',
            processedFriends: 0,
            totalFriends: 1
        };
        await act(async () => {
            pendingSnapshot.resolve({
                snapshot: new Map([['usr_friend', ['usr_mutual']]]),
                meta: new Map()
            });
            await pendingSnapshot.promise;
        });

        expect(mocks.friendState.applyFriendPatch).not.toHaveBeenCalled();
    });
});
