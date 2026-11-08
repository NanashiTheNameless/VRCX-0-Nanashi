// @vitest-environment jsdom
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/platform/tauri/bindings', () => ({
    commands: { appProfileHistoryQuery: api.query }
}));
vi.mock('../../EntityDialogScaffold', () => ({
    EntityDialogTabContent: ({ children }: { children: React.ReactNode }) => (
        <div>{children}</div>
    )
}));

import { UserDialogProfileHistoryTab } from './UserDialogProfileHistoryTab';

const T = 'dialog.user.profile_history';

describe('UserDialogProfileHistoryTab', () => {
    afterEach(() => {
        cleanup();
        vi.resetAllMocks();
    });

    it('shows before and after values and filters each field', async () => {
        api.query.mockResolvedValue([
            {
                id: 1,
                field: 'bio',
                property: 'bio',
                createdAt: 1791633600,
                previousValue: 'An old bio',
                value: 'A new bio'
            }
        ]);
        render(
            <UserDialogProfileHistoryTab
                active
                userId="usr_friend"
                currentUserId="usr_self"
            />
        );
        expect(await screen.findByText('An old bio')).toBeTruthy();
        expect(screen.getByText('A new bio')).toBeTruthy();
        api.query.mockResolvedValue([]);
        fireEvent.change(screen.getByRole('combobox'), {
            target: { value: 'pronouns' }
        });
        await waitFor(() =>
            expect(api.query).toHaveBeenLastCalledWith({
                userId: 'usr_friend',
                field: 'pronouns',
                beforeAt: null,
                beforeId: null,
                beforeField: null
            })
        );
        expect(await screen.findByText(`${T}.empty`)).toBeTruthy();
    });

    it('shows a captured snapshot once without inventing a previous value', async () => {
        api.query.mockResolvedValue([
            {
                id: 1,
                field: 'bio',
                property: 'bio',
                createdAt: 1791633600,
                previousValue: 'A captured bio',
                value: 'A captured bio'
            }
        ]);
        render(
            <UserDialogProfileHistoryTab
                active
                userId="usr_friend"
                currentUserId="usr_self"
            />
        );
        expect(await screen.findByText(`${T}.snapshot`)).toBeTruthy();
        expect(screen.getAllByText('A captured bio')).toHaveLength(1);
        expect(screen.queryByText(`${T}.before`)).toBeNull();
        expect(screen.queryByText(`${T}.after`)).toBeNull();
    });

    it('pages with the full cursor even when dates are identical', async () => {
        const page = Array.from({ length: 200 }, (_, i) => ({
            id: 200 - i,
            field: 'bio',
            property: 'bio',
            createdAt: 1791633600,
            previousValue: `Before ${i}`,
            value: `After ${i}`
        }));
        api.query.mockResolvedValueOnce(page).mockResolvedValueOnce([
            {
                id: 9,
                field: 'pronouns',
                property: 'pronouns',
                createdAt: 1791633600,
                previousValue: 'they/them',
                value: 'she/her'
            }
        ]);
        render(
            <UserDialogProfileHistoryTab
                active
                userId="usr_friend"
                currentUserId="usr_self"
            />
        );
        fireEvent.click(
            await screen.findByRole('button', { name: `${T}.more` })
        );
        expect(await screen.findByText('she/her')).toBeTruthy();
        expect(api.query).toHaveBeenLastCalledWith({
            userId: 'usr_friend',
            field: null,
            beforeAt: 1791633600,
            beforeId: 1,
            beforeField: 'bio'
        });
    });

    it('makes no query for an inactive tab or signed-out account', () => {
        const view = render(
            <UserDialogProfileHistoryTab
                active={false}
                userId="usr_friend"
                currentUserId="usr_self"
            />
        );
        view.rerender(
            <UserDialogProfileHistoryTab
                active
                userId="usr_friend"
                currentUserId={null}
            />
        );
        expect(api.query).not.toHaveBeenCalled();
    });
});
