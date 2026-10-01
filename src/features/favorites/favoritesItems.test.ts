import { describe, expect, it } from 'vitest';

import {
    favoriteGroupType,
    normalizeFavoriteEntityId,
    normalizeFavoriteSearchValue,
    shrinkFavoriteImage,
    sortFavoriteItems
} from './favoritesItems';

describe('favorite item helpers', () => {
    it('normalizes search text and entity ids for matching and actions', () => {
        expect(normalizeFavoriteSearchValue('  Rooftop Club  ')).toBe(
            'rooftop club'
        );
        expect(normalizeFavoriteSearchValue('')).toBe('');
        expect(normalizeFavoriteEntityId('  wrld_123  ')).toBe('wrld_123');
        expect(normalizeFavoriteEntityId(42)).toBe('42');
        expect(normalizeFavoriteEntityId(null)).toBe('');
    });

    it('sorts favorite items by saved order, name, or player count', () => {
        const items = [
            { id: 'b', title: 'Beta', orderIndex: 2, playerCount: 6 },
            { id: 'a', title: 'Alpha', orderIndex: 1, playerCount: 10 },
            { id: 'c', title: 'Alpha', orderIndex: 3, playerCount: 2 }
        ];

        expect(sortFavoriteItems(items, 'date').map((item) => item.id)).toEqual(
            ['a', 'b', 'c']
        );
        expect(sortFavoriteItems(items, 'name').map((item) => item.id)).toEqual(
            ['a', 'c', 'b']
        );
        expect(
            sortFavoriteItems(items, 'players').map((item) => item.id)
        ).toEqual(['a', 'b', 'c']);
        expect(items.map((item) => item.id)).toEqual(['b', 'a', 'c']);
    });

    it('shrinks direct image URLs from 256 to 128 when possible', () => {
        expect(
            shrinkFavoriteImage(
                'https://api.vrchat.cloud/api/1/image/file_abc/1/256'
            )
        ).toBe('https://api.vrchat.cloud/api/1/image/file_abc/1/128');
        expect(shrinkFavoriteImage('')).toBe('');
    });

    it('resolves favorite group type from explicit group data or page kind', () => {
        expect(favoriteGroupType('avatar', { type: 'avatar' })).toBe('avatar');
        expect(favoriteGroupType('world', {})).toBe('world');
        expect(favoriteGroupType('friend', {})).toBe('friend');
    });
});
