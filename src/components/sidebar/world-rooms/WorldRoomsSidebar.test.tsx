// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorldProfileRecord } from '@/domain/entities/world';
import type { FriendRecord } from '@/domain/friends/types';
import { queryClient as appQueryClient } from '@/lib/queryClient';
import { MINUTE_MS, SECOND_MS } from '@/shared/constants/time';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';

const mocks = vi.hoisted(() => ({
    getWorldProfile: vi.fn(),
    getInstance: vi.fn(),
    openGroupDialog: vi.fn(),
    fetchGroupProfile: vi.fn()
}));

vi.mock('@/repositories/worldProfileRepository', () => ({
    default: { getWorldProfile: mocks.getWorldProfile }
}));
vi.mock('@/repositories/vrchatInstanceRepository', () => ({
    default: { getInstance: mocks.getInstance }
}));
vi.mock('@/components/launch/LaunchModeContextMenuGroup', () => ({
    LaunchModeContextMenuGroup: () => null
}));
vi.mock('@/services/dialogService', () => ({
    openGroupDialog: mocks.openGroupDialog,
    openWorldDialog: vi.fn()
}));
vi.mock('@/repositories/groupProfileRepository', () => ({
    default: { fetchGroupProfile: mocks.fetchGroupProfile }
}));

import type { SidebarWorldRoomsTabLayoutItem } from '@/shared/utils/sidebarTabLayout';

import { WorldRoomsSidebar } from './WorldRoomsSidebar';

const WORLD_ID = 'wrld_11111111-1111-1111-1111-111111111111';
const WORLD_COVER = 'https://api.vrchat.cloud/world-cover.png';
const GROUP_ICON = 'https://api.vrchat.cloud/group-icon.png';
const TAB: SidebarWorldRoomsTabLayoutItem = {
    id: 'world-karaoke',
    type: 'worldRooms',
    worldId: WORLD_ID,
    name: 'Karaoke',
    visible: true
};

let client: QueryClient;

function world(instances: unknown[]) {
    return {
        id: WORLD_ID,
        name: 'Karaoke',
        capacity: 32,
        thumbnailImageUrl: WORLD_COVER,
        instances
    } as WorldProfileRecord;
}

function setFriends(friends: Array<Partial<FriendRecord>>) {
    useFriendRosterStore.setState({
        friendsById: Object.fromEntries(
            friends.map((friend) => [friend.id, friend as FriendRecord])
        )
    });
}

function openTab() {
    return render(
        <QueryClientProvider client={client}>
            <WorldRoomsSidebar tab={TAB} />
        </QueryClientProvider>
    );
}

async function advance(ms: number) {
    await act(() => vi.advanceTimersByTimeAsync(ms));
}

function roomTitles() {
    return screen
        .getAllByText(/^#\d+$/)
        .map((element) => element.textContent?.match(/^#\d+/)?.[0]);
}

beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    client = new QueryClient({
        defaultOptions: appQueryClient.getDefaultOptions()
    });
    mocks.getWorldProfile.mockResolvedValue(
        world([
            ['11111~region(jp)', 3],
            ['22222~region(us)', 12]
        ])
    );
    useRuntimeStore.setState((state) => ({
        auth: {
            ...state.auth,
            currentUserId: 'usr_self',
            currentUserEndpoint: ''
        },
        gameState: { ...state.gameState, currentLocation: '' }
    }));
    setFriends([]);
});

afterEach(() => {
    cleanup();
    client.clear();
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe('world rooms sidebar tab', () => {
    it('lists the world public instances busiest first with their player counts', async () => {
        openTab();

        expect(await screen.findByText('#22222')).toBeTruthy();
        expect(roomTitles()).toEqual(['#22222', '#11111']);
        expect(screen.getByText('12/32')).toBeTruthy();
        expect(screen.getByText('3/32')).toBeTruthy();
        expect(mocks.getWorldProfile).toHaveBeenCalledWith({
            worldId: WORLD_ID,
            dialog: true
        });
    });

    it('refreshes every five minutes while the tab stays open', async () => {
        openTab();
        await screen.findByText('#22222');
        expect(mocks.getWorldProfile).toHaveBeenCalledTimes(1);

        mocks.getWorldProfile.mockResolvedValue(
            world([['33333~region(eu)', 20]])
        );
        await advance(5 * MINUTE_MS);

        expect(mocks.getWorldProfile).toHaveBeenCalledTimes(2);
        expect(roomTitles()).toEqual(['#33333']);
    });

    it('stops refreshing once the tab is closed', async () => {
        const view = openTab();
        await screen.findByText('#22222');

        view.unmount();
        await advance(15 * MINUTE_MS);

        expect(mocks.getWorldProfile).toHaveBeenCalledTimes(1);
    });

    it('shows the last rooms right away when reopened, and only refreshes if they are over a minute old', async () => {
        openTab().unmount();
        await advance(0);

        await advance(30 * SECOND_MS);
        const reopened = openTab();
        expect(roomTitles()).toEqual(['#22222', '#11111']);
        expect(mocks.getWorldProfile).toHaveBeenCalledTimes(1);
        reopened.unmount();

        await advance(31 * SECOND_MS);
        openTab();
        expect(roomTitles()).toEqual(['#22222', '#11111']);
        await advance(0);
        expect(mocks.getWorldProfile).toHaveBeenCalledTimes(2);
    });

    it('keeps the last rooms when a refresh fails and waits for the next refresh instead of retrying', async () => {
        openTab();
        await screen.findByText('#22222');

        mocks.getWorldProfile.mockRejectedValue(new Error('429'));
        await advance(5 * MINUTE_MS);
        await advance(30 * SECOND_MS);

        expect(mocks.getWorldProfile).toHaveBeenCalledTimes(2);
        expect(roomTitles()).toEqual(['#22222', '#11111']);
        expect(
            screen.queryByText('component.world_rooms_sidebar.failed')
        ).toBeNull();
    });

    it('explains when the rooms cannot be loaded at all', async () => {
        mocks.getWorldProfile.mockRejectedValue(new Error('404'));

        openTab();

        expect(
            await screen.findByText('component.world_rooms_sidebar.failed')
        ).toBeTruthy();
    });

    it('explains when the world has no active instances', async () => {
        mocks.getWorldProfile.mockResolvedValue(world([]));

        openTab();

        expect(
            await screen.findByText('component.world_rooms_sidebar.empty')
        ).toBeTruthy();
    });

    it('shows which friends are in a room, collapsing the rest after three', async () => {
        const names = ['Alice', 'Bob', 'Carol', 'Dave'];
        setFriends(
            names.map((name) => ({
                id: `usr_${name}`,
                displayName: name,
                location: `${WORLD_ID}:11111~region(jp)`
            }))
        );

        openTab();
        await screen.findByText('#11111');

        expect(screen.getByLabelText('Alice, Bob, Carol, Dave')).toBeTruthy();
        expect(screen.getByText('+1')).toBeTruthy();
        expect(mocks.getInstance).not.toHaveBeenCalled();
    });

    it('names the group hosting a group room and opens that group when the name is clicked', async () => {
        mocks.fetchGroupProfile.mockResolvedValue({
            id: 'grp_karaoke',
            name: 'Karaoke Club',
            iconUrl: GROUP_ICON
        });
        mocks.getWorldProfile.mockResolvedValue(
            world([
                [
                    '55555~group(grp_karaoke)~groupAccessType(public)~region(jp)',
                    9
                ]
            ])
        );

        openTab();
        fireEvent.click(await screen.findByText('Karaoke Club'));

        expect(mocks.openGroupDialog).toHaveBeenCalledWith({
            groupId: 'grp_karaoke',
            title: 'Karaoke Club'
        });
    });

    it('shows the group icon beside a group room and the world thumbnail beside other rooms', async () => {
        mocks.fetchGroupProfile.mockResolvedValue({
            id: 'grp_karaoke',
            name: 'Karaoke Club',
            iconUrl: GROUP_ICON
        });
        mocks.getWorldProfile.mockResolvedValue(
            world([
                [
                    '55555~group(grp_karaoke)~groupAccessType(public)~region(jp)',
                    9
                ],
                ['11111~region(jp)', 3]
            ])
        );

        const view = openTab();
        await screen.findByText('Karaoke Club');

        const icons = Array.from(view.container.querySelectorAll('img')).map(
            (image) => image.getAttribute('src')
        );
        expect(icons).toEqual([GROUP_ICON, WORLD_COVER]);
    });

    it('lists a non-public room a friend is in and loads its player count', async () => {
        mocks.getInstance.mockResolvedValue({
            json: { n_users: 4, capacity: 16 }
        });
        setFriends([
            {
                id: 'usr_a',
                displayName: 'Alice',
                location: `${WORLD_ID}:33333~hidden(usr_owner)~region(jp)`
            }
        ]);

        openTab();

        expect(await screen.findByText('#33333')).toBeTruthy();
        expect(await screen.findByText('4/16')).toBeTruthy();
        expect(roomTitles()).toEqual(['#22222', '#11111', '#33333']);
        expect(mocks.getInstance).toHaveBeenCalledWith({
            worldId: WORLD_ID,
            instanceId: '33333~hidden(usr_owner)~region(jp)'
        });
    });

    it('does not list a room for a friend who is still traveling', async () => {
        setFriends([
            {
                id: 'usr_a',
                displayName: 'Alice',
                location: 'traveling',
                travelingToLocation: `${WORLD_ID}:44444~hidden(usr_owner)~region(jp)`
            }
        ]);

        openTab();
        await screen.findByText('#22222');

        expect(screen.queryByText('#44444')).toBeNull();
    });
});
