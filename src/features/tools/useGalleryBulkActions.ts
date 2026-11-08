import type { Dispatch, SetStateAction } from 'react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import mediaRepository from '@/repositories/vrchatMediaRepository';
import { toast } from '@/services/toastService';
import { useModalStore } from '@/state/modalStore';
import { usePrintFavoriteStore } from '@/state/printFavoriteStore';

import { getRuntimeAuthTarget, isRuntimeAuthTarget } from './galleryAuthTarget';
import { runGalleryBulkDelete } from './galleryBulkDelete';
import { startGalleryBulkProgressToast } from './galleryBulkProgressToast';
import type { GalleryAssets, GalleryTab } from './galleryConstants';

export function useGalleryBulkActions({
    setAssets
}: {
    setAssets: Dispatch<SetStateAction<GalleryAssets>>;
}) {
    const { t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const [bulkRunning, setBulkRunning] = useState(false);
    const cancelledRef = useRef(false);

    function removeAsset(tab: GalleryTab, assetId: string) {
        setAssets((current) => {
            if (tab === 'prints') {
                return {
                    ...current,
                    prints: current.prints.filter(
                        (print) => print.id !== assetId
                    )
                };
            }
            if (tab === 'icons') {
                return {
                    ...current,
                    icons: current.icons.filter((file) => file.id !== assetId)
                };
            }
            return {
                ...current,
                gallery: current.gallery.filter((file) => file.id !== assetId)
            };
        });
    }

    async function deleteSelection({
        tab,
        assetIds,
        lockedCount
    }: {
        tab: GalleryTab;
        assetIds: string[];
        lockedCount: number;
    }) {
        if (bulkRunning || assetIds.length === 0) {
            return;
        }
        const authTarget = getRuntimeAuthTarget();
        const confirmResult = await confirm({
            title: t('view.tools.gallery_selection.confirm_delete_title', {
                count: assetIds.length
            }),
            description: lockedCount
                ? t('view.tools.gallery_selection.confirm_delete_locked', {
                      count: lockedCount
                  })
                : t('view.favorites.modal.this_action_cannot_be_undone'),
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!confirmResult.ok || !isRuntimeAuthTarget(authTarget)) {
            return;
        }

        cancelledRef.current = false;
        setBulkRunning(true);
        const progress = startGalleryBulkProgressToast({
            total: assetIds.length,
            buildMessage: (done) =>
                t('view.tools.gallery_selection.deleting_progress', {
                    done,
                    total: assetIds.length
                }),
            cancelLabel: t('common.actions.cancel'),
            onCancel: () => {
                cancelledRef.current = true;
            }
        });
        const { cancelled, deleted, failed, lastError } =
            await runGalleryBulkDelete({
                assetIds,
                deleteAsset: (assetId) =>
                    tab === 'prints'
                        ? mediaRepository.deletePrint(assetId)
                        : mediaRepository.deleteFile(assetId),
                isCancelled: () => cancelledRef.current,
                isScopeValid: () => isRuntimeAuthTarget(authTarget),
                onDeleted: (assetId) => removeAsset(tab, assetId),
                onProgress: progress.update
            }).finally(() => {
                progress.dismiss();
                setBulkRunning(false);
            });

        if (cancelled) {
            toast.add({
                type: 'warning',
                title: t('view.tools.gallery_selection.delete_canceled_toast', {
                    count: deleted
                })
            });
            return;
        }
        if (failed > 0) {
            toast.add({
                type: 'error',
                title: t('view.tools.gallery_selection.delete_partial_toast', {
                    failed,
                    succeeded: deleted,
                    reason: lastError
                })
            });
            return;
        }
        toast.add({
            type: 'success',
            title: t('view.tools.gallery_selection.deleted_toast', {
                count: deleted
            })
        });
    }

    async function setFavoriteSelection({
        printIds,
        favorite
    }: {
        printIds: string[];
        favorite: boolean;
    }) {
        if (bulkRunning || printIds.length === 0) {
            return;
        }
        setBulkRunning(true);
        try {
            const result = await mediaRepository.setPrintFavorites(
                printIds,
                favorite
            );
            usePrintFavoriteStore
                .getState()
                .hydratePrintFavorites(result.state);
            if (result.skipped > 0) {
                toast.add({
                    type: 'warning',
                    title: t(
                        'view.tools.gallery_selection.favorite_skipped_toast',
                        {
                            count: result.skipped,
                            max: result.state.maxFavorites
                        }
                    )
                });
                return;
            }
            toast.add({
                type: 'success',
                title: t(
                    favorite
                        ? 'view.tools.gallery_selection.favorited_toast'
                        : 'view.tools.gallery_selection.unfavorited_toast',
                    { count: result.applied }
                )
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('view.tools.toast.failed_to_update_print_favorite')
            });
        } finally {
            setBulkRunning(false);
        }
    }

    return {
        bulkRunning,
        deleteSelection,
        setFavoriteSelection
    };
}
