import type { TFunction } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    answer: vi.fn(async (..._args: unknown[]) => null),
    setBool: vi.fn(async () => undefined)
}));

vi.mock('@/platform/tauri/bindings', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    commands: { appAssistantAnswerClientRequest: mocks.answer }
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

    it('refuses locked or unknown settings without showing a card', async () => {
        await handleAssistantClientRequest(
            event('change_setting', {
                settingId: 'integrations.translation.enabled',
                value: true
            }),
            t
        );
        expect(mocks.answer.mock.calls[0][2]).toHaveProperty('error');
        expect(editRequests()).toEqual([]);
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
