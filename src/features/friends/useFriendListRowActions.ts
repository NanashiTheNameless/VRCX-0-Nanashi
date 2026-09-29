import {
    useCallback,
    useEffect,
    useRef,
    type Dispatch,
    type SetStateAction
} from 'react';
import { useTranslation } from 'react-i18next';

import mutualGraphPersistenceRepository from '@/repositories/mutualGraphPersistenceRepository';
import { openUserDialog } from '@/services/dialogService';
import {
    openFriendProfileLoadDialog,
    startFriendProfileLoad
} from '@/services/friendProfileLoadService';
import friendRelationshipService from '@/services/friendRelationshipService';
import { startMutualGraphFetch } from '@/services/mutualGraphFetchService';
import { toast } from '@/services/toastService';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useModalStore } from '@/state/modalStore';
import { useMutualGraphRevisionStore } from '@/state/mutualGraphRevisionStore';
import { useRoomMutualScanStore } from '@/state/roomMutualScanStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import {
    type FriendListRow,
    normalizeFriendListId as normalizeId
} from './friendListRows';

type MutualProgress = {
    current: number;
    total: number;
};

type MutualGraphSnapshotScope = {
    endpoint: string;
    ownerUserId: string;
    runId?: number;
};

export function useFriendListRowActions({
    filteredRows,
    resetTableLayout,
    rosterRows,
    selectedFriendIds,
    setDeletingFriendIds,
    setIsBulkDeleting,
    setMutualProgress,
    setSelectedFriendIds
}: {
    filteredRows: FriendListRow[];
    resetTableLayout(): void;
    rosterRows: FriendListRow[];
    selectedFriendIds: Set<string>;
    setDeletingFriendIds: Dispatch<SetStateAction<Set<string>>>;
    setIsBulkDeleting(value: boolean): void;
    setMutualProgress(value: MutualProgress): void;
    setSelectedFriendIds: Dispatch<SetStateAction<Set<string>>>;
}) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const applyFriendPatch = useFriendRosterStore(
        (state) => state.applyFriendPatch
    );
    const confirm = useModalStore((state) => state.confirm);
    const mutualGraphRunId = useRuntimeStore(
        (state) => state.mutualGraph.runId
    );
    const mutualGraphStatus = useRuntimeStore(
        (state) => state.mutualGraph.status
    );
    const mutualGraphOwnerUserId = useRuntimeStore(
        (state) => state.mutualGraph.ownerUserId
    );
    const mutualGraphProcessedFriends = useRuntimeStore(
        (state) => state.mutualGraph.processedFriends
    );
    const mutualGraphTotalFriends = useRuntimeStore(
        (state) => state.mutualGraph.totalFriends
    );
    const friendProfileLoadStatus = useRuntimeStore(
        (state) => state.friendProfileLoad.status
    );
    const backfillRevision = useMutualGraphRevisionStore((state) =>
        state.ownerUserId === currentUserId ? state.revision : 0
    );
    const handledMutualGraphRunRef = useRef('');
    const bulkUnfriendRunRef = useRef(0);
    const isMutualFetching =
        mutualGraphOwnerUserId === currentUserId &&
        (mutualGraphStatus === 'running' || mutualGraphStatus === 'cancelling');
    const isLoadingUserDetails =
        friendProfileLoadStatus === 'running' ||
        friendProfileLoadStatus === 'cancelling';

    const applyCachedMutualFriendStats = useCallback(
        async ({ endpoint, ownerUserId, runId }: MutualGraphSnapshotScope) => {
            const { snapshot, meta } =
                await mutualGraphPersistenceRepository.getSnapshot(ownerUserId);
            const runtimeState = useRuntimeStore.getState();
            if (
                runtimeState.auth.currentUserId !== ownerUserId ||
                runtimeState.auth.currentUserEndpoint !== endpoint
            ) {
                return;
            }
            if (
                runId !== undefined &&
                (runtimeState.mutualGraph.ownerUserId !== ownerUserId ||
                    runtimeState.mutualGraph.runId !== runId ||
                    runtimeState.mutualGraph.status !== 'completed')
            ) {
                return;
            }
            const friendsById = useFriendRosterStore.getState().friendsById;
            for (const friendId of Object.keys(friendsById)) {
                const mutualIds =
                    snapshot instanceof Map ? snapshot.get(friendId) : [];
                const metadata =
                    meta instanceof Map ? meta.get(friendId) : null;
                const linkCount = Array.isArray(mutualIds)
                    ? mutualIds.length
                    : 0;
                applyFriendPatch({
                    userId: friendId,
                    patch: {
                        $mutualCount: Number.isFinite(metadata?.totalCount)
                            ? Number(metadata?.totalCount)
                            : linkCount,
                        $mutualOptedOut: Boolean(metadata?.optedOut)
                    },
                    stateBucketAuthority: 'preserve'
                });
            }
        },
        [applyFriendPatch]
    );

    useEffect(() => {
        if (!currentUserId || !backfillRevision) {
            return;
        }
        applyCachedMutualFriendStats({
            endpoint: currentEndpoint,
            ownerUserId: currentUserId
        }).catch((error) => {
            console.warn(
                '[FriendListPage] Failed to apply mutual graph backfill',
                error
            );
        });
    }, [
        applyCachedMutualFriendStats,
        backfillRevision,
        currentEndpoint,
        currentUserId
    ]);

    useEffect(() => {
        if (!isMutualFetching) {
            return;
        }
        setMutualProgress({
            current: mutualGraphProcessedFriends,
            total: mutualGraphTotalFriends
        });
    }, [
        isMutualFetching,
        mutualGraphProcessedFriends,
        mutualGraphTotalFriends,
        setMutualProgress
    ]);

    useEffect(() => {
        const runSignature = `${currentEndpoint}\u0000${currentUserId}\u0000${mutualGraphRunId}`;
        if (
            !currentUserId ||
            !mutualGraphRunId ||
            mutualGraphOwnerUserId !== currentUserId ||
            handledMutualGraphRunRef.current === runSignature
        ) {
            return;
        }

        if (mutualGraphStatus === 'completed') {
            handledMutualGraphRunRef.current = runSignature;
            applyCachedMutualFriendStats({
                endpoint: currentEndpoint,
                ownerUserId: currentUserId,
                runId: mutualGraphRunId
            }).catch((error) => {
                console.warn(
                    '[FriendListPage] Failed to apply mutual graph cache',
                    error
                );
            });
            return;
        }

        if (mutualGraphStatus === 'error') {
            handledMutualGraphRunRef.current = runSignature;
        }
    }, [
        applyCachedMutualFriendStats,
        currentEndpoint,
        currentUserId,
        mutualGraphOwnerUserId,
        mutualGraphRunId,
        mutualGraphStatus
    ]);

    const setFriendDeleting = useCallback(
        (userId: string, isDeleting: boolean) => {
            const normalizedUserId = normalizeId(userId);
            if (!normalizedUserId) {
                return;
            }
            setDeletingFriendIds((current) => {
                const next = new Set(current);
                if (isDeleting) {
                    next.add(normalizedUserId);
                } else {
                    next.delete(normalizedUserId);
                }
                return next;
            });
        },
        [setDeletingFriendIds]
    );

    const toggleSelectedFriend = useCallback(
        (userId: string) => {
            const normalizedUserId = normalizeId(userId);
            if (!normalizedUserId) {
                return;
            }
            setSelectedFriendIds((current) => {
                const next = new Set(current);
                if (next.has(normalizedUserId)) {
                    next.delete(normalizedUserId);
                } else {
                    next.add(normalizedUserId);
                }
                return next;
            });
        },
        [setSelectedFriendIds]
    );

    const deleteFriendById = useCallback(
        async (userId: string) => {
            const normalizedUserId = normalizeId(userId);
            const friend =
                useFriendRosterStore.getState().friendsById[normalizedUserId];
            if (!normalizedUserId || !friend || !currentUserId) {
                return {
                    stale: false,
                    deleted: false
                };
            }
            setFriendDeleting(normalizedUserId, true);
            try {
                const result = await friendRelationshipService.deleteFriend({
                    friend,
                    userId: normalizedUserId,
                    endpoint: currentEndpoint,
                    currentUserId
                });
                if (!result.stale) {
                    setSelectedFriendIds((current) => {
                        const next = new Set(current);
                        next.delete(normalizedUserId);
                        return next;
                    });
                    if (result.localError) {
                        toast.add({
                            type: 'warning',
                            title: t(
                                'dialog.user.toast.applied_on_vrchat_but_local_update_failed'
                            )
                        });
                    } else {
                        toast.add({
                            type: 'success',
                            title: t('view.friends.dynamic.unfriended_value', {
                                value: friend.displayName || normalizedUserId
                            })
                        });
                    }
                }
                return {
                    ...result,
                    deleted: !result.stale
                };
            } catch (error) {
                const auth = useRuntimeStore.getState().auth;
                if (
                    normalizeId(auth.currentUserId) !==
                        normalizeId(currentUserId) ||
                    normalizeId(auth.currentUserEndpoint) !==
                        normalizeId(currentEndpoint)
                ) {
                    return {
                        stale: true,
                        deleted: false
                    };
                }
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t('view.friends.toast.failed_to_unfriend_value', {
                                  value: friend.displayName || normalizedUserId
                              })
                });
                return {
                    stale: false,
                    deleted: false
                };
            } finally {
                setFriendDeleting(normalizedUserId, false);
            }
        },
        [
            currentEndpoint,
            currentUserId,
            setFriendDeleting,
            setSelectedFriendIds,
            t
        ]
    );

    const confirmDeleteFriend = useCallback(
        async (friend: FriendListRow) => {
            const normalizedUserId = normalizeId(friend?.id);
            if (!normalizedUserId) {
                return;
            }
            const result = await confirm({
                title: t('view.friends.modal.unfriend_user'),
                description: friend?.displayName || normalizedUserId,
                confirmText: t('view.friends.modal.unfriend'),
                cancelText: t('common.actions.cancel'),
                destructive: true
            });
            if (!result.ok) {
                return;
            }
            await deleteFriendById(normalizedUserId);
        },
        [confirm, deleteFriendById, t]
    );

    async function bulkUnfriendSelected() {
        if (!currentUserId || !currentEndpoint) {
            return;
        }
        const selectedRows = filteredRows.filter((friend) =>
            selectedFriendIds.has(normalizeId(friend?.id))
        );
        if (!selectedRows.length) {
            return;
        }
        const result = await confirm({
            title: t('view.friends.dynamic.unfriend_value_friends', {
                value: selectedRows.length
            }),
            description: selectedRows
                .map((friend) => friend.displayName || normalizeId(friend.id))
                .slice(0, 30)
                .join('\n'),
            confirmText: t('view.friends.modal.unfriend'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }
        const runId = bulkUnfriendRunRef.current + 1;
        bulkUnfriendRunRef.current = runId;
        setIsBulkDeleting(true);
        const targetIds = selectedRows.map((friend) => normalizeId(friend.id));
        setDeletingFriendIds((current) => {
            const next = new Set(current);
            for (const userId of targetIds) {
                next.add(userId);
            }
            return next;
        });
        try {
            const batchResult = await friendRelationshipService.deleteFriends({
                expectedEndpoint: currentEndpoint,
                expectedOwnerUserId: currentUserId,
                friends: selectedRows
            });
            if (
                batchResult.stale ||
                bulkUnfriendRunRef.current !== runId ||
                normalizeId(useRuntimeStore.getState().auth.currentUserId) !==
                    batchResult.ownerUserId ||
                normalizeId(
                    useRuntimeStore.getState().auth.currentUserEndpoint
                ) !== normalizeId(currentEndpoint)
            ) {
                return;
            }
            const rowsById = new Map(
                selectedRows.map((friend) => [normalizeId(friend.id), friend])
            );
            const removedIds = new Set<string>();
            for (const item of batchResult.items) {
                if (
                    item.state === 'applied' ||
                    item.state === 'remoteOkLocalFailed'
                ) {
                    removedIds.add(item.userId);
                    if (item.state === 'remoteOkLocalFailed') {
                        toast.add({
                            type: 'warning',
                            title: t(
                                'dialog.user.toast.applied_on_vrchat_but_local_update_failed'
                            )
                        });
                    }
                    continue;
                }
                const friend = rowsById.get(item.userId);
                toast.add({
                    type: 'error',
                    title:
                        item.message ||
                        t('view.friends.toast.failed_to_unfriend_value', {
                            value: friend?.displayName || item.userId
                        })
                });
            }
            if (removedIds.size) {
                setSelectedFriendIds((current) => {
                    const next = new Set(current);
                    for (const userId of removedIds) {
                        next.delete(userId);
                    }
                    return next;
                });
                toast.add({
                    type: 'success',
                    title: t('view.friends.dynamic.unfriended_value_friends', {
                        value: removedIds.size
                    })
                });
            }
        } catch (error) {
            const auth = useRuntimeStore.getState().auth;
            if (
                bulkUnfriendRunRef.current !== runId ||
                normalizeId(auth.currentUserId) !==
                    normalizeId(currentUserId) ||
                normalizeId(auth.currentUserEndpoint) !==
                    normalizeId(currentEndpoint)
            ) {
                return;
            }
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('view.friends.toast.failed_to_unfriend_value', {
                              value: selectedRows.length
                          })
            });
        } finally {
            if (bulkUnfriendRunRef.current === runId) {
                setDeletingFriendIds((current) => {
                    const next = new Set(current);
                    for (const userId of targetIds) {
                        next.delete(userId);
                    }
                    return next;
                });
                setIsBulkDeleting(false);
            }
        }
    }

    function loadFriendUserDetails() {
        if (isLoadingUserDetails) {
            openFriendProfileLoadDialog();
            return;
        }
        startFriendProfileLoad().catch((error: unknown) => {
            console.warn(
                '[FriendListPage] Failed to start friend profile loading',
                error
            );
            toast.add({
                type: 'error',
                title: t('view.friend_list.error.failed_to_load_friend_details')
            });
        });
    }

    async function loadMutualFriends() {
        if (
            !currentUserId ||
            isMutualFetching ||
            useRoomMutualScanStore.getState().running
        ) {
            return;
        }
        if (currentUserSnapshot?.hasSharedConnectionsOptOut) {
            toast.add({
                type: 'warning',
                title: t(
                    'view.friend_list.label.shared_connections_are_opted_out_for_the_current_account'
                )
            });
            return;
        }
        const friendSnapshot = rosterRows.filter((friend) =>
            normalizeId(friend?.id)
        );
        if (!friendSnapshot.length) {
            toast.add({
                type: 'info',
                title: t(
                    'view.friend_list.empty.no_friends_are_available_for_mutual_friends_loading'
                )
            });
            return;
        }
        setMutualProgress({
            current: 0,
            total: friendSnapshot.length
        });
        try {
            await startMutualGraphFetch({
                ownerUserId: currentUserId,
                endpoint: currentEndpoint,
                friendIds: friendSnapshot.map((friend) =>
                    normalizeId(friend?.id)
                )
            });
            toast.add({
                type: 'info',
                title: t('view.charts.mutual_friend.prompt.message')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.charts.toast.failed_to_fetch_mutual_friends_graph'
                          )
            });
        }
    }

    const openFriendDetails = useCallback((friend: FriendListRow) => {
        openUserDialog({
            userId: normalizeId(friend?.id),
            title:
                normalizeId(friend?.displayName) ||
                normalizeId(friend?.username) ||
                undefined
        });
    }, []);

    return {
        confirmDeleteFriend,
        isMutualFetching,
        isLoadingUserDetails,
        bulkUnfriendSelected,
        loadFriendUserDetails,
        loadMutualFriends,
        openFriendDetails,
        resetFriendListTableLayout: resetTableLayout,
        toggleSelectedFriend
    };
}
