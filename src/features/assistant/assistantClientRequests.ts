import type { TFunction } from 'i18next';
import { create } from 'zustand';

import type {
    AssistantClientRequestEvent,
    UIEditRequest
} from '@/domain/assistant/types';
import { getDocSource, headingSlug } from '@/features/docs/docsCatalog';
import { commands, type JsonValue } from '@/platform/tauri/bindings';
import {
    getSettingDeepLinkPath,
    type SettingsManifestEntry
} from '@/shared/constants/settingsManifest';
import { getSettingsManifestEntry } from '@/shared/constants/settingsManifest';
import { useAssistantChatStore } from '@/state/assistantChatStore';

import { loadAssistantNativeSettings } from './assistantNativeSettings';
import {
    applySettingChange,
    describeAssistantSetting,
    findAssistantSettings,
    previewSettingChange,
    resolveSettingsTarget,
    runtimeSettingBlock,
    settingLocation
} from './assistantSettings';

export type AssistantGuideTarget = {
    /** App route to open. */
    path: string;
    label: string;
    location: string;
    /** Kept highlighted while the guide is open, for settings. */
    settingId?: string;
};

type AssistantGuideState = {
    target: AssistantGuideTarget | null;
    show: (target: AssistantGuideTarget) => void;
    clear: () => void;
};

/** What the assistant is pointing at in Settings, shown while its chat is closed. */
export const useAssistantGuideStore = create<AssistantGuideState>((set) => ({
    target: null,
    show: (target) => set({ target }),
    clear: () => set({ target: null })
}));

export type EditDecision = 'approved' | 'declined';

async function answer(
    sessionId: string,
    requestId: string,
    response: Record<string, unknown> | null
): Promise<void> {
    await commands.appAssistantAnswerClientRequest(
        sessionId,
        requestId,
        response as JsonValue | null
    );
}

export function showSettingInGuide(
    entry: SettingsManifestEntry,
    t: TFunction
): AssistantGuideTarget {
    const target = {
        path: getSettingDeepLinkPath(entry.id),
        settingId: entry.id,
        label: t(entry.labelKey),
        location: settingLocation(entry, t)
    };
    useAssistantChatStore.getState().setOpen(false);
    useAssistantGuideStore.getState().show(target);
    return target;
}

/** Opens the Docs page at a doc and section, with the guide card. */
export function showDocInGuide(
    docId: string,
    section: string,
    t: TFunction
): AssistantGuideTarget | null {
    const doc = getDocSource(docId);
    if (!doc) {
        return null;
    }
    const heading = section.split(' > ').at(-1)?.trim() ?? '';
    const params = new URLSearchParams({ doc: doc.id });
    if (heading) {
        params.set('section', headingSlug(heading));
    }
    const target = {
        path: `/docs?${params.toString()}`,
        label: heading || doc.title,
        location: [t('view.docs.title'), doc.title].join(' > ')
    };
    useAssistantChatStore.getState().setOpen(false);
    useAssistantGuideStore.getState().show(target);
    return target;
}

function recordString(args: unknown, key: string): string {
    const value =
        args && typeof args === 'object'
            ? (args as Record<string, unknown>)[key]
            : undefined;
    return typeof value === 'string' ? value : '';
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error ?? '');
}

/**
 * Answers a request from the assistant. Lookups and showing a setting answer
 * at once; edits become approval cards in the conversation and are answered
 * when the user decides.
 */
export async function handleAssistantClientRequest(
    event: AssistantClientRequestEvent,
    t: TFunction
): Promise<void> {
    const store = useAssistantChatStore.getState();
    switch (event.kind) {
        case 'find_settings': {
            const result = findAssistantSettings(
                recordString(event.arguments, 'query'),
                t
            );
            for (const setting of 'settings' in result ? result.settings : []) {
                if (!setting.canRequestChange) continue;
                try {
                    await loadAssistantNativeSettings([setting.settingId]);
                    const entry = getSettingsManifestEntry(setting.settingId);
                    if (entry)
                        Object.assign(
                            setting,
                            describeAssistantSetting(entry, t)
                        );
                } catch {
                    setting.canRequestChange = false;
                    setting.changeBlockedReason =
                        'The app could not read this setting. Try again before requesting a change.';
                    setting.note = setting.changeBlockedReason;
                    setting.currentValue = null;
                    continue;
                }
                const block = await runtimeSettingBlock(setting.settingId);
                if (block) {
                    setting.canRequestChange = false;
                    setting.changeBlockedReason = block.reason;
                    setting.note = block.reason;
                    if (block.forcedOff) setting.currentValue = false;
                }
            }
            await answer(event.sessionId, event.requestId, result);
            return;
        }
        case 'read_docs': {
            // The docs are large; load them the first time they are read.
            const { answerReadDocs } = await import('./assistantDocs');
            await answer(
                event.sessionId,
                event.requestId,
                answerReadDocs(event.arguments)
            );
            return;
        }
        case 'show_in_docs': {
            const target = showDocInGuide(
                recordString(event.arguments, 'docId'),
                recordString(event.arguments, 'section'),
                t
            );
            await answer(
                event.sessionId,
                event.requestId,
                target
                    ? {
                          shown: true,
                          label: target.label,
                          location: target.location,
                          note: 'The chat closed so the user can read the doc; they return with the button on the guide.'
                      }
                    : { error: 'Unknown docId. List the docs with read_docs.' }
            );
            return;
        }
        case 'show_in_settings': {
            const entry = resolveSettingsTarget(event.arguments);
            if (!entry) {
                await answer(event.sessionId, event.requestId, {
                    error: 'Unknown settingId or cardId. Look it up with find_settings.'
                });
                return;
            }
            const target = showSettingInGuide(entry, t);
            await answer(event.sessionId, event.requestId, {
                shown: true,
                label: target.label,
                location: target.location,
                note: 'The chat closed so the user can see Settings; they return with the button on the guide.'
            });
            return;
        }
        case 'change_setting': {
            try {
                await loadAssistantNativeSettings([
                    recordString(event.arguments, 'settingId')
                ]);
            } catch {
                await answer(event.sessionId, event.requestId, {
                    error: 'The app could not read the current setting. No change was requested.'
                });
                return;
            }
            const preview = previewSettingChange(event.arguments, t);
            if (!preview.ok) {
                await answer(event.sessionId, event.requestId, {
                    error: preview.error
                });
                return;
            }
            const block = await runtimeSettingBlock(preview.info.settingId);
            if (block) {
                await answer(event.sessionId, event.requestId, {
                    error: block.reason
                });
                return;
            }
            store.applyEditRequest(event);
            store.setOpen(true);
            return;
        }
        case 'approve_edit':
            store.applyEditRequest(event);
            store.setOpen(true);
            return;
        default:
            await answer(event.sessionId, event.requestId, {
                error: `Unknown request ${event.kind}.`
            });
    }
}

/** Carries out the user's decision on an approval card and answers it. */
export async function completeEditRequest(
    request: UIEditRequest,
    decision: EditDecision,
    t: TFunction
): Promise<void> {
    const store = useAssistantChatStore.getState();
    if (decision === 'declined') {
        store.resolveEditRequest(request.sessionId, request.id, 'declined');
        await answer(request.sessionId, request.id, { decision });
        return;
    }
    if (request.kind !== 'change_setting') {
        store.resolveEditRequest(request.sessionId, request.id, 'approved');
        await answer(request.sessionId, request.id, { decision });
        return;
    }
    let readError = '';
    try {
        await loadAssistantNativeSettings([
            recordString(request.arguments, 'settingId')
        ]);
    } catch {
        readError =
            'The app could not recheck the current setting. No change was applied.';
    }
    const preview = readError
        ? { ok: false as const, error: readError }
        : previewSettingChange(request.arguments, t);
    if (!preview.ok) {
        store.resolveEditRequest(
            request.sessionId,
            request.id,
            'failed',
            preview.error
        );
        await answer(request.sessionId, request.id, {
            decision,
            error: preview.error
        });
        return;
    }
    try {
        await applySettingChange(
            preview.info.settingId,
            preview.newValue.value
        );
    } catch (error) {
        const message = errorText(error);
        store.resolveEditRequest(
            request.sessionId,
            request.id,
            'failed',
            message
        );
        await answer(request.sessionId, request.id, {
            decision,
            error: message
        });
        return;
    }
    store.resolveEditRequest(
        request.sessionId,
        request.id,
        'applied',
        t('assistant.edit.applied', {
            label: preview.info.label,
            old: preview.oldValue.label,
            new: preview.newValue.label
        })
    );
    await answer(request.sessionId, request.id, {
        decision,
        applied: true,
        settingId: preview.info.settingId,
        oldValue: preview.oldValue.value,
        newValue: preview.newValue.value
    });
}
