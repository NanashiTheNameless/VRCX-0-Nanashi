import { beforeEach, describe, expect, it } from 'vitest';

import type { FriendRosterSnapshot } from '@/platform/tauri/bindings';
import { useUserFactsStore } from '@/state/userFactsStore';

import { hydrateFriendUserFacts } from './friendUserFactsHydration';

const ENDPOINT = 'https://api.example.test/api/1';
const USER_ID = 'usr_friend';
const KEY = `${ENDPOINT}::${USER_ID}`;

function snapshot(
    fields: Record<string, string | boolean> = {}
): FriendRosterSnapshot {
    return {
        currentUserId: 'usr_self',
        generation: 1,
        presenceById: {},
        friendsById: { [USER_ID]: { id: USER_ID, ...fields } }
    };
}

describe('friend user facts hydration', () => {
    beforeEach(() => useUserFactsStore.getState().resetUserFacts());

    it('restores available badge facts without waiting for a profile event', () => {
        hydrateFriendUserFacts(
            snapshot({
                ageVerificationStatus: '18+',
                bio: 'Artist',
                pronouns: 'they/them',
                lastPlatform: 'android'
            }),
            ENDPOINT
        );
        expect(useUserFactsStore.getState().usersByKey[KEY]).toMatchObject({
            id: USER_ID,
            endpoint: ENDPOINT,
            isFriend: true,
            ageVerificationStatus: '18+',
            bio: 'Artist',
            pronouns: 'they/them',
            last_platform: 'android'
        });
        expect(useUserFactsStore.getState().usersByKey[KEY]).not.toHaveProperty(
            'ageVerified'
        );
    });

    it('preserves fields already received from live profile projections', () => {
        useUserFactsStore.getState().replaceUserFacts([
            {
                id: USER_ID,
                endpoint: ENDPOINT,
                updatedAt: 1784246400,
                ageVerificationStatus: '',
                ageVerified: false,
                bio: '',
                pronouns: 'he/him'
            }
        ]);
        hydrateFriendUserFacts(
            snapshot({
                ageVerificationStatus: '18+',
                ageVerified: true,
                bio: 'Old bio',
                pronouns: 'Old pronouns',
                displayName: 'Friend'
            }),
            ENDPOINT
        );
        expect(useUserFactsStore.getState().usersByKey[KEY]).toMatchObject({
            displayName: 'Friend',
            isFriend: true,
            updatedAt: 1784246400,
            ageVerificationStatus: '',
            ageVerified: false,
            bio: '',
            pronouns: 'he/him'
        });
    });

    it('keeps endpoints separate and leaves unrelated facts intact', () => {
        useUserFactsStore.getState().replaceUserFacts([
            { id: USER_ID, endpoint: 'other', ageVerificationStatus: 'hidden' },
            { id: 'usr_other', endpoint: ENDPOINT, bio: 'Kept' }
        ]);
        hydrateFriendUserFacts(
            snapshot({ ageVerificationStatus: '18+' }),
            ENDPOINT
        );
        expect(
            useUserFactsStore.getState().usersByKey[`other::${USER_ID}`]
                .ageVerificationStatus
        ).toBe('hidden');
        expect(
            useUserFactsStore.getState().usersByKey[`${ENDPOINT}::usr_other`]
                .bio
        ).toBe('Kept');
        expect(
            useUserFactsStore.getState().usersByKey[KEY].ageVerificationStatus
        ).toBe('18+');
    });
});
