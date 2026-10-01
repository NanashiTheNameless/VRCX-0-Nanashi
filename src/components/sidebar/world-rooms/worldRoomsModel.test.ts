import { describe, expect, it } from 'vitest';

import type { WorldProfileRecord } from '@/domain/entities/world';
import type { PresenceView } from '@/domain/friends/presence';
import type { FriendRecord } from '@/domain/friends/types';
import {
    offlinePresence,
    onlinePresence,
    pendingPresence,
    travelingPresence
} from '@/test/presenceFixtures';

import { buildWorldRoomRows, filterWorldRoomRows } from './worldRoomsModel';

const WORLD_ID = 'wrld_11111111-1111-1111-1111-111111111111';
const OTHER_WORLD_ID = 'wrld_22222222-2222-2222-2222-222222222222';

function friend(
    id: string,
    place: string | PresenceView,
    extra: Record<string, unknown> = {}
) {
    const $presence = typeof place === 'string' ? onlinePresence(place) : place;
    return { id, displayName: id, $presence, ...extra } as FriendRecord;
}

function world(instances: unknown[]) {
    return { id: WORLD_ID, instances } as WorldProfileRecord;
}

function rooms({
    publicInstances = [],
    friends = [],
    currentLocation = ''
}: {
    publicInstances?: unknown[];
    friends?: FriendRecord[];
    currentLocation?: string;
}) {
    return buildWorldRoomRows({
        worldId: WORLD_ID,
        world: world(publicInstances),
        friends,
        currentLocation
    });
}

describe('world room list', () => {
    it('lists the public instances the world reports, busiest first', () => {
        const rows = rooms({
            publicInstances: [
                ['11111~region(jp)', 3],
                ['22222~region(us)', 12],
                ['33333~region(eu)', 7]
            ]
        });

        expect(rows.map((row) => [row.location, row.occupants])).toEqual([
            [`${WORLD_ID}:22222~region(us)`, 12],
            [`${WORLD_ID}:33333~region(eu)`, 7],
            [`${WORLD_ID}:11111~region(jp)`, 3]
        ]);
    });

    it('marks friends on the public instance they are in instead of adding another room', () => {
        const rows = rooms({
            publicInstances: [['11111~region(jp)', 5]],
            friends: [
                friend('usr_a', `${WORLD_ID}:11111~region(jp)`),
                friend('usr_b', `${WORLD_ID}:11111~region(jp)&shortName=abcdef`)
            ]
        });

        expect(rows).toHaveLength(1);
        expect(rows[0].occupants).toBe(5);
        expect(rows[0].friends.map((entry) => entry.id)).toEqual([
            'usr_a',
            'usr_b'
        ]);
    });

    it('adds the non-public instances friends are in, after the rooms with known player counts', () => {
        const friendsPlus = `${WORLD_ID}:33333~hidden(usr_owner)~region(jp)`;
        const invite = `${WORLD_ID}:44444~private(usr_owner)~canRequestInvite~region(us)`;
        const rows = rooms({
            publicInstances: [
                ['11111~region(jp)', 1],
                ['00000~region(jp)', 0]
            ],
            friends: [
                friend('usr_a', friendsPlus),
                friend('usr_b', friendsPlus),
                friend('usr_c', invite)
            ]
        });

        expect(
            rows.map((row) => [row.location, row.occupants, row.friends.length])
        ).toEqual([
            [`${WORLD_ID}:11111~region(jp)`, 1, 0],
            [`${WORLD_ID}:00000~region(jp)`, 0, 0],
            [friendsPlus, null, 2],
            [invite, null, 1]
        ]);
    });

    it('shows a traveling friend only after they land in the instance', () => {
        const destination = `${WORLD_ID}:55555~hidden(usr_owner)~region(jp)`;
        const traveling = friend('usr_a', travelingPresence(destination));

        expect(rooms({ friends: [traveling] })).toEqual([]);
        expect(
            rooms({ friends: [friend('usr_a', destination)] }).map(
                (row) => row.location
            )
        ).toEqual([destination]);
    });

    it('ignores friends who are private, offline, possibly offline, or in another world', () => {
        expect(
            rooms({
                friends: [
                    friend('usr_private', 'private'),
                    friend('usr_offline', offlinePresence),
                    friend(
                        'usr_pending',
                        pendingPresence(`${WORLD_ID}:11111~region(jp)`)
                    ),
                    friend('usr_other', `${OTHER_WORLD_ID}:44444~region(eu)`)
                ]
            })
        ).toEqual([]);
    });

    it('includes and marks the instance the current user is in', () => {
        const current = `${WORLD_ID}:66666~private(usr_self)~region(eu)`;

        expect(rooms({ currentLocation: current })).toEqual([
            {
                location: current,
                occupants: null,
                friends: [],
                isCurrent: true
            }
        ]);
    });

    it('still lists friends before the world has loaded', () => {
        const location = `${WORLD_ID}:11111~region(jp)`;
        const rows = buildWorldRoomRows({
            worldId: WORLD_ID,
            world: null,
            friends: [friend('usr_a', location)],
            currentLocation: ''
        });

        expect(rows.map((row) => row.location)).toEqual([location]);
    });
});

describe('world room filter', () => {
    const rows = rooms({
        publicInstances: [
            ['11111~region(jp)', 3],
            ['22222~region(us)', 2]
        ],
        friends: [
            friend('usr_a', `${WORLD_ID}:22222~region(us)`, {
                displayName: 'Alice'
            })
        ]
    });

    it('matches the instance number', () => {
        expect(
            filterWorldRoomRows(rows, '111').map((row) => row.location)
        ).toEqual([`${WORLD_ID}:11111~region(jp)`]);
    });

    it('matches the name of a friend in the room', () => {
        expect(
            filterWorldRoomRows(rows, 'alice').map((row) => row.location)
        ).toEqual([`${WORLD_ID}:22222~region(us)`]);
    });

    it('keeps every room when the filter is empty', () => {
        expect(filterWorldRoomRows(rows, '')).toEqual(rows);
    });
});
