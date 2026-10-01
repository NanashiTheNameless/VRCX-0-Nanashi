import { describe, expect, it } from 'vitest';

import type { PresenceView } from '@/domain/friends/presence';
import type { FriendRecord } from '@/domain/friends/types';
import {
    offlinePresence,
    onlinePresence,
    travelingPresence
} from '@/test/presenceFixtures';

import { buildFriendWorldGroups } from './friendsLocationsWorlds';

function friend(
    id: string,
    place: string | PresenceView,
    extra: Partial<FriendRecord> = {}
): FriendRecord {
    return {
        id,
        displayName: id,
        tags: [],
        $presence: typeof place === 'string' ? onlinePresence(place) : place,
        $friendNumber: 0,
        $trustLevel: '',
        $trustClass: '',
        $trustSortNum: 0,
        $isModerator: false,
        $isTroll: false,
        $isProbableTroll: false,
        $platform: '',
        ...extra
    };
}

describe('buildFriendWorldGroups', () => {
    it('groups friends by world, then by instance, and drops hidden locations', () => {
        const groups = buildFriendWorldGroups(
            [
                friend('a', 'wrld_hot:1~region(jp)'),
                friend('b', 'wrld_hot:2~region(us)'),
                friend('c', 'wrld_hot:1~region(jp)'),
                friend('d', 'wrld_quiet:9'),
                friend('e', 'private'),
                friend('f', offlinePresence),
                friend('g', '')
            ],
            '',
            () => ''
        );

        expect(
            groups.map((group) => ({
                worldId: group.worldId,
                friendCount: group.friendCount,
                instances: group.instances.map((instance) => ({
                    location: instance.location,
                    friends: instance.friends.map((entry) => entry.id)
                }))
            }))
        ).toEqual([
            {
                worldId: 'wrld_hot',
                friendCount: 3,
                instances: [
                    {
                        location: 'wrld_hot:1~region(jp)',
                        friends: ['a', 'c']
                    },
                    { location: 'wrld_hot:2~region(us)', friends: ['b'] }
                ]
            },
            {
                worldId: 'wrld_quiet',
                friendCount: 1,
                instances: [{ location: 'wrld_quiet:9', friends: ['d'] }]
            }
        ]);
    });

    it('puts the current instance and its world first', () => {
        const groups = buildFriendWorldGroups(
            [
                friend('a', 'wrld_hot:1'),
                friend('b', 'wrld_hot:1'),
                friend('c', 'wrld_here:5'),
                friend('d', 'wrld_here:6')
            ],
            'wrld_here:6',
            () => ''
        );

        expect(groups.map((group) => group.worldId)).toEqual([
            'wrld_here',
            'wrld_hot'
        ]);
        expect(
            groups[0].instances.map((instance) => [
                instance.location,
                instance.isCurrent
            ])
        ).toEqual([
            ['wrld_here:6', true],
            ['wrld_here:5', false]
        ]);
    });

    it('folds traveling friends into their destination instance and keeps the first world name hint', () => {
        const groups = buildFriendWorldGroups(
            [
                friend('a', travelingPresence('wrld_dest:3'), {
                    worldName: ''
                }),
                friend('b', 'wrld_dest:3', { worldName: 'Destination' })
            ],
            '',
            () => ''
        );

        expect(groups).toHaveLength(1);
        expect(groups[0].nameHint).toBe('Destination');
        expect(groups[0].instances[0].friends.map((entry) => entry.id)).toEqual(
            ['a', 'b']
        );
    });

    it('places a private friend seen in the local game into that instance', () => {
        const groups = buildFriendWorldGroups(
            [friend('a', 'wrld_here:5'), friend('b', 'private')],
            '',
            (friendId) => (friendId === 'b' ? 'wrld_here:5' : '')
        );

        expect(groups).toHaveLength(1);
        expect(groups[0].instances[0].friends.map((entry) => entry.id)).toEqual(
            ['a', 'b']
        );
    });
});
