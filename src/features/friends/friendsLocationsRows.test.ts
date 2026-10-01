import { describe, expect, it } from 'vitest';

import {
    offlinePresence,
    onlinePresence,
    travelingPresence
} from '@/test/presenceFixtures';

import {
    isFriendInPrivateLocation,
    normalizeDisplayText,
    partitionFriendsByPrivateLocation,
    resolveDisplayWorldName,
    resolveFriendGroupName,
    resolveLocationSummary,
    friendLocationTarget,
    resolveWorldDialogTarget,
    uniqueFriendsById
} from './friendsLocationsRows';
import { matchesFriendLocationSearch } from './friendsLocationsSearch';

describe('friends locations row helpers', () => {
    it('normalizes display text from location-like objects', () => {
        expect(
            normalizeDisplayText({ $location: { worldName: 'World Name' } })
        ).toBe('World Name');
    });

    it('prefers readable world and group names over raw ids', () => {
        expect(resolveDisplayWorldName('wrld_123', 'Club Orion')).toBe(
            'Club Orion'
        );
        expect(
            resolveFriendGroupName({
                group: {
                    displayName: 'Group Display'
                }
            })
        ).toBe('Group Display');
    });

    it('deduplicates friends by id while keeping anonymous rows', () => {
        const first = { id: 'usr_1', displayName: 'First' };
        const duplicate = { id: 'usr_1', displayName: 'Duplicate' };
        const anonymous = { displayName: 'Anonymous' };

        expect(uniqueFriendsById([first, duplicate, anonymous])).toEqual([
            first,
            anonymous
        ]);
    });

    it('matches search text against friend and location summary fields', () => {
        const favoriteIds = new Set(['usr_1']);
        const friend = {
            id: 'usr_1',
            displayName: 'Maple',
            username: 'maple_user',
            statusDescription: 'At the club',
            $presence: offlinePresence
        };

        expect(matchesFriendLocationSearch(friend, 'maple', favoriteIds)).toBe(
            true
        );
        expect(
            matchesFriendLocationSearch(friend, 'favorite', favoriteIds)
        ).toBe(true);
        expect(
            matchesFriendLocationSearch(friend, 'missing', favoriteIds)
        ).toBe(false);
    });

    it('resolves offline/private/traveling summaries and world dialog targets', () => {
        expect(resolveLocationSummary({ $presence: offlinePresence })).toEqual({
            label: 'Offline',
            meta: ''
        });
        expect(
            resolveLocationSummary({ $presence: onlinePresence('private') })
        ).toEqual({
            label: 'Private',
            meta: ''
        });
        const publicSummary = resolveLocationSummary({
            $presence: onlinePresence('wrld_123:Room~group(grp_1)'),
            worldName: 'Club Orion',
            groupName: 'Orion Group'
        });
        expect(publicSummary.label).toBe('Club Orion');
        expect(publicSummary.meta).toContain('Room');
        expect(resolveWorldDialogTarget({ rawLocation: 'wrld_123:456' })).toBe(
            'wrld_123:456'
        );

        const travelingWithDestination = resolveLocationSummary({
            $presence: travelingPresence('wrld_456:789~region(use)'),
            worldName: 'New World'
        });
        expect(travelingWithDestination).toEqual({
            label: 'New World',
            meta: '789'
        });

        const travelingWithoutDestination = resolveLocationSummary({
            $presence: travelingPresence()
        });
        expect(travelingWithoutDestination).toEqual({
            label: 'Traveling',
            meta: 'traveling'
        });

        const travelingTarget = friendLocationTarget({
            $presence: travelingPresence('wrld_456:789')
        });
        expect(travelingTarget.isTraveling).toBe(false);
        expect(travelingTarget.rawLocation).toBe('wrld_456:789');
        expect(travelingTarget.worldId).toBe('wrld_456');
        const unknownDestination = friendLocationTarget({
            $presence: travelingPresence()
        });
        expect(unknownDestination.isTraveling).toBe(true);
        expect(unknownDestination.worldId).toBe('');
    });

    it('separates private locations from visible or unknown locations', () => {
        expect(
            isFriendInPrivateLocation({ $presence: onlinePresence('private') })
        ).toBe(true);
        expect(
            isFriendInPrivateLocation({ $presence: onlinePresence('') })
        ).toBe(false);
        expect(
            isFriendInPrivateLocation({
                $presence: onlinePresence('wrld_123:456')
            })
        ).toBe(false);
        expect(
            isFriendInPrivateLocation(
                { $presence: onlinePresence('private') },
                'wrld_seen:1'
            )
        ).toBe(false);

        const visible = {
            id: 'usr_visible',
            $presence: onlinePresence('wrld_123:456')
        };
        const privateFriend = {
            id: 'usr_private',
            $presence: onlinePresence('private')
        };
        const seenFriend = {
            id: 'usr_seen',
            $presence: onlinePresence('private')
        };
        expect(
            partitionFriendsByPrivateLocation(
                [privateFriend, visible, seenFriend],
                (friendId) => (friendId === 'usr_seen' ? 'wrld_seen:1' : '')
            )
        ).toEqual({
            visibleLocation: [visible, seenFriend],
            privateLocation: [privateFriend]
        });
    });
});
