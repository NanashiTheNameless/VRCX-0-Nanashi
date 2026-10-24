import { describe, expect, it } from 'vitest';

import { buildFriendNameHistory } from './useFriendNameHistory';

describe('buildFriendNameHistory', () => {
    it('keeps the newest display name per user, including former friends', () => {
        expect(
            buildFriendNameHistory([
                {
                    userId: 'usr_a',
                    displayName: 'Old Name',
                    created_at: 1767225600
                },
                {
                    userId: 'usr_a',
                    displayName: 'New Name',
                    created_at: 1769904000
                },
                {
                    userId: 'usr_b',
                    displayName: 'Unfriended',
                    created_at: 1768435200
                },
                { userId: 'usr_c', displayName: ' ', created_at: 1767225600 }
            ])
        ).toEqual({ usr_a: 'New Name', usr_b: 'Unfriended' });
    });
});
