import { ArrowRightIcon, CheckIcon, MapPinIcon, XIcon } from 'lucide-react';
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
            className={`rounded px-2 py-0.5 text-xs font-semibold ${next ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
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
            className="bg-card flex flex-col gap-3 rounded-xl border border-amber-500/60 p-4"
            aria-label={t(
                isSetting
                    ? 'assistant.edit.title_setting'
                    : 'assistant.edit.title_action'
            )}
        >
            <h3 className="text-sm font-semibold">
                {t(
                    isSetting
                        ? 'assistant.edit.title_setting'
                        : 'assistant.edit.title_action'
                )}
            </h3>
            {isSetting && preview ? (
                preview.ok ? (
                    <dl className="flex flex-col gap-2">
                        <Row label={t('assistant.edit.setting')}>
                            <span className="font-medium">
                                {preview.info.label}
                            </span>
                        </Row>
                        {preview.info.description ? (
                            <Row label={t('assistant.edit.meaning')}>
                                {preview.info.description}
                            </Row>
                        ) : null}
                        {preview.reason ? (
                            <Row label={t('assistant.edit.why')}>
                                {preview.reason}
                            </Row>
                        ) : null}
                        <Row label={t('assistant.edit.where')}>
                            <span className="inline-flex flex-wrap items-center gap-2">
                                {preview.info.location}
                                <Button
                                    type="button"
                                    variant="link"
                                    size="sm"
                                    className="h-auto p-0"
                                    onClick={() => {
                                        const entry = getSettingsManifestEntry(
                                            preview.info.settingId
                                        );
                                        if (entry) {
                                            showSettingInGuide(entry, t);
                                        }
                                    }}
                                >
                                    <MapPinIcon />
                                    {t('assistant.edit.show_me')}
                                </Button>
                            </span>
                        </Row>
                        <Row
                            label={`${t('assistant.edit.current')} / ${t('assistant.edit.new')}`}
                        >
                            <span className="inline-flex items-center gap-2">
                                <ValuePill
                                    next={false}
                                    label={preview.oldValue.label}
                                />
                                <ArrowRightIcon className="size-4" />
                                <ValuePill
                                    next
                                    label={preview.newValue.label}
                                />
                            </span>
                        </Row>
                        {preview.info.blocked ? (
                            <p className="text-xs text-amber-600 dark:text-amber-400">
                                {t('assistant.edit.blocked')}
                            </p>
                        ) : null}
                    </dl>
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
            <div className="flex flex-wrap items-center gap-2">
                <Button
                    type="button"
                    size="sm"
                    disabled={busy || (isSetting && !preview?.ok)}
                    onClick={() => void decide('approved')}
                >
                    <CheckIcon />
                    {t('assistant.edit.approve')}
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void decide('declined')}
                >
                    <XIcon />
                    {t('assistant.edit.decline')}
                </Button>
            </div>
        </section>
    );
}
