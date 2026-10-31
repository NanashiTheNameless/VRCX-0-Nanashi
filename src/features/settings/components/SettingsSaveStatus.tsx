import { CheckIcon, CircleAlertIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';

import type { DraftSaveMode } from '../useDraftAutosave';

type SettingsSaveStatusProps = {
    mode: DraftSaveMode;
    error?: string;
    /** Why the change in review mode is not saved automatically. */
    reviewMessage?: string;
    saveLabel?: string;
    canSave?: boolean;
    onSave: () => void;
};

export function SettingsSaveStatus({
    mode,
    error,
    reviewMessage,
    saveLabel,
    canSave = true,
    onSave
}: SettingsSaveStatusProps) {
    const { t } = useTranslation();
    if (mode === 'review') {
        return (
            <div
                role="status"
                className="bg-background sticky bottom-2 z-10 flex flex-wrap items-center gap-3 rounded-md border border-amber-500 bg-amber-500/10 p-3 text-sm shadow-md"
            >
                <TriangleAlertIcon className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span className="min-w-0 flex-1 font-medium">
                    {reviewMessage || t('view.settings.save_status.unsaved')}
                </span>
                {canSave ? (
                    <Button size="sm" onClick={onSave}>
                        {saveLabel || t('common.actions.save')}
                    </Button>
                ) : null}
            </div>
        );
    }
    if (mode === 'error') {
        return (
            <div
                role="alert"
                className="border-destructive text-destructive bg-background sticky bottom-2 z-10 flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm shadow-md"
            >
                <CircleAlertIcon className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 font-medium">
                    {t('view.settings.save_status.failed', { error })}
                </span>
                <Button size="sm" variant="outline" onClick={onSave}>
                    {t('view.settings.save_status.retry')}
                </Button>
            </div>
        );
    }
    if (mode === 'saving') {
        return (
            <p
                role="status"
                className="text-muted-foreground flex items-center gap-2 text-sm"
            >
                <Spinner />
                {t('view.settings.save_status.saving')}
            </p>
        );
    }
    if (mode === 'saved') {
        return (
            <p
                role="status"
                className="text-muted-foreground flex items-center gap-2 text-sm"
            >
                <CheckIcon className="size-4" />
                {t('view.settings.save_status.saved')}
            </p>
        );
    }
    return null;
}
