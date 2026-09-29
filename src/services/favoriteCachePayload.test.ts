import { describe, expect, it } from 'vitest';

import {
    favoriteCachePayload,
    normalizeFavoriteCacheEntityId
} from './favoriteCachePayload';

describe('favoriteCachePayload', () => {
    it('preserves JSON objects with open future fields', () => {
        const payload = {
            id: 'fav_1',
            future: { enabled: true, ranks: [1, 2] }
        };

        expect(favoriteCachePayload(payload)).toBe(payload);
    });

    it('rejects non-object roots and non-JSON nested values', () => {
        expect(favoriteCachePayload(null)).toBeNull();
        expect(favoriteCachePayload('fav_1')).toBeNull();
        expect(favoriteCachePayload(['fav_1'])).toBeNull();
        expect(favoriteCachePayload({ invalid: undefined })).toBeNull();
    });

    it('normalizes string and numeric entity identifiers', () => {
        expect(normalizeFavoriteCacheEntityId(' fav_1 ')).toBe('fav_1');
        expect(normalizeFavoriteCacheEntityId(42)).toBe('42');
    });
});
