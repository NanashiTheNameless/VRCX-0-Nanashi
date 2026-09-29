// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appFavoriteDetailsHydrate: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appFavoriteDetailsHydrate: mocks.appFavoriteDetailsHydrate
    }
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: <T,>(
        selector: (state: {
            auth: {
                currentUserId: string;
                currentUserEndpoint: string;
            };
        }) => T
    ): T =>
        selector({
            auth: {
                currentUserId: 'usr_current',
                currentUserEndpoint: 'https://api.vrchat.cloud'
            }
        })
}));

import { useFavoriteRevisionStore } from '@/state/favoriteRevisionStore';

import { useFavoriteRemoteDetails } from './useFavoriteRemoteDetails';

describe('useFavoriteRemoteDetails', () => {
    afterEach(() => {
        cleanup();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        useFavoriteRevisionStore.setState({
            remoteDetailsRevisionByKind: {
                avatar: 0,
                world: 0
            }
        });
        mocks.appFavoriteDetailsHydrate.mockResolvedValue({
            detailsById: {},
            availabilityById: {},
            cachedCount: 0,
            fetchedAt: '2026-07-31T00:00:00.000Z'
        });
    });

    it('hydrates remote details through the backend command', async () => {
        mocks.appFavoriteDetailsHydrate.mockResolvedValue({
            detailsById: {
                wrld_1: {
                    id: 'wrld_1',
                    name: 'World One',
                    releaseStatus: 'public'
                }
            },
            availabilityById: {
                wrld_1: 'public',
                ' wrld_2 ': 'deleted',
                wrld_3: '   ',
                '': 'private'
            },
            cachedCount: 1,
            fetchedAt: '2026-07-31T00:00:00.000Z'
        });

        const { result } = renderHook(() =>
            useFavoriteRemoteDetails({
                type: 'world',
                favoriteIds: ['wrld_1', ' wrld_2 ']
            })
        );

        await waitFor(() => {
            expect(result.current.status).toBe('ready');
        });

        expect(mocks.appFavoriteDetailsHydrate).toHaveBeenCalledWith({
            kind: 'world',
            favoriteIds: ['wrld_1', 'wrld_2'],
            requestedIds: ['wrld_1', 'wrld_2'],
            avatarTags: [],
            groupTags: []
        });
        expect(result.current.data).toEqual({
            wrld_1: {
                id: 'wrld_1',
                name: 'World One',
                releaseStatus: 'public'
            }
        });
        expect(result.current.availabilityById).toEqual({
            wrld_1: 'public',
            wrld_2: 'deleted'
        });
        expect(result.current.lastLoadedAt).toBe('2026-07-31T00:00:00.000Z');
    });

    it('passes normalized avatar tags for avatar hydration', async () => {
        const { result } = renderHook(() =>
            useFavoriteRemoteDetails({
                type: 'avatar',
                favoriteIds: ['avtr_1'],
                avatarTags: [' one ', 'one', 'two']
            })
        );

        await waitFor(() => {
            expect(result.current.status).toBe('ready');
        });

        expect(mocks.appFavoriteDetailsHydrate).toHaveBeenCalledWith({
            kind: 'avatar',
            favoriteIds: ['avtr_1'],
            requestedIds: ['avtr_1'],
            avatarTags: ['one', 'two'],
            groupTags: []
        });
    });

    it('passes the ordered world group tags for world hydration', async () => {
        const { result } = renderHook(() =>
            useFavoriteRemoteDetails({
                type: 'world',
                favoriteIds: ['wrld_1'],
                groupTags: [' worlds2 ', 'worlds2', 'worlds1']
            })
        );

        await waitFor(() => {
            expect(result.current.status).toBe('ready');
        });

        expect(mocks.appFavoriteDetailsHydrate).toHaveBeenCalledWith({
            kind: 'world',
            favoriteIds: ['wrld_1'],
            requestedIds: ['wrld_1'],
            avatarTags: [],
            groupTags: ['worlds2', 'worlds1']
        });
    });

    it('requests only the active projection while keeping the full favorite id set', async () => {
        const { result } = renderHook(() =>
            useFavoriteRemoteDetails({
                type: 'world',
                favoriteIds: ['wrld_1', 'wrld_2', 'wrld_3'],
                requestedIds: [' wrld_2 ', 'wrld_2']
            })
        );

        await waitFor(() => {
            expect(result.current.status).toBe('ready');
        });

        expect(mocks.appFavoriteDetailsHydrate).toHaveBeenCalledWith({
            kind: 'world',
            favoriteIds: ['wrld_1', 'wrld_2', 'wrld_3'],
            requestedIds: ['wrld_2'],
            avatarTags: [],
            groupTags: []
        });
    });

    it('keeps the previous projection visible while the next one loads', async () => {
        let resolveSecondHydrate: (() => void) | undefined;
        mocks.appFavoriteDetailsHydrate
            .mockResolvedValueOnce({
                detailsById: {
                    wrld_1: { id: 'wrld_1', name: 'World One' }
                },
                availabilityById: {},
                cachedCount: 1,
                fetchedAt: '2026-08-11T00:00:00.000Z'
            })
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        resolveSecondHydrate = () =>
                            resolve({
                                detailsById: {
                                    wrld_2: {
                                        id: 'wrld_2',
                                        name: 'World Two'
                                    }
                                },
                                availabilityById: {},
                                cachedCount: 0,
                                fetchedAt: '2026-08-11T00:00:00.000Z'
                            });
                    })
            );
        const { rerender, result } = renderHook(
            ({ requestedIds }: { requestedIds: string[] }) =>
                useFavoriteRemoteDetails({
                    type: 'world',
                    favoriteIds: ['wrld_1', 'wrld_2'],
                    requestedIds
                }),
            { initialProps: { requestedIds: ['wrld_1'] } }
        );

        await waitFor(() => {
            expect(result.current.status).toBe('ready');
        });
        expect(result.current.data.wrld_1?.name).toBe('World One');

        rerender({ requestedIds: ['wrld_2'] });

        expect(result.current.status).toBe('running');
        expect(result.current.data.wrld_1?.name).toBe('World One');
        await waitFor(() => {
            expect(resolveSecondHydrate).toBeTypeOf('function');
        });
        act(() => resolveSecondHydrate?.());
        await waitFor(() => {
            expect(result.current.status).toBe('ready');
        });
        expect(result.current.data.wrld_2?.name).toBe('World Two');
        expect(result.current.data.wrld_1?.name).toBe('World One');
    });

    it('keeps loaded details and does not claim ready while temporarily disabled', async () => {
        mocks.appFavoriteDetailsHydrate.mockResolvedValueOnce({
            detailsById: {
                wrld_1: { id: 'wrld_1', name: 'World One' }
            },
            availabilityById: {},
            cachedCount: 1,
            fetchedAt: '2026-08-11T00:00:00.000Z'
        });
        const { rerender, result } = renderHook(
            ({ enabled }: { enabled: boolean }) =>
                useFavoriteRemoteDetails({
                    type: 'world',
                    favoriteIds: ['wrld_1', 'wrld_2'],
                    enabled
                }),
            { initialProps: { enabled: true } }
        );

        await waitFor(() => {
            expect(result.current.status).toBe('ready');
        });

        rerender({ enabled: false });

        expect(result.current.status).toBe('idle');
        expect(result.current.data.wrld_1?.name).toBe('World One');
        await waitFor(() => {
            expect(result.current.status).toBe('idle');
        });
        expect(result.current.data.wrld_1?.name).toBe('World One');
        expect(mocks.appFavoriteDetailsHydrate).toHaveBeenCalledTimes(1);
    });

    it('stays ready without calling the backend when there are no ids', async () => {
        const { result } = renderHook(() =>
            useFavoriteRemoteDetails({
                type: 'world',
                favoriteIds: []
            })
        );

        await waitFor(() => {
            expect(result.current.status).toBe('ready');
        });
        expect(mocks.appFavoriteDetailsHydrate).not.toHaveBeenCalled();
    });

    it('does not refetch on rerender with unchanged parameters', async () => {
        const { rerender, result } = renderHook(
            ({ refreshToken }: { refreshToken: number }) =>
                useFavoriteRemoteDetails({
                    type: 'world',
                    favoriteIds: ['wrld_1'],
                    refreshToken
                }),
            { initialProps: { refreshToken: 0 } }
        );

        await waitFor(() => {
            expect(result.current.status).toBe('ready');
        });
        rerender({ refreshToken: 0 });
        await waitFor(() => {
            expect(result.current.status).toBe('ready');
        });

        expect(mocks.appFavoriteDetailsHydrate).toHaveBeenCalledTimes(1);
    });

    it('reattaches to an in-flight hydrate after a StrictMode effect cleanup', async () => {
        let resolveHydrate: (() => void) | undefined;
        mocks.appFavoriteDetailsHydrate.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveHydrate = () =>
                        resolve({
                            detailsById: {
                                wrld_1: {
                                    id: 'wrld_1',
                                    name: 'World One'
                                }
                            },
                            availabilityById: {},
                            cachedCount: 1,
                            fetchedAt: '2026-08-03T00:00:00.000Z'
                        });
                })
        );

        const { result } = renderHook(
            () =>
                useFavoriteRemoteDetails({
                    type: 'world',
                    favoriteIds: ['wrld_1']
                }),
            { wrapper: StrictMode }
        );

        await waitFor(() => {
            expect(resolveHydrate).toBeTypeOf('function');
        });
        act(() => resolveHydrate?.());

        await waitFor(() => {
            expect(result.current.status).toBe('ready');
        });
        expect(result.current.data.wrld_1?.name).toBe('World One');
        expect(mocks.appFavoriteDetailsHydrate).toHaveBeenCalledTimes(1);
    });

    it('refetches when the refresh token changes', async () => {
        const { rerender, result } = renderHook(
            ({ refreshToken }: { refreshToken: number }) =>
                useFavoriteRemoteDetails({
                    type: 'world',
                    favoriteIds: ['wrld_1'],
                    refreshToken
                }),
            { initialProps: { refreshToken: 0 } }
        );

        await waitFor(() => {
            expect(result.current.status).toBe('ready');
        });
        rerender({ refreshToken: 1 });
        await waitFor(() => {
            expect(mocks.appFavoriteDetailsHydrate).toHaveBeenCalledTimes(2);
        });
    });

    it('refetches when the matching remote favorite revision changes', async () => {
        const { result } = renderHook(() =>
            useFavoriteRemoteDetails({
                type: 'world',
                favoriteIds: ['wrld_1']
            })
        );

        await waitFor(() => {
            expect(result.current.status).toBe('ready');
        });
        act(() => {
            useFavoriteRevisionStore.getState().bumpRevision({
                kind: 'world',
                local: false,
                remote: true,
                requiresRefresh: false
            });
        });
        await waitFor(() => {
            expect(mocks.appFavoriteDetailsHydrate).toHaveBeenCalledTimes(2);
        });
    });

    it('does not refetch for another favorite kind revision', async () => {
        const { result } = renderHook(() =>
            useFavoriteRemoteDetails({
                type: 'world',
                favoriteIds: ['wrld_1']
            })
        );

        await waitFor(() => {
            expect(result.current.status).toBe('ready');
        });
        act(() => {
            useFavoriteRevisionStore.getState().bumpRevision({
                kind: 'avatar',
                local: false,
                remote: true,
                requiresRefresh: false
            });
        });

        expect(mocks.appFavoriteDetailsHydrate).toHaveBeenCalledTimes(1);
    });

    it('surfaces backend failures as an error state', async () => {
        mocks.appFavoriteDetailsHydrate.mockRejectedValue(
            new Error('hydrate failed')
        );

        const { result } = renderHook(() =>
            useFavoriteRemoteDetails({
                type: 'avatar',
                favoriteIds: ['avtr_1']
            })
        );

        await waitFor(() => {
            expect(result.current.status).toBe('error');
        });
        expect(result.current.detail).toBe('hydrate failed');
        expect(result.current.data).toEqual({});
        expect(result.current.availabilityById).toEqual({});
    });
});
