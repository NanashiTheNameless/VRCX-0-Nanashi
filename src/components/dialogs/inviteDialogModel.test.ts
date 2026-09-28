import { describe, expect, it } from 'vitest';

import {
    buildFavoriteGroupItems,
    buildFavoriteGroupLabelsByUserId,
    buildFriendsInCurrentInstanceIds,
    displayNameForUser,
    onlineFriendIdsFromGroup,
    pushUniqueLabel
} from './inviteDialogModel';

describe('inviteDialogModel', () => {
    const friendsById = {
        usr_bucket_online: {
            id: 'usr_bucket_online',
            state: 'online',
            ref: {
                displayName: 'Bucket Online'
            }
        },
        usr_state_online: {
            id: 'usr_state_online',
            state: 'online',
            ref: {
                username: 'State Online'
            }
        },
        usr_offline: {
            id: 'usr_offline',
            state: 'offline',
            name: 'Offline Friend'
        },
        usr_name_only: {
            id: 'usr_name_only',
            state: 'online',
            name: 'Name Only'
        }
    };

    it('keeps unique online friend ids from state bucket or state', () => {
        expect(
            onlineFriendIdsFromGroup(
                [
                    ' usr_bucket_online ',
                    'usr_state_online',
                    'usr_bucket_online',
                    'usr_offline',
                    '',
                    'usr_missing'
                ],
                friendsById
            )
        ).toEqual(['usr_bucket_online', 'usr_state_online']);
    });

    it('resolves display names through self and friend fallbacks', () => {
        expect(
            displayNameForUser('usr_self', friendsById, {
                id: 'usr_self',
                displayName: 'Self Display',
                username: 'self_name'
            })
        ).toBe('Self Display');
        expect(
            displayNameForUser('usr_self', friendsById, {
                id: 'usr_self',
                username: 'self_name'
            })
        ).toBe('self_name');
        expect(
            displayNameForUser('usr_self', friendsById, { id: 'usr_self' })
        ).toBe('usr_self');
        expect(displayNameForUser('usr_bucket_online', friendsById, null)).toBe(
            'Bucket Online'
        );
        expect(displayNameForUser('usr_state_online', friendsById, null)).toBe(
            'State Online'
        );
        expect(displayNameForUser('usr_name_only', friendsById, null)).toBe(
            'Name Only'
        );
        expect(displayNameForUser('usr_unknown', friendsById, null)).toBe(
            'usr_unknown'
        );
    });

    it('uses the friend itself when ref is present but not an object', () => {
        expect(
            displayNameForUser(
                'usr_string_ref',
                {
                    usr_string_ref: {
                        ref: 'usr_string_ref',
                        name: 'String Ref Name'
                    }
                },
                null
            )
        ).toBe('String Ref Name');
    });

    it('pushes unique non-empty labels in insertion order', () => {
        const labels = ['Existing'];

        pushUniqueLabel(labels, ' New ');
        pushUniqueLabel(labels, 'Existing');
        pushUniqueLabel(labels, '');
        pushUniqueLabel(labels, '');
        pushUniqueLabel(labels, 'Another');

        expect(labels).toEqual(['Existing', 'New', 'Another']);
    });

    it('builds favorite group labels per user from remote and local sources', () => {
        expect(
            buildFavoriteGroupLabelsByUserId({
                favoriteFriendGroups: [
                    { key: 'group_remote', displayName: 'Remote Group' },
                    { key: 'group_duplicate', displayName: 'Shared Group' }
                ],
                groupedFavoriteFriendIdsByGroupKey: {
                    group_remote: [
                        'usr_bucket_online',
                        ' usr_state_online ',
                        ''
                    ],
                    group_duplicate: ['usr_bucket_online']
                },
                localFriendFavoriteGroups: ['Local Group', 'Shared Group'],
                localFriendFavorites: {
                    'Local Group': ['usr_bucket_online', 'usr_name_only'],
                    'Shared Group': ['usr_bucket_online']
                }
            })
        ).toEqual({
            usr_bucket_online: ['Remote Group', 'Shared Group', 'Local Group'],
            usr_state_online: ['Remote Group'],
            usr_name_only: ['Local Group']
        });
    });

    it('keeps known friends in current instance and dedupes, regardless of online state', () => {
        expect(
            buildFriendsInCurrentInstanceIds({
                currentLocationPlayerIds: [
                    ' usr_bucket_online ',
                    'usr_bucket_online',
                    'usr_offline',
                    'usr_missing',
                    ''
                ],
                friendsById
            })
        ).toEqual(['usr_bucket_online', 'usr_offline']);
    });

    it('builds favorite group labels from local favorites keys when group list is missing', () => {
        expect(
            buildFavoriteGroupLabelsByUserId({
                favoriteFriendGroups: [],
                groupedFavoriteFriendIdsByGroupKey: {},
                localFriendFavoriteGroups: undefined,
                localFriendFavorites: {
                    'Group A': ['usr_bucket_online'],
                    'Group B': ['usr_bucket_online', 'usr_name_only']
                }
            })
        ).toEqual({
            usr_bucket_online: ['Group A', 'Group B'],
            usr_name_only: ['Group B']
        });
    });

    it('builds favorite group menu items with online friends and filters empty groups', () => {
        expect(
            buildFavoriteGroupItems({
                favoriteFriendGroups: [
                    { key: 'remote_online', displayName: 'Remote Online' },
                    { key: 'remote_empty', displayName: 'Remote Empty' }
                ],
                groupedFavoriteFriendIdsByGroupKey: {
                    remote_online: [
                        'usr_bucket_online',
                        'usr_offline',
                        'usr_state_online',
                        'usr_bucket_online'
                    ],
                    remote_empty: ['usr_offline']
                },
                localFriendFavoriteGroups: ['Local Online', 'Local Empty'],
                localFriendFavorites: {
                    'Local Online': ['usr_name_only', 'usr_missing'],
                    'Local Empty': ['usr_offline']
                },
                friendsById
            })
        ).toEqual({
            remote: [
                {
                    key: 'remote:remote_online',
                    label: 'Remote Online',
                    userIds: ['usr_bucket_online', 'usr_state_online']
                }
            ],
            local: [
                {
                    key: 'local:Local Online',
                    label: 'Local Online',
                    userIds: ['usr_name_only']
                }
            ]
        });
    });

    it('returns no local groups when the local group list is missing', () => {
        // buildFavoriteGroupItems only reads localFriendFavoriteGroups (no
        // Object.keys fallback), unlike buildFavoriteGroupLabelsByUserId. This
        // asymmetry is intentional - lock it so it is not "unified" by accident.
        expect(
            buildFavoriteGroupItems({
                favoriteFriendGroups: [],
                groupedFavoriteFriendIdsByGroupKey: {},
                localFriendFavoriteGroups: undefined,
                localFriendFavorites: {
                    'Group A': ['usr_bucket_online']
                },
                friendsById
            })
        ).toEqual({ remote: [], local: [] });
    });
});
