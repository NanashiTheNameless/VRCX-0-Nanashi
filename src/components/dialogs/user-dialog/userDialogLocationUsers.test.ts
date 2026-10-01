import { describe, expect, it } from 'vitest';

import { offlinePresence, onlinePresence } from '@/test/presenceFixtures';

import { buildUserDialogLocationUsers } from './userDialogLocationUsers';

describe('buildUserDialogLocationUsers', () => {
    const t = (key: string) => key;
    const parsedLocation = {
        isRealInstance: true,
        userId: '',
        groupId: ''
    };

    it('shows the instance creator before the current user and friends', () => {
        const result = buildUserDialogLocationUsers({
            currentUserId: 'usr_self',
            friendsById: {
                usr_friend: { id: 'usr_friend' }
            },
            locationInstance: {},
            locationOwnerGroup: null,
            locationOwnerUser: {
                id: 'usr_owner',
                displayName: 'Non-friend owner'
            },
            profile: {
                id: 'usr_target',
                displayName: 'Non-friend target'
            },
            sameInstanceUsers: [
                { id: 'usr_self', displayName: 'Self' },
                { id: 'usr_friend', displayName: 'Friend' },
                { id: 'usr_target', displayName: 'Non-friend target' },
                { id: 'usr_other', displayName: 'Other non-friend' }
            ],
            t,
            visiblePresenceParsedLocation: parsedLocation
        });

        expect(result.locationInstanceUsers.map((user) => user.id)).toEqual([
            'usr_owner',
            'usr_self',
            'usr_friend'
        ]);
        expect(result.locationInstanceUsers[0]?.$subtitle).toBe(
            'dialog.user.info.instance_creator'
        );
        expect(result.locationInstanceUsers[0]?.$isInstanceCreator).toBe(true);
        expect(result.locationInstanceUsers[0]?.isFriend).toBe(false);
        expect(result.locationOwnerId).toBe('usr_owner');
    });

    it('marks a friend creator as a friend', () => {
        const result = buildUserDialogLocationUsers({
            currentUserId: 'usr_self',
            friendsById: {
                usr_owner: { id: 'usr_owner', displayName: 'Friend owner' }
            },
            locationInstance: {},
            locationOwnerGroup: null,
            locationOwnerUser: {
                id: 'usr_owner',
                displayName: 'Friend owner'
            },
            profile: null,
            sameInstanceUsers: [],
            t,
            visiblePresenceParsedLocation: parsedLocation
        });

        expect(result.locationInstanceUsers[0]?.$isInstanceCreator).toBe(true);
        expect(result.locationInstanceUsers[0]?.isFriend).toBe(true);
    });

    it('does not add a non-friend profile as the roster fallback', () => {
        const result = buildUserDialogLocationUsers({
            currentUserId: 'usr_self',
            friendsById: {},
            locationInstance: {},
            locationOwnerGroup: null,
            locationOwnerUser: null,
            profile: {
                id: 'usr_target',
                displayName: 'Non-friend target'
            },
            sameInstanceUsers: [],
            t,
            visiblePresenceParsedLocation: parsedLocation
        });

        expect(result.locationInstanceUsers).toEqual([]);
    });

    it('restores name-only Busy and Ask Me friends from the observed roster', () => {
        const result = buildUserDialogLocationUsers({
            currentUserId: 'usr_self',
            friendsById: {
                usr_busy: {
                    id: 'usr_busy',
                    displayName: 'Busy Friend',
                    status: 'busy',
                    $presence: onlinePresence('private')
                },
                usr_ask: {
                    id: 'usr_ask',
                    displayName: 'Ask Friend',
                    status: 'ask me',
                    $presence: onlinePresence('private')
                }
            },
            locationInstance: {},
            locationOwnerGroup: null,
            locationOwnerUser: null,
            profile: null,
            sameInstanceUsers: [
                { userId: '', displayName: 'Busy Friend' },
                { userId: '', displayName: 'Ask Friend' }
            ],
            t,
            visiblePresenceParsedLocation: parsedLocation
        });

        expect(result.locationInstanceUsers.map((user) => user.id)).toEqual([
            'usr_busy',
            'usr_ask'
        ]);
    });

    it('does not restore an explicitly offline friend from a stale roster row', () => {
        const result = buildUserDialogLocationUsers({
            currentUserId: 'usr_self',
            friendsById: {
                usr_friend: {
                    id: 'usr_friend',
                    $presence: offlinePresence
                }
            },
            locationInstance: {},
            locationOwnerGroup: null,
            locationOwnerUser: null,
            profile: null,
            sameInstanceUsers: [
                { id: 'usr_friend', displayName: 'Departed Friend' }
            ],
            t,
            visiblePresenceParsedLocation: parsedLocation
        });

        expect(result.locationInstanceUsers).toEqual([]);
    });

    it('does not keep a stale roster row after the friend moves elsewhere', () => {
        const result = buildUserDialogLocationUsers({
            currentUserId: 'usr_self',
            friendsById: {
                usr_friend: {
                    id: 'usr_friend',
                    $presence: onlinePresence('wrld_elsewhere:456')
                }
            },
            locationInstance: {},
            locationOwnerGroup: null,
            locationOwnerUser: null,
            profile: null,
            sameInstanceUsers: [
                { id: 'usr_friend', displayName: 'Departed Friend' }
            ],
            t,
            visiblePresenceParsedLocation: {
                ...parsedLocation,
                tag: 'wrld_current:123'
            }
        });

        expect(result.locationInstanceUsers).toEqual([]);
    });
});
