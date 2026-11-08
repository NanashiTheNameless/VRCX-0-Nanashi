// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    complete: vi.fn(async () => undefined),
    show: vi.fn()
}));

vi.mock('../assistantClientRequests', () => ({
    completeEditRequest: mocks.complete,
    showSettingInGuide: mocks.show
}));

import type { UIEditRequest } from '@/domain/assistant/types';
import { usePreferencesStore } from '@/state/preferencesStore';

import { AssistantEditRequestCard } from './AssistantEditRequestCard';

const HIDE_UNFRIENDS = 'social.friend-log.hide-unfriends';

function request(overrides: Partial<UIEditRequest> = {}): UIEditRequest {
    return {
        id: 'req_1',
        sessionId: 'ses_1',
        kind: 'change_setting',
        tool: 'change_setting',
        arguments: {
            settingId: HIDE_UNFRIENDS,
            value: true,
            reason: 'Keeps the friend log short'
        },
        status: 'pending',
        ...overrides
    };
}

describe('AssistantEditRequestCard', () => {
    beforeEach(() => {
        usePreferencesStore.setState({ hideUnfriends: false });
        mocks.complete.mockClear();
        mocks.show.mockClear();
    });
    afterEach(cleanup);

    it('shows what changes, why, where, and the old and new values', () => {
        render(<AssistantEditRequestCard request={request()} active />);
        expect(
            screen.getByText(
                'view.settings.appearance.friend_log.hide_unfriends'
            )
        ).toBeTruthy();
        expect(screen.getByText('Keeps the friend log short')).toBeTruthy();
        expect(
            screen.getByText(
                'nav_tooltip.settings > view.settings.category.social > view.settings.appearance.friend_log.header',
                { exact: false }
            )
        ).toBeTruthy();
        expect(screen.getByText('assistant.edit.off')).toBeTruthy();
        expect(screen.getByText('assistant.edit.on')).toBeTruthy();

        fireEvent.click(
            screen.getByRole('button', { name: 'assistant.edit.show_me' })
        );
        expect(mocks.show).toHaveBeenCalled();
    });

    it.each([
        ['assistant.edit.approve', 'approved'],
        ['assistant.edit.decline', 'declined']
    ])('passes %s on once and locks the card', (button, decision) => {
        render(<AssistantEditRequestCard request={request()} active />);
        fireEvent.click(screen.getByRole('button', { name: button }));
        fireEvent.click(
            screen.getByRole('button', { name: 'assistant.edit.decline' })
        );
        expect(mocks.complete).toHaveBeenCalledTimes(1);
        expect((mocks.complete.mock.calls[0] as unknown[])[1]).toBe(decision);
    });

    it('cannot approve a change that is not allowed', () => {
        render(
            <AssistantEditRequestCard
                request={request({
                    arguments: {
                        settingId: 'integrations.translation.enabled',
                        value: true
                    }
                })}
                active
            />
        );
        expect(
            (
                screen.getByRole('button', {
                    name: 'assistant.edit.approve'
                }) as HTMLButtonElement
            ).disabled
        ).toBe(true);
        expect(screen.getByRole('alert')).toBeTruthy();
    });

    it('lists the details of other edits', () => {
        render(
            <AssistantEditRequestCard
                request={request({
                    kind: 'approve_edit',
                    tool: 'send_chatbox_message',
                    arguments: { text: 'brb' }
                })}
                active
            />
        );
        expect(
            screen.getByText('assistant.edit.actions.send_chatbox_message')
        ).toBeTruthy();
        expect(screen.getByText('brb')).toBeTruthy();
    });

    it('collapses to a status line once decided', () => {
        render(
            <AssistantEditRequestCard
                request={request({ status: 'declined' })}
                active
            />
        );
        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.getByRole('status').textContent).toContain(
            'assistant.edit.declined'
        );
    });
});
