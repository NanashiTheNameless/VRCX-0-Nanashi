import { describe, expect, it } from 'vitest';

import { offlinePresence, onlinePresence } from '@/test/presenceFixtures';

import {
    buildSameInstanceFriendGroups,
    resolveObservedPlayerUserId,
    resolveObservedPlayerUserIds,
    resolveSameInstanceFriendLocation
} from './sameInstanceFriends';

describe('sameInstanceFriends', () => {
    const currentLocation = 'wrld_current:123';
    const otherLocation = 'wrld_other:456';

    it('groups a locally observed friend independently of remote presence and releases it on leave', () => {
        const friend = {
            id: 'usr_friend',
            $presence: offlinePresence
        };
        const locationTimes = {
            usr_friend: {
                location: currentLocation,
                sinceMs: 1_000,
                source: 'gameLog' as const
            }
        };

        expect(
            buildSameInstanceFriendGroups(
                [friend],
                { location: currentLocation },
                {
                    includeCurrentUser: true,
                    locationTimes
                }
            )
        ).toEqual([
            {
                location: currentLocation,
                friends: [friend],
                isCurrentInstance: true
            }
        ]);
        expect(
            buildSameInstanceFriendGroups(
                [friend],
                { location: currentLocation },
                {
                    includeCurrentUser: true,
                    locationTimes: {
                        usr_friend: {
                            ...locationTimes.usr_friend,
                            source: 'realtime'
                        }
                    }
                }
            )
        ).toEqual([]);
    });

    it('does not restore a departed local friend from an older UI player list', () => {
        const friend = {
            id: 'usr_friend',
            $presence: onlinePresence('private')
        };
        expect(
            buildSameInstanceFriendGroups(
                [friend],
                {
                    location: currentLocation,
                    friendList: new Set(['usr_friend'])
                },
                {
                    includeCurrentUser: true,
                    locationTimes: {
                        usr_friend: { location: 'private', source: 'realtime' }
                    }
                }
            )
        ).toEqual([]);
    });

    it('keeps the original two-friend threshold outside the current instance', () => {
        const first = {
            id: 'usr_1',
            $presence: onlinePresence(otherLocation)
        };
        const second = {
            id: 'usr_2',
            $presence: onlinePresence(otherLocation)
        };
        const solo = {
            id: 'usr_3',
            $presence: onlinePresence('wrld_solo:789')
        };

        expect(
            buildSameInstanceFriendGroups([first, solo, second], {
                location: currentLocation
            })
        ).toEqual([
            {
                location: otherLocation,
                friends: [first, second],
                isCurrentInstance: false
            }
        ]);
    });

    it('keeps one friend when the current user is included in that instance', () => {
        const friend = {
            id: 'usr_friend',
            $presence: onlinePresence(currentLocation)
        };

        expect(
            buildSameInstanceFriendGroups(
                [friend],
                {
                    location: currentLocation
                },
                {
                    includeCurrentUser: true
                }
            )
        ).toEqual([
            {
                location: currentLocation,
                friends: [friend],
                isCurrentInstance: true
            }
        ]);
    });

    it('uses the observed current roster for an online friend with a hidden location', () => {
        const friend = {
            id: 'usr_hidden',
            $presence: onlinePresence('private')
        };
        const lastLocation = {
            location: currentLocation,
            friendList: new Set(['usr_hidden'])
        };

        expect(resolveSameInstanceFriendLocation(friend, lastLocation)).toBe(
            currentLocation
        );
        expect(
            buildSameInstanceFriendGroups([friend], lastLocation, {
                includeCurrentUser: true
            })
        ).toEqual([
            {
                location: currentLocation,
                friends: [friend],
                isCurrentInstance: true
            }
        ]);
    });

    it('does not reveal a hidden friend who is absent from the observed roster', () => {
        expect(
            resolveSameInstanceFriendLocation(
                {
                    id: 'usr_hidden',
                    $presence: onlinePresence('private')
                },
                {
                    location: currentLocation,
                    friendList: new Set(['usr_other'])
                }
            )
        ).toBe('');
    });

    it('keeps an explicit instance instead of overriding it from the observed roster', () => {
        expect(
            resolveSameInstanceFriendLocation(
                {
                    id: 'usr_visible',
                    $presence: onlinePresence(otherLocation)
                },
                {
                    location: currentLocation,
                    friendList: new Set(['usr_visible'])
                }
            )
        ).toBe(otherLocation);
    });

    it('does not promote an offline friend from the observed roster into the group', () => {
        const friend = {
            id: 'usr_offline',
            $presence: offlinePresence
        };

        expect(
            buildSameInstanceFriendGroups([friend], {
                location: currentLocation,
                friendList: new Set(['usr_offline'])
            })
        ).toEqual([]);
    });

    it('requires two friends in the current instance when the current user is hidden', () => {
        const friend = {
            id: 'usr_friend',
            $presence: onlinePresence(currentLocation)
        };

        expect(
            buildSameInstanceFriendGroups([friend], {
                location: currentLocation
            })
        ).toEqual([]);
    });

    it('resolves a name-only observed player from the friend roster like original VRCX', () => {
        const friendsById = {
            usr_friend: {
                id: 'usr_friend',
                displayName: 'Exact Friend'
            }
        };

        expect(
            resolveObservedPlayerUserId(
                { userId: '', displayName: 'Exact Friend' },
                friendsById
            )
        ).toBe('usr_friend');
        expect(
            resolveObservedPlayerUserId(
                { userId: '', displayName: 'exact friend' },
                friendsById
            )
        ).toBe('');
        expect(
            resolveObservedPlayerUserIds(
                ['usr_known', 'display:Name Only'],
                [{ userId: '', displayName: 'Exact Friend' }],
                friendsById
            )
        ).toEqual(['usr_known', 'usr_friend']);
    });
});
