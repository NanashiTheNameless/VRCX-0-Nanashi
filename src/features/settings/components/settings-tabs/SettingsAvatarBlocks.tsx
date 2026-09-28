import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    commands,
    type AvatarBlockPreview,
    type AvatarBlockResult
} from '@/platform/tauri/bindings';
import { useModalStore } from '@/state/modalStore';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';

const P = 'view.settings.safety';

export function SettingsAvatarBlocks({
    sourceId,
    disabled
}: {
    sourceId: string;
    disabled: boolean;
}) {
    const { t } = useTranslation();
    const [preview, setPreview] = useState<AvatarBlockPreview | null>(null);
    const [selected, setSelected] = useState<string[]>([]);
    const [results, setResults] = useState<AvatarBlockResult[]>([]);
    const [busy, setBusy] = useState(false);
    const [applying, setApplying] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        setPreview(null);
        setSelected([]);
    }, [sourceId, disabled]);
    async function load(offset: number) {
        setBusy(true);
        setError('');
        setSelected([]);
        setPreview(null);
        try {
            setPreview(
                await commands.appSafetyAvatarBlockPreview(sourceId, offset)
            );
        } catch (reason) {
            setError(String(reason));
        } finally {
            setBusy(false);
        }
    }
    async function apply() {
        if (!preview || !selected.length) return;
        setBusy(true);
        setError('');
        try {
            const choice = await useModalStore.getState().confirm({
                title: t(`${P}.avatar_block_confirm_title`),
                description: t(`${P}.avatar_block_confirm`, {
                    account: preview.accountUserId,
                    source: preview.sourceName,
                    ids: selected.join('\n')
                }),
                confirmText: t(`${P}.block_selected`),
                cancelText: t('common.actions.cancel'),
                destructive: true
            });
            if (!choice.ok) return;
            setApplying(true);
            setResults(
                await commands.appSafetyAvatarBlocksApply(
                    preview.token,
                    selected
                )
            );
            setPreview(null);
            setSelected([]);
        } catch (reason) {
            setError(String(reason));
            setPreview(null);
            setSelected([]);
        } finally {
            setBusy(false);
            setApplying(false);
        }
    }
    async function stop() {
        try {
            await commands.appSafetyAvatarBlocksCancel();
        } catch (reason) {
            setError(String(reason));
        }
    }
    return (
        <div className="space-y-2 border-t pt-2">
            <p className="text-muted-foreground text-sm">
                {t(`${P}.avatar_blocks_description`)}
            </p>
            <Button
                variant="outline"
                disabled={disabled || busy}
                onClick={() => void load(0)}
            >
                {t(`${P}.review_avatar_blocks`)}
            </Button>
            {error && (
                <p role="alert" className="text-destructive text-sm">
                    {error}
                </p>
            )}
            {preview && !disabled && (
                <div className="space-y-2">
                    <p className="text-sm break-all">
                        {t(`${P}.avatar_review_account`, {
                            account: preview.accountUserId,
                            source: preview.sourceName
                        })}
                    </p>
                    <p className="text-muted-foreground text-sm">
                        {t(`${P}.avatar_review_page`, {
                            start: preview.entries.length
                                ? preview.offset + 1
                                : 0,
                            end: preview.offset + preview.entries.length,
                            total: preview.total
                        })}
                    </p>
                    <div className="max-h-72 space-y-2 overflow-auto">
                        {preview.entries.map((entry) => (
                            <label
                                key={entry.id}
                                className="flex items-start gap-2 text-sm"
                            >
                                <Checkbox
                                    disabled={busy}
                                    checked={selected.includes(entry.id)}
                                    onCheckedChange={(checked) =>
                                        setSelected((ids) =>
                                            checked === true
                                                ? [...ids, entry.id]
                                                : ids.filter(
                                                      (id) => id !== entry.id
                                                  )
                                        )
                                    }
                                />
                                <span className="break-all">
                                    {entry.name ||
                                        t(`${P}.avatar_name_unknown`)}
                                    <br />
                                    {entry.id}
                                </span>
                            </label>
                        ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                                setSelected(preview.entries.map((e) => e.id))
                            }
                        >
                            {t(`${P}.select_page`)}
                        </Button>
                        <Button
                            variant="outline"
                            disabled={busy || preview.offset === 0}
                            onClick={() =>
                                void load(Math.max(0, preview.offset - 25))
                            }
                        >
                            {t(`${P}.previous_page`)}
                        </Button>
                        <Button
                            variant="outline"
                            disabled={
                                busy ||
                                preview.offset + preview.entries.length >=
                                    preview.total
                            }
                            onClick={() => void load(preview.offset + 25)}
                        >
                            {t(`${P}.next_page`)}
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={busy || !selected.length}
                            onClick={() => void apply()}
                        >
                            {t(`${P}.block_selected`)}
                        </Button>
                    </div>
                </div>
            )}
            {applying && (
                <div className="space-y-2">
                    <p role="status" className="text-sm">
                        {t(`${P}.avatar_blocks_running`)}
                    </p>
                    <Button variant="outline" onClick={() => void stop()}>
                        {t(`${P}.stop_remaining`)}
                    </Button>
                </div>
            )}
            {results.length > 0 && (
                <div
                    role="status"
                    className="max-h-48 space-y-1 overflow-auto text-xs"
                >
                    {results.map((r) => (
                        <p key={r.id} className="break-all">
                            {r.id}: {r.outcome}
                        </p>
                    ))}
                </div>
            )}
        </div>
    );
}
