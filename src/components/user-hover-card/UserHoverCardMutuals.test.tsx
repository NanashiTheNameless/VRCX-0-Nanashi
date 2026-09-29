// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getAllMutualFriends: vi.fn() }));

vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({
        t: (key: string, values?: Record<string, unknown>) =>
            key === 'user_hover_card.name_separator'
                ? ', '
                : values
                  ? `${key}:${JSON.stringify(values)}`
                  : key
    })
}));
vi.mock('@/repositories/userProfileRepository', () => ({
    default: { getAllMutualFriends: mocks.getAllMutualFriends }
}));

import { clearEntityQueryCache } from '@/lib/entityQueryCache';
import { queryClient } from '@/lib/queryClient';

import { UserHoverCardMutuals } from './UserHoverCardMutuals';

function renderMutuals() {
    return render(
        <QueryClientProvider client={queryClient}>
            <UserHoverCardMutuals userId="usr_stranger" />
        </QueryClientProvider>
    );
}

afterEach(async () => {
    cleanup();
    await clearEntityQueryCache();
    mocks.getAllMutualFriends.mockReset();
});

describe('UserHoverCardMutuals', () => {
    it('looks up the hovered player and lists the first shared friends', async () => {
        mocks.getAllMutualFriends.mockResolvedValue({
            rows: [
                { id: 'usr_a', displayName: 'Alice' },
                { id: 'usr_b', displayName: 'Bob' },
                { id: 'usr_c', displayName: 'Cleo' },
                { id: 'usr_d', displayName: 'Dan' },
                {
                    id: 'usr_00000000-0000-0000-0000-000000000000',
                    displayName: ''
                }
            ],
            persisted: false
        });
        renderMutuals();

        await waitFor(() =>
            expect(
                screen.getByText('user_hover_card.mutual_friends:{"count":5}')
            ).toBeTruthy()
        );
        expect(screen.getByText('Alice, Bob, Cleo')).toBeTruthy();
        expect(mocks.getAllMutualFriends).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'usr_stranger' })
        );
    });

    it('says so when there are no shared friends', async () => {
        mocks.getAllMutualFriends.mockResolvedValue({
            rows: [],
            persisted: false
        });
        renderMutuals();

        await waitFor(() =>
            expect(
                screen.getByText('user_hover_card.no_mutual_friends')
            ).toBeTruthy()
        );
    });

    it('explains when the player hides their mutual friends', async () => {
        mocks.getAllMutualFriends.mockRejectedValue(new Error('403'));
        renderMutuals();

        await waitFor(() =>
            expect(
                screen.getByText(
                    'view.charts.mutual_friend.label.mutuals_unavailable'
                )
            ).toBeTruthy()
        );
    });
});
