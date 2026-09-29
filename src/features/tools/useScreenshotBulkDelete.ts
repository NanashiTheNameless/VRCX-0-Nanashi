import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { commands } from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { useModalStore } from '@/state/modalStore';

import { runGalleryBulkDelete } from './galleryBulkDelete';
import { startGalleryBulkProgressToast } from './galleryBulkProgressToast';

export function useScreenshotBulkDelete({
    scopeKey,
    removeDeletedImages,
    refreshGalleryTree
}: {
    scopeKey: string;
    removeDeletedImages: (paths: string[]) => void;
    refreshGalleryTree: () => void;
}) {
    const { t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const [bulkDeleteRunning, setBulkDeleteRunning] = useState(false);
    const cancelledRef = useRef(false);
    const scopeKeyRef = useRef(scopeKey);

    useEffect(() => {
        scopeKeyRef.current = scopeKey;
    }, [scopeKey]);

    async function deleteScreenshots(paths: string[]) {
        if (bulkDeleteRunning || paths.length === 0) {
            return;
        }

        const confirmResult = await confirm({
            title: t(
                'dialog.screenshot_metadata.delete_file_confirm_title_bulk',
                { count: paths.length }
            ),
            description: t(
                'dialog.screenshot_metadata.delete_file_confirm_description'
            ),
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!confirmResult.ok) {
            return;
        }

        const startedScopeKey = scopeKeyRef.current;
        const deletedPaths: string[] = [];
        cancelledRef.current = false;
        setBulkDeleteRunning(true);
        const progress = startGalleryBulkProgressToast({
            total: paths.length,
            buildMessage: (done) =>
                t('view.tools.gallery_selection.deleting_progress', {
                    done,
                    total: paths.length
                }),
            cancelLabel: t('common.actions.cancel'),
            onCancel: () => {
                cancelledRef.current = true;
            }
        });
        const { cancelled, deleted, failed, lastError } =
            await runGalleryBulkDelete({
                assetIds: paths,
                deleteAsset: (path) => commands.appDeleteScreenshotFile(path),
                isCancelled: () => cancelledRef.current,
                isScopeValid: () => scopeKeyRef.current === startedScopeKey,
                onDeleted: (path) => deletedPaths.push(path),
                onProgress: progress.update
            }).finally(() => {
                progress.dismiss();
                setBulkDeleteRunning(false);
            });

        if (deletedPaths.length > 0) {
            removeDeletedImages(deletedPaths);
        }
        if (deleted > 0) {
            refreshGalleryTree();
        }

        if (cancelled) {
            toast.add({
                type: 'warning',
                title: t(
                    'view.tools.gallery_selection.delete_cancelled_toast',
                    {
                        count: deleted
                    }
                )
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

    return {
        bulkDeleteRunning,
        deleteScreenshots
    };
}
