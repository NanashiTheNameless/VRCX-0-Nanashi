import { describe, expect, it } from 'vitest';

import { buildFriendNameHistory } from './useFriendNameHistory';

describe('buildFriendNameHistory', () => {
    it('keeps the newest display name per user, including former friends', () => {
        expect(
            buildFriendNameHistory([
                {
                    userId: 'usr_a',
                    displayName: 'Old Name',
                    created_at: '2026-01-01T00:00:00Z'
                },
                {
                    userId: 'usr_a',
                    displayName: 'New Name',
                    created_at: '2026-02-01T00:00:00Z'
                },
                {
                    userId: 'usr_b',
                    displayName: 'Unfriended',
                    created_at: '2026-01-15T00:00:00Z'
                },
                { userId: 'usr_c', displayName: ' ', created_at: '2026-01-01' }
            ])
        ).toEqual({ usr_a: 'New Name', usr_b: 'Unfriended' });
    });
});
