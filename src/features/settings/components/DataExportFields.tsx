import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { commands } from '@/platform/tauri/bindings';
import { restartApplication } from '@/services/shellIntegrationService';
import { toast } from '@/services/toastService';
import { useModalStore } from '@/state/modalStore';
import { Button } from '@/ui/shadcn/button';

import { Field } from './SettingsField';

const P = 'view.settings.data_export';

function defaultExportName(): string {
    const date = new Date().toISOString().slice(0, 10);
    return `VRCX-0-Nanashi-data-${date}.zip`;
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// Fork: export/import every profile file and setting as one level 9 zip.
export function DataExportFields() {
    const { t } = useTranslation();
    const [running, setRunning] = useState<'export' | 'import' | null>(null);

    async function exportData() {
        const path = await commands.appSaveFileSelectorDialog(
            null,
            defaultExportName(),
            'zip',
            'Zip archive|*.zip'
        );
        if (typeof path !== 'string' || !path.trim()) {
            return;
        }
        setRunning('export');
        try {
            const report = await commands.appDataExport(path);
            toast.add({
                type: 'success',
                title: t(`${P}.export_done`, {
                    files: report.files,
                    megabytes: (report.bytes / (1024 * 1024)).toFixed(1)
                })
            });
        } catch (error) {
            toast.add({ type: 'error', title: errorText(error) });
        } finally {
            setRunning(null);
        }
    }

    async function importData() {
        const path = await commands.appOpenFileSelectorDialog(
            null,
            null,
            'Zip archive|*.zip'
        );
        if (typeof path !== 'string' || !path.trim()) {
            return;
        }
        const confirmed = await useModalStore.getState().confirm({
            title: t(`${P}.import_confirm_title`),
            description: t(`${P}.import_confirm_description`),
            confirmText: t(`${P}.import_button`),
            cancelText: t('common.actions.cancel')
        });
        if (!confirmed.ok) {
            return;
        }
        setRunning('import');
        try {
            const summary = await commands.appDataImportStage(path);
            toast.add({
                type: 'success',
                title: t(`${P}.import_staged`, {
                    files: summary.files,
                    version: summary.appVersion
                }),
                timeout: 0,
                actionProps: {
                    children: t(`${P}.restart_now`),
                    onClick: () => {
                        void restartApplication();
                    }
                }
            });
        } catch (error) {
            toast.add({ type: 'error', title: errorText(error) });
        } finally {
            setRunning(null);
        }
    }

    return (
        <>
            <Field
                label={t(`${P}.export_label`)}
                description={t(`${P}.export_description`)}
            >
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={running !== null}
                    onClick={() => void exportData()}
                >
                    {running === 'export'
                        ? t(`${P}.exporting`)
                        : t(`${P}.export_button`)}
                </Button>
            </Field>
            <Field
                label={t(`${P}.import_label`)}
                description={t(`${P}.import_description`)}
            >
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={running !== null}
                    onClick={() => void importData()}
                >
                    {running === 'import'
                        ? t(`${P}.importing`)
                        : t(`${P}.import_button`)}
                </Button>
            </Field>
        </>
    );
}
