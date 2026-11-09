import {
    CheckIcon,
    InfoIcon,
    MapPinIcon,
    ShieldCheckIcon,
    XIcon
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { UIEditRequest } from '@/domain/assistant/types';
import { getSettingsManifestEntry } from '@/shared/constants/settingsManifest';
import { usePreferencesStore } from '@/state/preferencesStore';
import { Button } from '@/ui/shadcn/button';

import {
    completeEditRequest,
    showSettingInGuide,
    type EditDecision
} from '../assistantClientRequests';
import { useAssistantNativeSettings } from '../assistantNativeSettings';
import { previewSettingChange } from '../assistantSettings';

function formatValue(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'string') {
        return value;
    }
    return JSON.stringify(value);
}

function Row({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="grid gap-0.5 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3">
            <dt className="text-muted-foreground text-xs font-medium">
                {label}
            </dt>
            <dd className="min-w-0 text-sm break-words">{children}</dd>
        </div>
    );
}

function ValuePill({ next, label }: { next: boolean; label: string }) {
    return (
        <span
            className={`inline-block max-w-full rounded px-2 py-0.5 text-sm font-medium break-words ${next ? 'bg-primary/10 text-primary' : 'bg-background text-foreground'}`}
        >
            {label}
        </span>
    );
}

export function AssistantEditRequestCard({
    request,
    active
}: {
    request: UIEditRequest;
    active: boolean;
}) {
    const { t } = useTranslation();
    const [busy, setBusy] = useState(false);
    // Read so the card shows the live value if it changes while waiting.
    usePreferencesStore((state) => state);
    useAssistantNativeSettings((state) => state.values);
    const isSetting = request.kind === 'change_setting';
    const preview = isSetting
        ? previewSettingChange(request.arguments, t)
        : null;

    if (request.status !== 'pending' || !active) {
        const text =
            request.status === 'applied' || request.status === 'failed'
                ? (request.detail ?? '')
                : request.status === 'declined' || request.status === 'pending'
                  ? t('assistant.edit.declined')
                  : t('assistant.edit.approved');
        return (
            <p
                className={`text-xs ${request.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}
                role="status"
            >
                {request.status === 'failed'
                    ? t('assistant.edit.failed', { error: text })
                    : `${isSetting && preview?.ok ? `${preview.info.label}: ` : ''}${text}`}
            </p>
        );
    }

    async function decide(decision: EditDecision) {
        setBusy(true);
        try {
            await completeEditRequest(request, decision, t);
        } catch (error) {
            console.warn('[assistant] failed to answer an edit request', error);
        } finally {
            setBusy(false);
        }
    }

    const args =
        request.arguments && typeof request.arguments === 'object'
            ? Object.entries(request.arguments as Record<string, unknown>)
            : [];

    return (
        <section
            className="bg-card text-card-foreground flex min-w-0 flex-col gap-4 rounded-xl border p-4 sm:p-5"
            aria-label={t(
                isSetting
                    ? 'assistant.edit.permission_required'
                    : 'assistant.edit.title_action'
            )}
        >
            <header className="flex items-start gap-3">
                <span className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg">
                    <ShieldCheckIcon className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 space-y-1">
                    <h3 className="text-base font-semibold">
                        {t(
                            isSetting
                                ? 'assistant.edit.permission_required'
                                : 'assistant.edit.title_action'
                        )}
                    </h3>
                    {isSetting ? (
                        <p className="text-muted-foreground text-sm">
                            {t('assistant.edit.setting_request_description')}
                        </p>
                    ) : null}
                </div>
            </header>
            {isSetting && preview ? (
                preview.ok ? (
                    <>
                        <dl className="bg-muted/50 flex flex-col gap-3 rounded-lg p-3">
                            <Row label={t('assistant.edit.setting')}>
                                <span className="font-medium">
                                    {preview.info.label}
                                </span>
                            </Row>
                            <Row label={t('assistant.edit.current')}>
                                <ValuePill
                                    next={false}
                                    label={preview.oldValue.label}
                                />
                            </Row>
                            <Row label={t('assistant.edit.new')}>
                                <ValuePill
                                    next
                                    label={preview.newValue.label}
                                />
                            </Row>
                            <Row label={t('assistant.edit.where')}>
                                {preview.info.location}
                            </Row>
                        </dl>
                        <div className="space-y-2">
                            <h4 className="text-sm font-semibold">
                                {t('assistant.edit.change_effect')}
                            </h4>
                            {preview.info.description ? (
                                <p className="text-sm">
                                    {preview.info.description}
                                </p>
                            ) : null}
                            {preview.reason ? (
                                <p className="text-muted-foreground text-sm">
                                    {preview.reason}
                                </p>
                            ) : null}
                            {preview.info.blocked ? (
                                <p className="text-xs text-amber-600 dark:text-amber-400">
                                    {t('assistant.edit.blocked')}
                                </p>
                            ) : null}
                        </div>
                    </>
                ) : (
                    <p className="text-destructive text-sm" role="alert">
                        {t('assistant.edit.invalid', { error: preview.error })}
                    </p>
                )
            ) : (
                <>
                    <p className="text-sm font-medium">
                        {t(`assistant.edit.actions.${request.tool}`, {
                            defaultValue: request.tool
                        })}
                    </p>
                    <p className="text-muted-foreground text-xs">
                        {t('assistant.edit.action_description')}
                    </p>
                    {args.length ? (
                        <dl className="flex flex-col gap-1">
                            {args.map(([key, value]) => (
                                <Row key={key} label={key}>
                                    {formatValue(value)}
                                </Row>
                            ))}
                        </dl>
                    ) : null}
                </>
            )}
            {isSetting && preview?.ok ? (
                <p className="text-sm font-medium">
                    {t('assistant.edit.allow_question')}
                </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
                <Button
                    type="button"
                    className="flex-1 sm:flex-none"
                    disabled={busy || (isSetting && !preview?.ok)}
                    onClick={() => void decide('approved')}
                >
                    <CheckIcon />
                    {t(
                        isSetting
                            ? 'assistant.edit.allow'
                            : 'assistant.edit.approve'
                    )}
                </Button>
                <Button
                    type="button"
                    className="flex-1 sm:flex-none"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void decide('declined')}
                >
                    <XIcon />
                    {t(
                        isSetting
                            ? 'assistant.edit.deny'
                            : 'assistant.edit.decline'
                    )}
                </Button>
                {isSetting && preview?.ok ? (
                    <Button
                        type="button"
                        variant="outline"
                        className="w-full sm:w-auto"
                        disabled={busy}
                        onClick={() => {
                            const entry = getSettingsManifestEntry(
                                preview.info.settingId
                            );
                            if (entry) showSettingInGuide(entry, t);
                        }}
                    >
                        <MapPinIcon />
                        {t('assistant.edit.show_me')}
                    </Button>
                ) : null}
            </div>
            {isSetting ? (
                <p className="text-muted-foreground flex items-start gap-2 text-xs">
                    <InfoIcon
                        className="size-3.5 shrink-0"
                        aria-hidden="true"
                    />
                    {t('assistant.edit.permission_notice')}
                </p>
            ) : null}
        </section>
    );
}
