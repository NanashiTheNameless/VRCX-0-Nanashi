// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    resetScrollTop: vi.fn(),
    viewportMetrics: {
        scrollTop: 0,
        viewportHeight: 600,
        width: 520
    }
}));

vi.mock('@/lib/useScrollViewportMetrics', () => ({
    useScrollViewportMetrics: () => ({
        resetScrollTop: mocks.resetScrollTop,
        viewportMetrics: mocks.viewportMetrics,
        viewportRef: vi.fn()
    })
}));

import { getFavoritesDensityConfig } from './favoritesDensity';
import type { FavoriteItem } from './favoritesTypes';
import { useFavoritesVirtualGrid } from './useFavoritesVirtualGrid';

const ITEMS: FavoriteItem[] = Array.from({ length: 4 }, (_, index) => ({
    id: `wrld_${index}`,
    key: `world:${index}`,
    kind: 'world',
    source: 'remote',
    title: `World ${index}`
}));

describe('useFavoritesVirtualGrid', () => {
    it('reserves a two-pixel gutter without changing compact card height or visible gap', () => {
        const { result } = renderHook(() =>
            useFavoritesVirtualGrid({
                densityConfig: getFavoritesDensityConfig('world', 'compact'),
                items: ITEMS,
                resetKey: 'world:compact'
            })
        );

        expect(result.current.gridPadding).toBe(2);
        expect(result.current.gridGap).toBe(4);
        expect(result.current.gridMinWidth).toBe(244);
        expect(result.current.cardHeight).toBe(60);
        expect(result.current.visibleRows[0]?.cellHeight).toBe(64);
        expect(result.current.totalHeight).toBe(132);
    });
});
