import { describe, expect, it, vi } from 'vitest';

vi.mock('@/platform/tauri/bindings', () => ({ commands: {} }));

import {
    buildCustomOrderByGroup,
    moveFavoritesToEdge
} from './useLocalFavoriteCustomOrder';

describe('local favorite custom order', () => {
    it('groups backend rows by group name in backend order', () => {
        expect(
            buildCustomOrderByGroup(
                [
                    { createdAt: '', groupName: 'B', worldId: 'wrld_2' },
                    { createdAt: '', groupName: 'A', worldId: 'wrld_1' },
                    { createdAt: '', groupName: 'B', worldId: 'wrld_1' },
                    { createdAt: '', groupName: ' ', worldId: 'wrld_3' }
                ],
                'world'
            )
        ).toEqual({ B: ['wrld_2', 'wrld_1'], A: ['wrld_1'] });
    });

    it('moves the selected favorites to an edge while keeping their relative order', () => {
        const ids = ['a', 'b', 'c', 'd', 'e'];
        const selected = new Set(['d', 'b']);

        expect(moveFavoritesToEdge(ids, selected, 'top')).toEqual([
            'b',
            'd',
            'a',
            'c',
            'e'
        ]);
        expect(moveFavoritesToEdge(ids, selected, 'bottom')).toEqual([
            'a',
            'c',
            'e',
            'b',
            'd'
        ]);
    });
});
