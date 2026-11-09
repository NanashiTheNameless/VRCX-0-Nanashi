import type { TFunction } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    answer: vi.fn(async (..._args: unknown[]) => null),
    setBool: vi.fn(async () => undefined),
    profileGet: vi.fn(async () => ({
        status: { recording: false, sync: true },
        bio: { recording: true, sync: false },
        pronouns: { recording: false, sync: true }
    })),
    profileSet: vi.fn(async (..._args: unknown[]) => undefined),
    censusLock: vi.fn(
        async (): Promise<'policy' | 'environment' | 'file' | null> => null
    )
}));

vi.mock('@/platform/tauri/bindings', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    commands: {
        appAssistantAnswerClientRequest: mocks.answer,
        appProfileHistorySettingsGet: mocks.profileGet,
        appProfileHistorySettingsSet: mocks.profileSet,
        appAdoptionCensusLock: mocks.censusLock
    }
}));
vi.mock('@/services/preferencesService', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    setBoolConfigPreference: mocks.setBool
}));

import type { AssistantClientRequestEvent } from '@/domain/assistant/types';
import { useAssistantChatStore } from '@/state/assistantChatStore';
import { usePreferencesStore } from '@/state/preferencesStore';

import {
    completeEditRequest,
    handleAssistantClientRequest,
    useAssistantGuideStore
} from './assistantClientRequests';
import { useAssistantNativeSettings } from './assistantNativeSettings';

const t = ((key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key) as unknown as TFunction;
const SESSION = 'ses_1';
const TURN = 'turn_1';
const HIDE_UNFRIENDS = 'social.friend-log.hide-unfriends';

function event(
    kind: string,
    args: unknown,
    overrides: Partial<AssistantClientRequestEvent> = {}
): AssistantClientRequestEvent {
    return {
        ownerUserId: 'usr_me',
        sessionId: SESSION,
        turnId: TURN,
        toolCallId: 'call_1',
        requestId: `req_${kind}`,
        kind,
        tool: kind === 'approve_edit' ? 'create_reminder' : kind,
        arguments: args,
        ...overrides
    };
}

function editRequests() {
    return (
        useAssistantChatStore
            .getState()
            .messagesBySession[SESSION]?.flatMap(
                (message) => message.editRequests ?? []
            ) ?? []
    );
}

describe('assistant client requests', () => {
    beforeEach(() => {
        mocks.answer.mockClear();
        mocks.setBool.mockClear();
        mocks.profileGet.mockClear();
        mocks.profileSet.mockClear();
        useAssistantNativeSettings.setState({ values: {} });
        mocks.censusLock.mockReset().mockResolvedValue(null);
        useAssistantChatStore.getState().resetAssistantChatState();
        useAssistantChatStore.setState({
            open: true,
            messagesBySession: {
                [SESSION]: [
                    {
                        id: 'm1',
                        role: 'assistant',
                        text: '',
                        turnId: TURN,
                        streaming: true,
                        toolCalls: []
                    }
                ]
            }
        });
        usePreferencesStore.setState({ hideUnfriends: false });
        useAssistantGuideStore.getState().clear();
    });
    afterEach(() => {
        useAssistantChatStore.getState().resetAssistantChatState();
    });

    it('answers a settings lookup at once', async () => {
        await handleAssistantClientRequest(
            event('find_settings', { query: 'unfriends' }),
            t
        );
        const [, requestId, response] = mocks.answer.mock.calls[0] as unknown[];
        expect(requestId).toBe('req_find_settings');
        expect(response).toMatchObject({
            settings: [expect.objectContaining({ settingId: HIDE_UNFRIENDS })]
        });
    });

    it('closes the chat and guides the user to a setting', async () => {
        await handleAssistantClientRequest(
            event('show_in_settings', { settingId: HIDE_UNFRIENDS }),
            t
        );
        expect(useAssistantChatStore.getState().open).toBe(false);
        expect(useAssistantGuideStore.getState().target?.settingId).toBe(
            HIDE_UNFRIENDS
        );
        expect(mocks.answer.mock.calls[0][2]).toMatchObject({ shown: true });
    });

    it('waits for approval before changing a setting', async () => {
        useAssistantChatStore.setState({ open: false });
        await handleAssistantClientRequest(
            event('change_setting', {
                settingId: HIDE_UNFRIENDS,
                value: true,
                reason: 'Less clutter'
            }),
            t
        );
        expect(mocks.answer).not.toHaveBeenCalled();
        expect(mocks.setBool).not.toHaveBeenCalled();
        expect(useAssistantChatStore.getState().open).toBe(true);
        const [request] = editRequests();
        expect(request.status).toBe('pending');

        await completeEditRequest(request, 'approved', t);
        expect(mocks.setBool).toHaveBeenCalledWith('hideUnfriends', true);
        expect(mocks.answer.mock.calls[0][2]).toMatchObject({
            decision: 'approved',
            applied: true,
            oldValue: false,
            newValue: true
        });
        expect(editRequests()[0].status).toBe('applied');
    });

    it('changes nothing when the user declines', async () => {
        await handleAssistantClientRequest(
            event('change_setting', { settingId: HIDE_UNFRIENDS, value: true }),
            t
        );
        await completeEditRequest(editRequests()[0], 'declined', t);
        expect(mocks.setBool).not.toHaveBeenCalled();
        expect(mocks.answer.mock.calls[0][2]).toEqual({ decision: 'declined' });
        expect(editRequests()[0].status).toBe('declined');
    });

    it('allows an ordinary webhook switch only after its in-chat approval', async () => {
        usePreferencesStore.setState({ webhookEnabled: false });
        await handleAssistantClientRequest(
            event('change_setting', {
                settingId: 'notifications.webhook.enabled',
                value: true
            }),
            t
        );
        expect(editRequests()).toHaveLength(1);
        expect(mocks.setBool).not.toHaveBeenCalled();
        await completeEditRequest(editRequests()[0], 'approved', t);
        expect(mocks.setBool).toHaveBeenCalledWith('webhookEnabled', true);
    });

    it('reads native profile switches and preserves other fields after approval', async () => {
        await handleAssistantClientRequest(
            event('change_setting', {
                settingId: 'social.profile-history.status-recording',
                value: true
            }),
            t
        );
        expect(mocks.profileGet).toHaveBeenCalled();
        expect(mocks.profileSet).not.toHaveBeenCalled();
        expect(
            useAssistantNativeSettings.getState().values[
                'social.profile-history.status-recording'
            ]
        ).toBe(false);
        await completeEditRequest(editRequests()[0], 'approved', t);
        expect(mocks.profileSet).toHaveBeenCalledWith({
            status: { recording: true, sync: true },
            bio: { recording: true, sync: false },
            pronouns: { recording: false, sync: true }
        });
    });

    it('fails closed when a native setting cannot be read', async () => {
        mocks.profileGet.mockRejectedValueOnce(new Error('unavailable'));
        await handleAssistantClientRequest(
            event('change_setting', {
                settingId: 'social.profile-history.bio-sync',
                value: true
            }),
            t
        );
        expect(editRequests()).toEqual([]);
        expect(mocks.profileSet).not.toHaveBeenCalled();
        expect(mocks.answer.mock.calls[0][2]).toHaveProperty('error');
    });

    it('refuses locked settings without showing a card', async () => {
        await handleAssistantClientRequest(
            event('change_setting', {
                settingId: 'integrations.translation.api-key',
                value: true
            }),
            t
        );
        expect(mocks.answer.mock.calls[0][2]).toHaveProperty('error');
        expect(
            String((mocks.answer.mock.calls[0][2] as { error: string }).error)
        ).toContain('Connections, credentials, pairing');
        expect(editRequests()).toEqual([]);
    });

    it('shows a real census approval card and saves only after Allow', async () => {
        usePreferencesStore.setState({ adoptionCensusEnabled: true });
        await handleAssistantClientRequest(
            event('change_setting', {
                settingId: 'advanced.adoption-census.enabled',
                value: false,
                reason: 'Stop the anonymous adoption count'
            }),
            t
        );
        const [request] = editRequests();
        expect(request).toBeDefined();
        expect(mocks.setBool).not.toHaveBeenCalled();
        await completeEditRequest(request, 'approved', t);
        expect(mocks.setBool).toHaveBeenCalledWith(
            'adoptionCensusEnabled',
            false
        );
    });

    it.each(['policy', 'environment', 'file'] as const)(
        'explains the %s census opt-out and does not offer a card',
        async (lock) => {
            mocks.censusLock.mockResolvedValue(lock);
            await handleAssistantClientRequest(
                event('change_setting', {
                    settingId: 'advanced.adoption-census.enabled',
                    value: true
                }),
                t
            );
            expect(editRequests()).toEqual([]);
            expect(mocks.setBool).not.toHaveBeenCalled();
            expect(mocks.answer.mock.calls[0][2]).toMatchObject({
                error: expect.stringContaining('forced off')
            });
        }
    );

    it('rechecks policy before applying an approved census change', async () => {
        await handleAssistantClientRequest(
            event('change_setting', {
                settingId: 'advanced.adoption-census.enabled',
                value: true
            }),
            t
        );
        const [request] = editRequests();
        mocks.censusLock.mockResolvedValue('policy');
        await completeEditRequest(request, 'approved', t);
        expect(mocks.setBool).not.toHaveBeenCalled();
        expect(mocks.answer.mock.calls.at(-1)?.[2]).toMatchObject({
            error: expect.stringContaining('Windows policy')
        });
    });

    it('shows other edits as approval cards and passes the decision on', async () => {
        await handleAssistantClientRequest(
            event('approve_edit', { text: 'Alice is online' }),
            t
        );
        const [request] = editRequests();
        expect(request).toMatchObject({
            status: 'pending',
            tool: 'create_reminder'
        });
        await completeEditRequest(request, 'approved', t);
        expect(mocks.answer.mock.calls[0][2]).toEqual({
            decision: 'approved'
        });
        expect(editRequests()[0].status).toBe('approved');
    });
});
