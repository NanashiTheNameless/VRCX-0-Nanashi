// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    objectValues: new Map<string, unknown>(),
    getObject: vi.fn(),
    setObject: vi.fn()
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getObject: mocks.getObject,
        setObject: mocks.setObject
    }
}));

import type { FavoriteGroupView } from './favoritesTypes';
import {
    useFavoritesFilters,
    useFavoritesSelectedGroupSync
} from './useFavoritesFilters';

const remoteGroup: FavoriteGroupView = {
    count: 3,
    key: 'group_0',
    label: 'Remote',
    source: 'remote'
};
const localGroup: FavoriteGroupView = {
    count: 2,
    key: 'Saved',
    label: 'Saved',
    source: 'local'
};

function useFavoritesSelection(groups: {
    localGroups: FavoriteGroupView[];
    remoteGroups: FavoriteGroupView[];
}) {
    const filters = useFavoritesFilters({ kind: 'world' });
    useFavoritesSelectedGroupSync({
        autoSelectGroup: filters.autoSelectGroup,
        avatarHistoryGroups: [],
        localGroups: groups.localGroups,
        remoteGroups: groups.remoteGroups,
        restoreGroup: filters.restoreGroup,
        restoreTarget: filters.restoreTarget,
        selectedGroupKey: filters.selectedGroupKey,
        selectedSource: filters.selectedSource
    });
    return filters;
}

describe('favorites selected group', () => {
    beforeEach(() => {
        mocks.objectValues.clear();
        mocks.getObject
            .mockReset()
            .mockImplementation(
                async (key: string) => mocks.objectValues.get(key) ?? null
            );
        mocks.setObject.mockReset().mockResolvedValue(null);
    });

    it('restores the last selected local group once it loads', async () => {
        mocks.objectValues.set('VRCX_FavoritesWorldSelectedGroup', {
            key: 'Saved',
            source: 'local'
        });
        const { rerender, result } = renderHook(
            (groups) => useFavoritesSelection(groups),
            {
                initialProps: {
                    localGroups: [] as FavoriteGroupView[],
                    remoteGroups: [remoteGroup]
                }
            }
        );

        await waitFor(() =>
            expect(result.current.restoreTarget).toEqual({
                key: 'Saved',
                source: 'local'
            })
        );
        expect(result.current.selectedGroupKey).toBe('group_0');
        expect(mocks.setObject).not.toHaveBeenCalled();

        rerender({ localGroups: [localGroup], remoteGroups: [remoteGroup] });

        expect(result.current.selectedSource).toBe('local');
        expect(result.current.selectedGroupKey).toBe('Saved');
    });

    it('remembers the group the user selects', async () => {
        const { result } = renderHook(() =>
            useFavoritesSelection({
                localGroups: [localGroup],
                remoteGroups: [remoteGroup]
            })
        );
        await waitFor(() => expect(mocks.getObject).toHaveBeenCalled());

        act(() => {
            result.current.setSelectedSource('local');
            result.current.setSelectedGroupKey('Saved');
        });

        expect(mocks.setObject).toHaveBeenLastCalledWith(
            'VRCX_FavoritesWorldSelectedGroup',
            { key: 'Saved', source: 'local' }
        );
    });

    it('falls back to the first group when the remembered one is gone', async () => {
        mocks.objectValues.set('VRCX_FavoritesWorldSelectedGroup', {
            key: 'Deleted',
            source: 'local'
        });
        const { result } = renderHook(() =>
            useFavoritesSelection({
                localGroups: [localGroup],
                remoteGroups: [remoteGroup]
            })
        );

        await waitFor(() =>
            expect(result.current.restoreTarget).not.toBe(null)
        );
        expect(result.current.selectedSource).toBe('remote');
        expect(result.current.selectedGroupKey).toBe('group_0');
    });
});
