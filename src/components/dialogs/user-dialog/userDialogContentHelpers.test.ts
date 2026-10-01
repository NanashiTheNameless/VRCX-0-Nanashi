import { describe, expect, it } from 'vitest';

import { offlinePresence, onlinePresence } from '@/test/presenceFixtures';

import { resolveUserDialogTargetPresenceLocation } from './userDialogContentHelpers';

describe('resolveUserDialogTargetPresenceLocation', () => {
    it('does not keep a stale instance for an explicitly offline friend', () => {
        expect(
            resolveUserDialogTargetPresenceLocation({
                profile: {
                    id: 'usr_target',
                    $presence: offlinePresence
                },
                targetUserId: 'usr_target',
                localLocation: '',
                currentLocation: 'wrld_old:123',
                currentLocationPlayerIds: ['usr_target'],
                currentLocationPlayers: [],
                friendsById: {
                    usr_target: {
                        id: 'usr_target',
                        $presence: offlinePresence
                    }
                }
            })
        ).toBe('offline');
    });
    const currentLocation = 'wrld_current:123';

    it('uses the current instance for a private user observed in its player list', () => {
        expect(
            resolveUserDialogTargetPresenceLocation({
                profile: {
                    id: 'usr_target',
                    $presence: onlinePresence('private')
                },
                targetUserId: 'usr_target',
                localLocation: '',
                currentLocation,
                currentLocationPlayerIds: ['usr_self', 'usr_target']
            })
        ).toBe(currentLocation);
    });

    it('uses the current instance for an offline non-friend observed in its player list', () => {
        expect(
            resolveUserDialogTargetPresenceLocation({
                profile: { id: 'usr_target', $presence: offlinePresence },
                targetUserId: 'usr_target',
                localLocation: '',
                currentLocation,
                currentLocationPlayerIds: ['usr_target']
            })
        ).toBe(currentLocation);
    });

    it('keeps a hidden location when the user is not in the current player list', () => {
        expect(
            resolveUserDialogTargetPresenceLocation({
                profile: {
                    id: 'usr_target',
                    $presence: onlinePresence('private')
                },
                targetUserId: 'usr_target',
                localLocation: '',
                currentLocation,
                currentLocationPlayerIds: ['usr_other']
            })
        ).toBe('private');
    });

    it('promotes a name-only GameLog player after resolving it from the friend roster', () => {
        expect(
            resolveUserDialogTargetPresenceLocation({
                profile: {
                    id: 'usr_friend',
                    displayName: 'Hidden Friend',
                    $presence: onlinePresence('private')
                },
                targetUserId: 'usr_friend',
                localLocation: '',
                currentLocation,
                currentLocationPlayerIds: [],
                currentLocationPlayers: [
                    {
                        id: 'Hidden Friend',
                        userId: '',
                        displayName: 'Hidden Friend',
                        joinedAt: '',
                        joinedAtMs: 0
                    }
                ],
                friendsById: {
                    usr_friend: {
                        id: 'usr_friend',
                        displayName: 'Hidden Friend'
                    }
                }
            })
        ).toBe(currentLocation);
    });

    it('uses the local game room over any presence for a friend in my instance', () => {
        expect(
            resolveUserDialogTargetPresenceLocation({
                profile: { id: 'usr_target', $presence: offlinePresence },
                targetUserId: 'usr_target',
                localLocation: currentLocation,
                currentLocation,
                currentLocationPlayerIds: []
            })
        ).toBe(currentLocation);
    });

    it('keeps a visible presence location instead of overriding it', () => {
        const visibleLocation = 'wrld_visible:456';

        expect(
            resolveUserDialogTargetPresenceLocation({
                profile: {
                    id: 'usr_target',
                    $presence: onlinePresence(visibleLocation)
                },
                targetUserId: 'usr_target',
                localLocation: '',
                currentLocation,
                currentLocationPlayerIds: ['usr_target']
            })
        ).toBe(visibleLocation);
    });

    it('does not expose a location after the current instance stops being concrete', () => {
        expect(
            resolveUserDialogTargetPresenceLocation({
                profile: {
                    id: 'usr_target',
                    $presence: onlinePresence('private')
                },
                targetUserId: 'usr_target',
                localLocation: '',
                currentLocation: 'traveling',
                currentLocationPlayerIds: ['usr_target']
            })
        ).toBe('private');
    });
});
