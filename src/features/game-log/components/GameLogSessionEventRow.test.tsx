// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import type { ComponentProps, PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, values?: { count?: number }) =>
            key === 'view.game_log.sessions.friends_count'
                ? `${values?.count ?? 0} friends`
                : key
    })
}));

vi.mock('@/components/affinity/AffinityBadge', () => ({
    AffinityBadge: ({
        isFavorite,
        isFriend
    }: {
        isFavorite?: boolean;
        isFriend?: boolean;
    }) => (
        <span
            data-affinity={isFavorite ? 'favorite' : isFriend ? 'friend' : ''}
        />
    )
}));

vi.mock('@/lib/dateTime', () => ({
    formatDateFilter: (value: string) => value,
    timeToText: (value: number) => `duration:${String(value)}`
}));

vi.mock('@/services/clipboardService', () => ({
    copyTextToClipboard: vi.fn()
}));

vi.mock('@/services/entityMediaService', () => ({
    openExternalLink: vi.fn()
}));

vi.mock('@/services/gameLogUserDialogService', () => ({
    openGameLogUser: vi.fn()
}));

vi.mock('@/ui/shadcn/button', () => ({
    Button: ({
        children,
        size: _size,
        variant: _variant,
        ...props
    }: ComponentProps<'button'> & { size?: string; variant?: string }) => (
        <button {...props}>{children}</button>
    )
}));

import { GameLogSessionAffinityContext } from '../gameLogSessionAffinity';
import type { GameLogSessionEvent } from '../gameLogTypes';
import { SessionEventGroups } from './GameLogSessionEventRow';

const emptyAffinity = {
    favoriteIdSet: new Set<string>(),
    friendIdSet: new Set<string>()
};

function EmptyAffinityProvider({ children }: PropsWithChildren) {
    return (
        <GameLogSessionAffinityContext value={emptyAffinity}>
            {children}
        </GameLogSessionAffinityContext>
    );
}

describe('SessionEventGroups player durations', () => {
    afterEach(cleanup);

    it('shows cumulative room time only on leave events', () => {
        render(
            <SessionEventGroups
                durationByKey={new Map([['id:usr_alice', 60_000]])}
                events={[
                    {
                        type: 'OnPlayerJoined',
                        created_at: 1786528800,
                        displayName: 'Alice',
                        userId: 'usr_alice'
                    },
                    {
                        type: 'OnPlayerLeft',
                        created_at: 1786528860,
                        displayName: 'Alice',
                        userId: 'usr_alice'
                    },
                    {
                        type: 'JoinGroup',
                        created_at: 1786528920,
                        members: [
                            {
                                created_at: 1786528920,
                                displayName: 'Alice',
                                userId: 'usr_alice',
                                isFavorite: false
                            }
                        ]
                    },
                    {
                        type: 'LeftGroup',
                        created_at: 1786528980,
                        members: [
                            {
                                created_at: 1786528980,
                                displayName: 'Alice',
                                userId: 'usr_alice',
                                isFavorite: false
                            }
                        ]
                    }
                ]}
            />,
            { wrapper: EmptyAffinityProvider }
        );

        expect(screen.getAllByText('duration:60000')).toHaveLength(1);
        for (const trigger of screen.getAllByRole('button', {
            expanded: false
        })) {
            fireEvent.click(trigger);
        }
        expect(screen.getAllByText('duration:60000')).toHaveLength(2);

        const joinedRow = screen.getByText('1786528800').closest('div');
        const leftRow = screen.getByText('1786528860').closest('div');
        const joinedGroupMember = screen
            .getAllByText('1786528920')[1]
            .closest('div');
        const leftGroupMember = screen
            .getAllByText('1786528980')[1]
            .closest('div');

        expect(joinedRow?.textContent).not.toContain('duration:60000');
        expect(leftRow?.textContent).toContain('duration:60000');
        expect(joinedGroupMember?.textContent).not.toContain('duration:60000');
        expect(leftGroupMember?.textContent).toContain('duration:60000');
    });

    it('keeps the affinity marker immediately before the player name', () => {
        const view = render(
            <GameLogSessionAffinityContext
                value={{
                    friendIdSet: new Set(['usr_alice']),
                    favoriteIdSet: new Set()
                }}
            >
                <SessionEventGroups
                    durationByKey={new Map()}
                    events={[
                        {
                            type: 'OnPlayerJoined',
                            created_at: 1786528800,
                            displayName: 'Alice',
                            userId: 'usr_alice'
                        }
                    ]}
                />
            </GameLogSessionAffinityContext>
        );

        const marker = view.container.querySelector('[data-affinity="friend"]');
        expect(marker?.nextElementSibling?.textContent).toContain('Alice');
    });

    it('defers member normalization until expanded and releases rows when collapsed', async () => {
        const readCreatedAt = vi.fn(() => 1786406401);
        const events: GameLogSessionEvent[] = [
            {
                type: 'LeftGroup',
                created_at: 1786406400,
                count: 99,
                members: [
                    {
                        userId: ' usr_alice ',
                        displayName: 'Alice',
                        get created_at() {
                            return readCreatedAt();
                        },
                        isFavorite: false
                    }
                ]
            }
        ];
        const content = (
            <SessionEventGroups
                events={events}
                durationByKey={new Map([['id:usr_alice', 60_000]])}
            />
        );
        const view = render(
            <GameLogSessionAffinityContext
                value={{
                    friendIdSet: new Set(['usr_alice']),
                    favoriteIdSet: new Set()
                }}
            >
                {content}
            </GameLogSessionAffinityContext>
        );
        const trigger = screen.getByRole('button', { expanded: false });
        expect(trigger.textContent).toContain('1· 1 friends');
        expect(trigger.textContent).not.toContain('99');
        expect(screen.queryByText('Alice')).toBeNull();
        expect(readCreatedAt).not.toHaveBeenCalled();

        fireEvent.click(trigger);
        expect(screen.getByText('Alice')).not.toBeNull();
        expect(screen.getByText('1786406401')).not.toBeNull();
        expect(screen.getByText('duration:60000')).not.toBeNull();
        expect(
            view.container.querySelector('[data-affinity="friend"]')
        ).not.toBeNull();

        view.rerender(
            <GameLogSessionAffinityContext
                value={{
                    friendIdSet: new Set(),
                    favoriteIdSet: new Set(['usr_alice'])
                }}
            >
                {content}
            </GameLogSessionAffinityContext>
        );
        expect(screen.queryByText('· 1 friends')).toBeNull();
        expect(
            view.container.querySelector('[data-affinity="favorite"]')
        ).not.toBeNull();

        fireEvent.click(trigger);
        await waitFor(() => expect(screen.queryByText('Alice')).toBeNull());
        readCreatedAt.mockClear();
        view.rerender(
            <GameLogSessionAffinityContext
                value={{
                    friendIdSet: new Set(['usr_alice']),
                    favoriteIdSet: new Set()
                }}
            >
                {content}
            </GameLogSessionAffinityContext>
        );
        expect(readCreatedAt).not.toHaveBeenCalled();
        expect(screen.getByText('· 1 friends')).not.toBeNull();
        fireEvent.click(trigger);
        expect(
            view.container.querySelector('[data-affinity="friend"]')
        ).not.toBeNull();
    });

    it('keeps fallback players and member timestamps while leaving count-only groups empty', () => {
        render(
            <SessionEventGroups
                events={[
                    {
                        type: 'JoinGroup',
                        created_at: 1786406402,
                        displayName: 'Fallback',
                        isFavorite: false
                    },
                    {
                        type: 'LeftGroup',
                        created_at: 1786406403,
                        members: [
                            {
                                userId: '',
                                displayName: 'Member',
                                created_at: 0,
                                isFavorite: false
                            }
                        ]
                    },
                    { type: 'JoinGroup', created_at: 1786406404, count: 3 }
                ]}
            />,
            { wrapper: EmptyAffinityProvider }
        );
        for (const trigger of screen.getAllByRole('button', {
            expanded: false
        })) {
            fireEvent.click(trigger);
        }
        expect(
            screen
                .getByText('Fallback')
                .closest('button')
                ?.parentElement?.previousElementSibling?.getAttribute(
                    'data-affinity'
                )
        ).toBe('');
        expect(
            screen
                .getByText('Member')
                .closest('button')
                ?.parentElement?.previousElementSibling?.getAttribute(
                    'data-affinity'
                )
        ).toBe('');
        expect(screen.getAllByText('1786406403')).toHaveLength(2);
        expect(
            screen.getByText('1786406404').closest('button')?.textContent
        ).toContain('3');
        expect(screen.getAllByText('1786406404')).toHaveLength(1);
    });

    it('fails explicitly when player rows are mounted without an affinity provider', () => {
        expect(() =>
            render(
                <SessionEventGroups
                    events={[
                        {
                            type: 'OnPlayerJoined',
                            created_at: 0,
                            userId: 'usr_alice',
                            displayName: 'Alice'
                        }
                    ]}
                />
            )
        ).toThrow('GameLog session affinity requires a provider.');
    });
});
