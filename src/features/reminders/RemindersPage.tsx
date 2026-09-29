import { SparklesIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import {
    PageBody,
    PageDescription,
    PageHeader,
    PageScaffold,
    PageTitle
} from '@/components/layout/PageScaffold';
import { commands, type ReminderDraft } from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { Button } from '@/ui/shadcn/button';
import { Textarea } from '@/ui/shadcn/textarea';

import { matchFriendByName } from './matchFriendByName';
import {
    ReminderCreateForm,
    isReminderKind,
    type ReminderFormInitial
} from './ReminderCreateForm';
import { ReminderList, useReminders } from './ReminderList';

const P = 'view.reminders';

/** e.g. `2026-09-29T21:05 (Tuesday, UTC-05:00)`, for resolving "in 20 minutes". */
export function describeLocalNow(now: Date): string {
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16);
    const offsetMinutes = -now.getTimezoneOffset();
    const sign = offsetMinutes < 0 ? '-' : '+';
    const hours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(
        2,
        '0'
    );
    const minutes = String(Math.abs(offsetMinutes) % 60).padStart(2, '0');
    const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
    return `${local} (${weekday}, UTC${sign}${hours}:${minutes})`;
}

function isLocalDateTime(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value);
}

// Fork: the Reminders page - list, create by hand or with AI, delete.
export function RemindersPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const { reminders, setReminders, remove, error } = useReminders();
    const [request, setRequest] = useState('');
    const [drafting, setDrafting] = useState(false);
    const [draftError, setDraftError] = useState('');
    const [notConfigured, setNotConfigured] = useState(false);
    const [formInitial, setFormInitial] = useState<ReminderFormInitial>({});
    const [formKey, setFormKey] = useState(0);

    function applyDraft(draft: ReminderDraft) {
        const friendId = matchFriendByName(
            draft.friendName,
            Object.entries(friendsById).map(([id, friend]) => ({
                id,
                displayName: String(friend?.displayName || id)
            }))
        );
        setFormInitial({
            message: draft.message || request.trim(),
            kind: isReminderKind(draft.kind) ? draft.kind : undefined,
            friendId,
            friendHint:
                draft.friendName && !friendId
                    ? t(`${P}.ai_friend_unmatched`, { name: draft.friendName })
                    : undefined,
            worldId: draft.worldId,
            localTime: isLocalDateTime(draft.atLocal)
                ? draft.atLocal
                : undefined,
            repeatMinutes: draft.repeatMinutes,
            recurring: draft.recurring
        });
        setFormKey((key) => key + 1);
    }

    async function draftWithAi() {
        setDrafting(true);
        setDraftError('');
        setNotConfigured(false);
        try {
            applyDraft(
                await commands.appRemindersAiDraft(
                    request,
                    describeLocalNow(new Date())
                )
            );
            toast.add({ type: 'info', title: t(`${P}.ai_drafted`) });
        } catch (cause) {
            const message =
                cause instanceof Error ? cause.message : String(cause);
            if (/not configured|endpoint was removed/i.test(message)) {
                setNotConfigured(true);
            } else {
                setDraftError(message);
            }
        } finally {
            setDrafting(false);
        }
    }

    return (
        <PageScaffold className="flex-1">
            <PageHeader>
                <PageTitle>{t(`${P}.title`)}</PageTitle>
                <PageDescription>{t(`${P}.description`)}</PageDescription>
            </PageHeader>
            <PageBody>
                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                    <div className="grid gap-6 pb-6 xl:grid-cols-2">
                        <div className="flex flex-col gap-4">
                            <section className="space-y-3 rounded-md border p-3">
                                <div className="space-y-1">
                                    <h2 className="flex items-center gap-2 text-sm font-medium">
                                        <SparklesIcon className="size-4" />
                                        {t(`${P}.ai_title`)}
                                    </h2>
                                    <p className="text-muted-foreground text-xs">
                                        {t(`${P}.ai_description`)}
                                    </p>
                                </div>
                                <Textarea
                                    value={request}
                                    rows={2}
                                    maxLength={500}
                                    aria-label={t(`${P}.ai_title`)}
                                    placeholder={t(`${P}.ai_placeholder`)}
                                    onChange={(event) =>
                                        setRequest(event.target.value)
                                    }
                                    onKeyDown={(event) => {
                                        if (
                                            event.key === 'Enter' &&
                                            (event.ctrlKey || event.metaKey) &&
                                            request.trim() &&
                                            !drafting
                                        ) {
                                            void draftWithAi();
                                        }
                                    }}
                                />
                                {notConfigured ? (
                                    <div className="flex flex-wrap items-center gap-2 text-sm">
                                        <span className="text-muted-foreground">
                                            {t(`${P}.ai_not_configured`)}
                                        </span>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={() =>
                                                navigate('/settings?tab=ai')
                                            }
                                        >
                                            {t(`${P}.ai_open_settings`)}
                                        </Button>
                                    </div>
                                ) : null}
                                {draftError ? (
                                    <p className="text-destructive text-sm">
                                        {draftError}
                                    </p>
                                ) : null}
                                <Button
                                    type="button"
                                    size="sm"
                                    disabled={!request.trim() || drafting}
                                    onClick={() => void draftWithAi()}
                                >
                                    <SparklesIcon data-icon="inline-start" />
                                    {drafting
                                        ? t(`${P}.ai_drafting`)
                                        : t(`${P}.ai_draft`)}
                                </Button>
                            </section>
                            <ReminderCreateForm
                                key={formKey}
                                initial={formInitial}
                                onCreated={setReminders}
                            />
                        </div>
                        <section className="space-y-3">
                            <h2 className="text-sm font-medium">
                                {t(`${P}.list_title`)}
                            </h2>
                            <ReminderList
                                reminders={reminders}
                                error={error}
                                onDelete={(id) => void remove(id)}
                            />
                        </section>
                    </div>
                </div>
            </PageBody>
        </PageScaffold>
    );
}
