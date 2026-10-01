import { describe, expect, it } from 'vitest';

import { getDisplayName, normalizeUserId } from './friendBootstrapModel';

describe('friendBootstrapModel pure normalizers', () => {
    it('normalizes ids defensively', () => {
        expect(normalizeUserId(' usr_friend ')).toBe('usr_friend');
        expect(normalizeUserId(null)).toBe('');
    });

    it('derives display names from profile fields', () => {
        expect(
            getDisplayName({
                id: 'usr_id',
                username: 'Username'
            })
        ).toBe('Username');
    });
});
