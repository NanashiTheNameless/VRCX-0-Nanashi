// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { offlinePresence, onlinePresence } from '@/test/presenceFixtures';

type FriendRosterStoreState = {
    friendsById: Record<string, Record<string, unknown>>;
};
type FriendLocationTimeStoreState = {
    byUserId: Record<string, { location: string; sinceMs: number | null }>;
};
type RuntimeStoreState = {
    auth: { currentUserEndpoint: string };
};
type PreferencesStoreState = {
    trustColor: boolean;
};
type ProbeProps = {
    userId: string;
    seed?: Record<string, unknown> | null;
};

const storeMocks = vi.hoisted(() => ({
    friendRosterState: {
        friendsById: {}
    } as FriendRosterStoreState,
    friendLocationTimeState: {
        byUserId: {}
    } as FriendLocationTimeStoreState
}));

const repositoryMocks = vi.hoisted(() => ({ getUserProfile: vi.fn() }));

vi.mock('@/repositories/userProfileRepository', () => ({
    default: { getUserProfile: repositoryMocks.getUserProfile }
}));
vi.mock('@/repositories/memoPersistenceRepository', () => ({
    default: { getUserMemo: () => Promise.resolve({ memo: '' }) }
}));
vi.mock('@/repositories/worldProfileRepository', () => ({
    default: { getWorldProfile: () => Promise.resolve(null) }
}));
vi.mock('@/repositories/vrchatInstanceRepository', () => ({
    default: { getInstance: () => Promise.resolve({ json: {} }) }
}));

vi.mock('@tanstack/react-query', () => ({
    QueryClient: class QueryClient {
        constructor() {}
    },
    useQuery: () => ({ data: null })
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: Object.assign(
        <T,>(selector: (state: RuntimeStoreState) => T): T =>
            selector({
                auth: { currentUserEndpoint: 'https://api.vrchat.cloud' }
            }),
        {
            getState: () => ({
                auth: { currentUserEndpoint: 'https://api.vrchat.cloud' }
            })
        }
    )
}));

vi.mock('@/state/preferencesStore', () => ({
    usePreferencesStore: <T,>(
        selector: (state: PreferencesStoreState) => T
    ): T => selector({ trustColor: false })
}));

vi.mock('@/state/friendRosterStore', () => ({
    useFriendRosterStore: Object.assign(
        <T,>(selector: (state: FriendRosterStoreState) => T): T =>
            selector(storeMocks.friendRosterState),
        {
            getState: () => storeMocks.friendRosterState,
            subscribe: () => () => {}
        }
    )
}));

vi.mock('@/state/friendLocationTimeStore', () => ({
    useFriendLocationTimeStore: <T,>(
        selector: (state: FriendLocationTimeStoreState) => T
    ): T => selector(storeMocks.friendLocationTimeState)
}));

import { useUserHoverCardData } from './useUserHoverCardData';

function Probe({ userId, seed = null }: ProbeProps) {
    const { instanceEpoch, model } = useUserHoverCardData({ userId, seed });
    return (
        <div
            data-variant={model.variant}
            data-status-dot={model.statusDotClassName}
            data-instance-epoch={instanceEpoch}
            data-effective-location={model.location.effectiveLocation}
        />
    );
}

describe('useUserHoverCardData', () => {
    afterEach(() => {
        cleanup();
        repositoryMocks.getUserProfile.mockReset();
    });

    beforeEach(() => {
        repositoryMocks.getUserProfile.mockResolvedValue(null);
        storeMocks.friendLocationTimeState = { byUserId: {} };
        storeMocks.friendRosterState = {
            friendsById: {
                usr_friend: {
                    id: 'usr_friend',
                    displayName: 'Alice',
                    state: 'offline',
                    stateBucket: 'offline',
                    location: 'offline',
                    $presence: offlinePresence
                }
            }
        };
    });

    it('queries hovered users with the friend cache class only when they are on the roster', async () => {
        render(
            <Probe
                userId="usr_stranger"
                seed={{ id: 'usr_stranger', displayName: 'Stranger' }}
            />
        );
        render(<Probe userId="usr_friend" />);

        await waitFor(() =>
            expect(repositoryMocks.getUserProfile).toHaveBeenCalledTimes(2)
        );
        expect(repositoryMocks.getUserProfile).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'usr_stranger', isFriend: false })
        );
        expect(repositoryMocks.getUserProfile).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'usr_friend', isFriend: true })
        );
    });

    it('falls back to the friend roster seed when only userId is supplied', () => {
        const html = renderToStaticMarkup(<Probe userId="usr_friend" />);

        expect(html).toContain('data-variant="offline"');
        expect(html).toContain(
            'data-status-dot="user-status-indicator offline bg-[var(--status-offline)]"'
        );
    });

    it('reads an online matching friend time directly from the shared snapshot', () => {
        storeMocks.friendRosterState = {
            friendsById: {
                usr_friend: {
                    id: 'usr_friend',
                    displayName: 'Alice',
                    state: 'online',
                    stateBucket: 'online',
                    location: 'wrld_test:1',
                    $presence: onlinePresence('wrld_test:1')
                }
            }
        };
        storeMocks.friendLocationTimeState = {
            byUserId: {
                usr_friend: {
                    location: 'wrld_test:1',
                    sinceMs: 1_700_000_000_000
                }
            }
        };

        const html = renderToStaticMarkup(<Probe userId="usr_friend" />);

        expect(html).toContain('data-instance-epoch="1700000000000"');
    });
});
