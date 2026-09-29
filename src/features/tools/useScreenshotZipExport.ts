import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    commands,
    type ScreenshotExportProgress
} from '@/platform/tauri/bindings';
import { subscribeScreenshotExportProgress } from '@/services/screenshotExportService';
import { toast } from '@/services/toastService';

import {
    startScreenshotExportProgressToast,
    type ScreenshotExportProgressToast
} from './screenshotExportProgressToast';

export function useScreenshotZipExport() {
    const { t } = useTranslation();
    const [exportRunning, setExportRunning] = useState(false);

    async function exportScreenshots(paths: string[], groupByFolder: boolean) {
        if (exportRunning || paths.length === 0) {
            return;
        }

        setExportRunning(true);
        const session: {
            progress: ScreenshotExportProgress | null;
            progressToast: ScreenshotExportProgressToast | null;
        } = { progress: null, progressToast: null };

        const unsubscribe = subscribeScreenshotExportProgress((progress) => {
            session.progress = progress;
            if (!progress.running) {
                return;
            }
            session.progressToast ??= startScreenshotExportProgressToast({
                buildMessage: (writtenFiles, totalFiles) =>
                    t('dialog.screenshot_metadata.exporting_progress', {
                        done: writtenFiles,
                        total: totalFiles
                    }),
                finalizingLabel: t(
                    'dialog.screenshot_metadata.export_finalizing'
                ),
                cancelLabel: t('common.actions.cancel'),
                onCancel: () => {
                    commands.appCancelScreenshotExport().catch(() => {});
                }
            });
            session.progressToast.update(progress);
        });

        try {
            const outputPath = await commands.appExportScreenshotsZip(
                paths,
                groupByFolder
            );
            if (session.progress?.cancelled) {
                toast.add({
                    type: 'warning',
                    title: t('message.screenshot_metadata.export_cancelled')
                });
                return;
            }
            if (!outputPath) {
                return;
            }
            const skipped = session.progress?.skippedFiles ?? 0;
            if (skipped > 0) {
                toast.add({
                    type: 'warning',
                    title: t('message.screenshot_metadata.export_partial', {
                        count: skipped
                    })
                });
                return;
            }
            toast.add({
                type: 'success',
                title: t('message.screenshot_metadata.export_done', {
                    count: session.progress?.writtenFiles ?? paths.length
                })
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('message.screenshot_metadata.export_failed')
            });
        } finally {
            unsubscribe();
            session.progressToast?.dismiss();
            setExportRunning(false);
        }
    }

    return {
        exportRunning,
        exportScreenshots
    };
}
