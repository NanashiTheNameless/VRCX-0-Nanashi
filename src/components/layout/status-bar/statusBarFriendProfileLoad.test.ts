import { describe, expect, it } from 'vitest';

import { isFriendProfileLoadStatusVisible } from './statusBarFriendProfileLoad';

describe('statusBarFriendProfileLoad', () => {
    it('shows active and terminal task states and hides idle', () => {
        for (const status of [
            'running',
            'cancelling',
            'completed',
            'cancelled'
        ] as const) {
            expect(isFriendProfileLoadStatusVisible(status)).toBe(true);
        }
        expect(isFriendProfileLoadStatusVisible('idle')).toBe(false);
    });
});
