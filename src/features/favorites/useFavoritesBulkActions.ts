import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { FavoriteRecord } from '@/domain/favorites/types';
import type { FavoriteKind } from '@/domain/favorites/types';
import type {
    FavoriteBulkRemoveResult,
    FavoriteTransferItemResult,
    FavoriteTransferMode,
    FavoriteTransferSelectionResult
} from '@/platform/tauri/bindings';
import { commands } from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import {
    buildFavoriteBulkRemoveInput,
    favoriteBulkRemoveSuccessfulKeys
} from './favoriteBulkRemove';
import type {
    FavoriteGroupView,
    FavoriteItem,
    FavoriteSource
} from './favoritesTypes';
import {
    buildFavoriteCopyTargets,
    buildFavoriteMoveTargets,
    buildFavoriteTransferFailureDescription,
    buildFavoriteTransferInput,
    buildFavoriteTransferSuccessfulKeys,
    FAVORITE_TRANSFER_RECOVERED_GROUP_NAME,
    groupFavoriteItemsBySourceGroup,
    resolveFavoriteSourceGroup,
    summarizeFavoriteTransferStatuses
} from './favoriteTransfer';

export function useFavoritesBulkActions({
    currentEndpoint,
    kind,
    localGroups,
    remoteFavoritesByObjectId,
    remoteGroups,
    selectedContentItems,
    selectedGroupKey,
    selectedSource,
    setSelectedKeys
}: {
    currentEndpoint: string;
    kind: FavoriteKind;
    localGroups: FavoriteGroupView[];
    remoteFavoritesByObjectId: Record<string, FavoriteRecord | undefined>;
    remoteGroups: FavoriteGroupView[];
    selectedContentItems: FavoriteItem[];
    selectedGroupKey: string;
    selectedSource: FavoriteSource;
    setSelectedKeys(value: string[] | ((current: string[]) => string[])): void;
}) {
    const { t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const moveTargets = useMemo(
        () =>
            buildFavoriteMoveTargets({
                remoteGroups,
                localGroups,
                selectedSource,
                selectedGroupKey,
                selectedItems: selectedContentItems,
                remoteFavoritesByObjectId
            }),
        [
            localGroups,
            remoteFavoritesByObjectId,
            remoteGroups,
            selectedContentItems,
            selectedGroupKey,
            selectedSource
        ]
    );
    const copyTargets = useMemo(
        () =>
            buildFavoriteCopyTargets({
                remoteGroups,
                localGroups,
                selectedSource,
                selectedGroupKey,
                selectedItems: selectedContentItems,
                remoteFavoritesByObjectId
            }),
        [
            localGroups,
            remoteFavoritesByObjectId,
            remoteGroups,
            selectedContentItems,
            selectedGroupKey,
            selectedSource
        ]
    );

    async function bulkRemoveSelection() {
        if (!currentUserId || !selectedContentItems.length) {
            return;
        }
        const batchOwnerUserId = currentUserId;
        const batchEndpoint = currentEndpoint;
        const result = await confirm({
            title: t('view.favorites.modal.delete_value_favorites', {
                value: selectedContentItems.length
            }),
            description: t('view.favorites.modal.this_action_cannot_be_undone'),
            destructive: true,
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        try {
            const batchResult: FavoriteBulkRemoveResult =
                await commands.appFavoritesRemoveSelection(
                    buildFavoriteBulkRemoveInput({
                        items: selectedContentItems,
                        kind
                    })
                );
            const removedKeys = favoriteBulkRemoveSuccessfulKeys(batchResult);
            const currentAuth = useRuntimeStore.getState().auth;
            if (
                currentAuth.currentUserId !== batchResult.ownerUserId ||
                currentAuth.currentUserEndpoint !== batchEndpoint
            ) {
                return;
            }
            if (removedKeys.size) {
                setSelectedKeys((current) =>
                    current.filter((key) => !removedKeys.has(key))
                );
            }
            if (batchResult.failed === 0) {
                toast.add({
                    type: 'success',
                    title: t('view.favorite.success.selected_favorites_removed')
                });
                return;
            }
            toast.add({
                type: 'error',
                title: t('view.favorites.dynamic.removed_value_value_failed', {
                    value: batchResult.succeeded,
                    value2: batchResult.failed
                })
            });
        } catch (error) {
            const currentAuth = useRuntimeStore.getState().auth;
            if (
                currentAuth.currentUserId !== batchOwnerUserId ||
                currentAuth.currentUserEndpoint !== batchEndpoint
            ) {
                return;
            }
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.favorites.dynamic.removed_value_value_failed',
                              {
                                  value: 0,
                                  value2: selectedContentItems.length
                              }
                          )
            });
        }
    }

    function describeFavoriteTransferNotices(
        summary: ReturnType<typeof summarizeFavoriteTransferStatuses>
    ): string[] {
        const notices: string[] = [];
        if (summary.restoredToSource > 0) {
            notices.push(
                t(
                    'view.favorites.dynamic.restored_value_to_source_after_failed_move',
                    { value: summary.restoredToSource }
                )
            );
        }
        if (summary.savedToLocalFallback > 0) {
            notices.push(
                t(
                    'view.favorites.dynamic.saved_value_to_local_fallback_group',
                    {
                        value: summary.savedToLocalFallback,
                        value2: FAVORITE_TRANSFER_RECOVERED_GROUP_NAME
                    }
                )
            );
        }
        if (summary.targetAddedSourceDeleteFailed > 0) {
            notices.push(
                t(
                    'view.favorites.dynamic.target_added_value_source_delete_failed',
                    { value: summary.targetAddedSourceDeleteFailed }
                )
            );
        }
        if (summary.skippedAlreadyPresent > 0) {
            notices.push(
                t('view.favorites.dynamic.skipped_value_already_present', {
                    value: summary.skippedAlreadyPresent
                })
            );
        }
        return notices;
    }

    async function bulkTransferSelection(
        targetGroup: FavoriteGroupView,
        mode: FavoriteTransferMode
    ) {
        if (!selectedContentItems.length) {
            return;
        }
        const batches = groupFavoriteItemsBySourceGroup(selectedContentItems);
        const transferBatches = batches.map((batchItems) => {
            const sourceGroup = resolveFavoriteSourceGroup({
                item: batchItems[0],
                remoteGroups,
                localGroups
            });
            return buildFavoriteTransferInput({
                kind,
                mode,
                sourceGroup,
                targetGroup,
                selectedItems: batchItems
            });
        });
        let result: FavoriteTransferSelectionResult;
        try {
            result = await commands.appFavoritesTransferSelection({
                batches: transferBatches
            });
        } catch (error) {
            result = {
                total: selectedContentItems.length,
                succeeded: 0,
                failed: selectedContentItems.length,
                localChanged: false,
                remoteChanged: false,
                items: [],
                lastError: error instanceof Error ? error.message : null
            };
        }
        const succeeded = result.succeeded;
        const failed = result.failed;
        const allResults: FavoriteTransferItemResult[] = result.items;
        const successfulKeys = buildFavoriteTransferSuccessfulKeys(
            result.items
        );

        if (succeeded > 0) {
            setSelectedKeys((current) =>
                current.filter((key) => !successfulKeys.has(key))
            );
        }

        const summary = summarizeFavoriteTransferStatuses(allResults);
        const notices = describeFavoriteTransferNotices(summary);
        const noticeDescription = notices.join('\n');
        const successMessage =
            mode === 'copy'
                ? t('view.favorites.dynamic.copied_value_favorites', {
                      value: summary.succeeded
                  })
                : t('view.favorites.dynamic.moved_value_favorites', {
                      value: summary.succeeded
                  });

        if (failed === 0 && notices.length === 0) {
            toast.add({ type: 'success', title: successMessage });
            return;
        }

        if (failed === 0) {
            toast.add({
                type: 'warning',
                title: successMessage,
                ...(noticeDescription
                    ? { description: noticeDescription }
                    : undefined)
            });
            return;
        }

        const fallbackMessage =
            result.lastError ||
            t('view.favorites.toast.failed_to_move_selected_favorites');
        const failureDescription = buildFavoriteTransferFailureDescription({
            results: allResults.filter((item) => item.status === 'failed'),
            selectedItems: selectedContentItems,
            fallbackMessage
        });
        const combinedDescription = [noticeDescription, failureDescription]
            .filter(Boolean)
            .join('\n');
        toast.add({
            type: 'error',
            title: t('view.favorites.dynamic.transferred_value_value_failed', {
                value: succeeded,
                value2: failed
            }),
            ...(combinedDescription
                ? { description: combinedDescription }
                : undefined)
        });
    }

    function bulkMoveSelection(targetGroup: FavoriteGroupView) {
        return bulkTransferSelection(targetGroup, 'move');
    }

    function bulkCopySelection(targetGroup: FavoriteGroupView) {
        return bulkTransferSelection(targetGroup, 'copy');
    }

    return {
        bulkCopySelection,
        bulkMoveSelection,
        bulkRemoveSelection,
        copyTargets,
        moveTargets
    };
}
