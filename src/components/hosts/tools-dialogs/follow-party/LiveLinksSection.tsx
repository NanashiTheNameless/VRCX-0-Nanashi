import { LinkIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { commands, type FollowShareEntry } from '@/platform/tauri/bindings';
import { copyTextToClipboard } from '@/services/clipboardService';
import { buildLiveFollowUrl } from '@/services/remoteSyncWebsiteService';
import { toast } from '@/services/toastService';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import {
    Field,
    FieldDescription,
    FieldLabel,
    FieldLegend,
    FieldSet
} from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { Switch } from '@/ui/shadcn/switch';

const I18N = 'view.tools.follow_party';
const MIN_PASSWORD = 8;

export function LiveLinksSection({ open }: { open: boolean }) {
    const { t } = useTranslation();
    const displayName = useRuntimeStore(
        (state) => state.auth.currentUserDisplayName
    );
    const [shares, setShares] = useState<FollowShareEntry[]>([]);
    const [label, setLabel] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);

    const fail = useCallback(
        (error: unknown, fallback: string) =>
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(error, t(fallback))
            }),
        [t]
    );

    const reload = useCallback(() => {
        commands
            .appFollowShareList()
            .then(setShares)
            .catch((error: unknown) => fail(error, `${I18N}.failed_to_load`));
    }, [fail]);

    useEffect(() => {
        if (open) {
            reload();
        }
    }, [open, reload]);

    async function create() {
        setBusy(true);
        try {
            await commands.appFollowShareCreate(label, password || null);
            setLabel('');
            setPassword('');
            reload();
            toast.add({ type: 'success', title: t(`${I18N}.live_created`) });
        } catch (error) {
            fail(error, `${I18N}.live_create_failed`);
        } finally {
            setBusy(false);
        }
    }

    async function copy(share: FollowShareEntry) {
        try {
            const url = await buildLiveFollowUrl({
                code: share.code,
                linkKey: share.linkKey,
                displayName
            });
            await copyTextToClipboard(url, {
                successMessage: t(`${I18N}.link_copied`),
                errorMessage: t(`${I18N}.link_copy_failed`)
            });
        } catch (error) {
            fail(error, `${I18N}.link_copy_failed`);
        }
    }

    const passwordTooShort =
        password.length > 0 && password.length < MIN_PASSWORD;

    return (
        <FieldSet className="bg-card/40 rounded-lg border p-3">
            <FieldLegend variant="label">{t(`${I18N}.live_links`)}</FieldLegend>
            <FieldDescription>
                {t(`${I18N}.live_links_description`)}
            </FieldDescription>
            <FieldDescription className="text-destructive">
                {t(`${I18N}.live_links_warning`)}
            </FieldDescription>
            <ul className="flex flex-col gap-2">
                {shares.map((share) => (
                    <li key={share.id} className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate">
                            {share.label || share.code}{' '}
                            <span className="text-muted-foreground text-xs">
                                {share.expired
                                    ? t(`${I18N}.live_expired`)
                                    : share.mode === 'password'
                                      ? t(`${I18N}.live_mode_password`)
                                      : t(`${I18N}.live_mode_public`)}
                            </span>
                        </span>
                        <Switch
                            checked={share.enabled}
                            disabled={share.expired}
                            aria-label={t(`${I18N}.live_enabled`)}
                            onCheckedChange={(checked) => {
                                commands
                                    .appFollowShareSetEnabled(share.id, checked)
                                    .then(reload)
                                    .catch((error: unknown) =>
                                        fail(error, `${I18N}.failed_to_save`)
                                    );
                            }}
                        />
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={share.expired}
                            onClick={() => void copy(share)}
                        >
                            <LinkIcon data-icon="inline-start" />
                            {t(`${I18N}.copy_link`)}
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t(`${I18N}.live_delete`)}
                            onClick={() => {
                                commands
                                    .appFollowShareDelete(share.id)
                                    .then(reload)
                                    .catch((error: unknown) =>
                                        fail(error, `${I18N}.failed_to_save`)
                                    );
                            }}
                        >
                            <Trash2Icon />
                        </Button>
                    </li>
                ))}
            </ul>
            <Field>
                <FieldLabel>{t(`${I18N}.live_label`)}</FieldLabel>
                <Input
                    value={label}
                    maxLength={60}
                    onChange={(event) => setLabel(event.target.value)}
                />
            </Field>
            <Field>
                <FieldLabel>{t(`${I18N}.live_password`)}</FieldLabel>
                <Input
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                />
                <FieldDescription>
                    {passwordTooShort
                        ? t(`${I18N}.live_password_too_short`, {
                              count: MIN_PASSWORD
                          })
                        : t(`${I18N}.live_password_description`)}
                </FieldDescription>
            </Field>
            <Button
                type="button"
                variant="outline"
                disabled={busy || passwordTooShort || shares.length >= 5}
                onClick={() => void create()}
            >
                <PlusIcon data-icon="inline-start" />
                {busy ? t(`${I18N}.live_creating`) : t(`${I18N}.live_create`)}
            </Button>
        </FieldSet>
    );
}
