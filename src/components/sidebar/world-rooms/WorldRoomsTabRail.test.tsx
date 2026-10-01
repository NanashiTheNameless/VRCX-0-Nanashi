// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorldProfileRecord } from '@/domain/entities/world';
import type { FriendRecord } from '@/domain/friends/types';
import { queryClient as appQueryClient } from '@/lib/queryClient';
import { MINUTE_MS } from '@/shared/constants/time';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { onlinePresence } from '@/test/presenceFixtures';

const mocks = vi.hoisted(() => ({
    getWorldProfile: vi.fn()
}));

vi.mock('@/repositories/worldProfileRepository', () => ({
    default: { getWorldProfile: mocks.getWorldProfile }
}));

import { WorldRoomsTabRail } from './WorldRoomsTabRail';

const WORLD_ID = 'wrld_11111111-1111-1111-1111-111111111111';
const COVER_URL = 'https://api.vrchat.cloud/cover.png';

let client: QueryClient;

function world(instances: unknown[]) {
    return {
        id: WORLD_ID,
        capacity: 32,
        thumbnailImageUrl: COVER_URL,
        instances
    } as WorldProfileRecord;
}

function showRail() {
    return render(
        <QueryClientProvider client={client}>
            <WorldRoomsTabRail worldId={WORLD_ID} />
        </QueryClientProvider>
    );
}

beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    client = new QueryClient({
        defaultOptions: appQueryClient.getDefaultOptions()
    });
    useRuntimeStore.setState((state) => ({
        auth: { ...state.auth, currentUserEndpoint: '' },
        gameState: { ...state.gameState, currentLocation: '' }
    }));
    useFriendRosterStore.setState({ friendsById: {} });
});

afterEach(() => {
    cleanup();
    client.clear();
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe('world rooms tab in the sidebar rail', () => {
    it('counts the public rooms and the rooms friends are in', async () => {
        mocks.getWorldProfile.mockResolvedValue(
            world([
                ['11111~region(jp)', 3],
                ['22222~region(us)', 12]
            ])
        );
        useFriendRosterStore.setState({
            friendsById: {
                usr_a: {
                    id: 'usr_a',
                    displayName: 'Alice',
                    $presence: onlinePresence(
                        `${WORLD_ID}:33333~hidden(usr_owner)~region(jp)`
                    )
                } as FriendRecord
            }
        });

        showRail();

        expect(await screen.findByText('3')).toBeTruthy();
    });

    it('uses the world cover as the tab icon', async () => {
        mocks.getWorldProfile.mockResolvedValue(world([]));

        const view = showRail();
        await screen.findByText('0');

        expect(view.container.querySelector('img')?.getAttribute('src')).toBe(
            COVER_URL
        );
    });

    it('shows neither a cover nor a count until the world has loaded', () => {
        mocks.getWorldProfile.mockReturnValue(new Promise(() => {}));

        const view = showRail();

        expect(view.container.querySelector('img')).toBeNull();
        expect(view.container.textContent).toBe('');
    });

    it('keeps the count fresh every five minutes while the sidebar is shown', async () => {
        mocks.getWorldProfile.mockResolvedValue(
            world([['11111~region(jp)', 3]])
        );
        showRail();
        expect(await screen.findByText('1')).toBeTruthy();

        mocks.getWorldProfile.mockResolvedValue(
            world([
                ['11111~region(jp)', 3],
                ['22222~region(us)', 12]
            ])
        );
        await act(() => vi.advanceTimersByTimeAsync(5 * MINUTE_MS));

        expect(screen.getByText('2')).toBeTruthy();
    });
});
