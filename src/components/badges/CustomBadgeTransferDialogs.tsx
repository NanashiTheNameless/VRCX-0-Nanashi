import { readFile } from '@tauri-apps/plugin-fs';
import { CopyIcon, FolderOpenIcon, SaveIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CustomBadge } from '@/domain/badges/customBadges';
import {
    exportCustomBadgesJsonc,
    parseCustomBadgesJsonc
} from '@/domain/badges/customBadgeTransfer';
import { copyTextToClipboard } from '@/services/clipboardService';
import {
    openFileSelectorDialog,
    saveJsoncFile
} from '@/services/shellIntegrationService';
import { toast } from '@/services/toastService';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Switch } from '@/ui/shadcn/switch';
import { Textarea } from '@/ui/shadcn/textarea';

const T = 'view.settings.appearance.user_badges.transfer';

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error ?? '');
}

function exportFileName(badges: readonly CustomBadge[]): string {
    const base =
        badges.length === 1
            ? badges[0].label
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/^-+|-+$/g, '')
            : '';
    return `${base ? `badge-${base}` : 'custom-badges'}.jsonc`;
}

export function CustomBadgeExportDialog({
    badges,
    onClose
}: {
    badges: readonly CustomBadge[] | null;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const text = useMemo(
        () => (badges ? exportCustomBadgesJsonc(badges) : ''),
        [badges]
    );

    async function save() {
        if (!badges) {
            return;
        }
        try {
            const path = await saveJsoncFile(exportFileName(badges), text);
            if (path) {
                toast.add({
                    type: 'success',
                    title: t(`${T}.saved`, { path })
                });
            }
        } catch (error) {
            toast.add({
                type: 'error',
                title: t(`${T}.save_failed`),
                description: errorText(error)
            });
        }
    }

    return (
        <Dialog
            open={badges !== null}
            onOpenChange={(open) => !open && onClose()}
        >
            <DialogContent className="w-[calc(100%-2rem)] max-w-2xl sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{t(`${T}.export_title`)}</DialogTitle>
                    <DialogDescription>
                        {t(`${T}.export_description`)}
                    </DialogDescription>
                </DialogHeader>
                <Textarea
                    readOnly
                    rows={14}
                    className="font-mono text-xs"
                    value={text}
                    aria-label={t(`${T}.export_title`)}
                />
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                            void copyTextToClipboard(text, {
                                successMessage: t(`${T}.copied`),
                                errorMessage: errorText
                            })
                        }
                    >
                        <CopyIcon />
                        {t(`${T}.copy`)}
                    </Button>
                    <Button type="button" size="sm" onClick={() => void save()}>
                        <SaveIcon />
                        {t(`${T}.save_file`)}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function CustomBadgeImportDialog({
    open,
    onClose,
    onImport
}: {
    open: boolean;
    onClose: () => void;
    onImport: (badges: CustomBadge[], replaceSameId: boolean) => void;
}) {
    const { t } = useTranslation();
    const [text, setText] = useState('');
    const [replaceSameId, setReplaceSameId] = useState(true);
    const result = useMemo(
        () => (text.trim() ? parseCustomBadgesJsonc(text) : null),
        [text]
    );

    async function openFile() {
        try {
            const path = await openFileSelectorDialog(
                '',
                '.jsonc',
                'JSONC Files|*.jsonc;*.json'
            );
            if (path) {
                setText(new TextDecoder().decode(await readFile(path)));
            }
        } catch (error) {
            toast.add({
                type: 'error',
                title: t(`${T}.open_failed`),
                description: errorText(error)
            });
        }
    }

    function close() {
        setText('');
        onClose();
    }

    return (
        <Dialog open={open} onOpenChange={(next) => !next && close()}>
            <DialogContent className="w-[calc(100%-2rem)] max-w-2xl sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{t(`${T}.import_title`)}</DialogTitle>
                    <DialogDescription>
                        {t(`${T}.import_description`)}
                    </DialogDescription>
                </DialogHeader>
                <Textarea
                    rows={12}
                    className="font-mono text-xs"
                    value={text}
                    placeholder={t(`${T}.import_placeholder`)}
                    aria-label={t(`${T}.import_title`)}
                    onChange={(event) => setText(event.target.value)}
                />
                {result ? (
                    result.ok ? (
                        <p className="text-muted-foreground text-xs">
                            {t(`${T}.found`, { count: result.badges.length })}
                            {result.invalid
                                ? ` ${t(`${T}.invalid`, { count: result.invalid })}`
                                : ''}
                        </p>
                    ) : (
                        <p className="text-destructive text-xs" role="alert">
                            {t(`${T}.parse_error`, { error: result.error })}
                        </p>
                    )
                ) : null}
                <label className="flex items-start gap-2 text-sm">
                    <Switch
                        checked={replaceSameId}
                        onCheckedChange={setReplaceSameId}
                    />
                    <span className="flex flex-col">
                        {t(`${T}.replace_same_id`)}
                        <span className="text-muted-foreground text-xs">
                            {t(`${T}.replace_same_id_description`)}
                        </span>
                    </span>
                </label>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void openFile()}
                    >
                        <FolderOpenIcon />
                        {t(`${T}.open_file`)}
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        disabled={!result?.ok || !result.badges.length}
                        onClick={() => {
                            if (result?.ok) {
                                onImport(result.badges, replaceSameId);
                                close();
                            }
                        }}
                    >
                        {t(`${T}.import_confirm`)}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
