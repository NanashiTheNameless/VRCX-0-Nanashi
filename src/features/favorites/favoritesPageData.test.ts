import { describe, expect, it } from 'vitest';

import {
    buildFavoriteAvatarHistoryItems,
    buildFavoriteLocalItemsByGroup,
    buildFavoriteRemoteItemsByGroup
} from './favoritesPageData';

function buildWorldItems({
    remoteWorldDetail,
    remoteEntityDetailsStatus = 'ready',
    worldAvailabilityById
}: {
    remoteWorldDetail?: Record<string, unknown>;
    remoteEntityDetailsStatus?: string;
    worldAvailabilityById?: Record<string, string | undefined>;
}) {
    return buildFavoriteRemoteItemsByGroup({
        kind: 'world',
        remoteGroups: [
            {
                key: 'world:group_0',
                label: 'Worlds'
            }
        ],
        groupedFavoriteFriendIdsByGroupKey: {},
        friendsById: {},
        favoritesSortIndex: {},
        sortValue: 'date',
        remoteFavoritesById: {
            fvrt_world_1: {
                id: 'fvrt_world_1',
                type: 'world',
                favoriteId: 'wrld_favorite',
                $groupKey: 'world:group_0'
            }
        },
        remoteEntityDetailsData: remoteWorldDetail
            ? {
                  wrld_favorite: {
                      id: 'wrld_favorite',
                      ...remoteWorldDetail
                  }
              }
            : {},
        remoteEntityDetailsStatus,
        remoteGroupLabelByKey: {
            'world:group_0': 'Worlds'
        },
        worldAvailabilityById: worldAvailabilityById || {},
        t: (key: string) => key
    })['world:group_0'];
}

function buildAvatarItems({
    avatarDetailFallback,
    remoteAvatarDetail
}: {
    avatarDetailFallback?: Record<string, unknown>;
    remoteAvatarDetail?: Record<string, unknown>;
}) {
    return buildFavoriteRemoteItemsByGroup({
        kind: 'avatar',
        remoteGroups: [
            {
                key: 'avatar:group_0',
                label: 'Avatars'
            }
        ],
        groupedFavoriteFriendIdsByGroupKey: {},
        friendsById: {},
        favoritesSortIndex: {},
        sortValue: 'date',
        remoteFavoritesById: {
            fvrt_avatar_1: {
                id: 'fvrt_avatar_1',
                type: 'avatar',
                favoriteId: 'avtr_favorite',
                $groupKey: 'avatar:group_0'
            }
        },
        remoteEntityDetailsData: remoteAvatarDetail
            ? {
                  avtr_favorite: {
                      id: 'avtr_favorite',
                      ...remoteAvatarDetail
                  }
              }
            : {},
        remoteEntityDetailsStatus: 'ready',
        avatarDetailFallbacksById: avatarDetailFallback
            ? {
                  avtr_favorite: {
                      id: 'avtr_favorite',
                      ...avatarDetailFallback
                  }
              }
            : {},
        remoteGroupLabelByKey: {
            'avatar:group_0': 'Avatars'
        },
        t: (key: string) => key
    })['avatar:group_0'];
}

describe('favorites page data helpers', () => {
    it('locks private world details reported by the backend', () => {
        const items = buildWorldItems({
            remoteWorldDetail: {
                name: 'Private World',
                authorName: 'Aspen',
                releaseStatus: 'private'
            }
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'wrld_favorite',
                title: 'Private World',
                seedData: expect.objectContaining({
                    releaseStatus: 'private'
                }),
                isPrivate: true,
                isUnavailable: false
            })
        ]);
    });

    it('keeps a conservative lock on unverified world details resolved from the local cache', () => {
        const items = buildWorldItems({
            remoteWorldDetail: {
                name: 'Cached Public World',
                authorName: 'Birch',
                releaseStatus: 'public'
            },
            worldAvailabilityById: { wrld_favorite: 'unverified' }
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'wrld_favorite',
                title: 'Cached Public World',
                isPrivate: true,
                isDeleted: false,
                isUnavailable: false
            })
        ]);
    });

    it('unlocks worlds once the probe confirms they are public', () => {
        const items = buildWorldItems({
            remoteWorldDetail: {
                name: 'Probed Public World',
                authorName: 'Birch',
                releaseStatus: 'public'
            },
            worldAvailabilityById: { wrld_favorite: 'public' }
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'wrld_favorite',
                title: 'Probed Public World',
                isPrivate: false,
                isDeleted: false,
                isUnavailable: false
            })
        ]);
    });

    it('marks a world whose details have not arrived as loading with no placeholder text', () => {
        const items = buildWorldItems({
            remoteEntityDetailsStatus: 'running'
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'wrld_favorite',
                isLoadingDetail: true,
                isUnavailable: false,
                title: '',
                subtitle: ''
            })
        ]);
    });

    it('keeps a world unavailable and not loading when the backend resolved nothing for it', () => {
        const items = buildWorldItems({});

        expect(items).toEqual([
            expect.objectContaining({
                id: 'wrld_favorite',
                isLoadingDetail: false,
                title: 'view.favorites.empty.world_fallback',
                seedData: null,
                isPrivate: false,
                isUnavailable: true
            })
        ]);
    });

    it('keeps a world unavailable when the backend returned only an id shell', () => {
        const items = buildWorldItems({ remoteWorldDetail: {} });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'wrld_favorite',
                title: 'view.favorites.empty.world_fallback',
                seedData: null,
                isPrivate: false,
                isUnavailable: true
            })
        ]);
    });

    it('uses occupants from remote world details', () => {
        const items = buildWorldItems({
            remoteWorldDetail: {
                name: 'Remote World',
                occupants: 4
            }
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'wrld_favorite',
                playerCount: 4
            })
        ]);
    });

    it('shows live remote avatar details without a lock', () => {
        const items = buildAvatarItems({
            remoteAvatarDetail: {
                name: 'Live Avatar',
                authorName: 'Willow',
                releaseStatus: 'public'
            }
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'avtr_favorite',
                title: 'Live Avatar',
                isPrivate: false,
                isUnavailable: false
            })
        ]);
    });

    it('locks hidden remote avatars while still showing their details', () => {
        const items = buildAvatarItems({
            remoteAvatarDetail: {
                name: 'Hidden Avatar',
                authorName: 'Hazel',
                releaseStatus: 'hidden'
            }
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'avtr_favorite',
                title: 'Hidden Avatar',
                isPrivate: true,
                isUnavailable: false
            })
        ]);
    });

    it('uses DB fallback avatar details with a lock when remote details are missing', () => {
        const items = buildAvatarItems({
            avatarDetailFallback: {
                name: 'DB Avatar',
                authorName: 'Sage',
                releaseStatus: 'private'
            }
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'avtr_favorite',
                title: 'DB Avatar',
                isPrivate: true,
                isUnavailable: false
            })
        ]);
    });

    it('keeps remote-missing avatars unavailable when no cache source has details', () => {
        const items = buildAvatarItems({});

        expect(items).toEqual([
            expect.objectContaining({
                id: 'avtr_favorite',
                title: 'view.favorites.empty.avatar_fallback',
                seedData: null,
                isPrivate: false,
                isUnavailable: true
            })
        ]);
    });

    it('prefers live remote avatar details over cached fallbacks', () => {
        const items = buildAvatarItems({
            remoteAvatarDetail: {
                name: 'Live Avatar',
                authorName: 'Fern',
                releaseStatus: 'public'
            },
            avatarDetailFallback: {
                name: 'DB Avatar',
                releaseStatus: 'private'
            }
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'avtr_favorite',
                title: 'Live Avatar',
                isPrivate: false,
                isUnavailable: false
            })
        ]);
    });

    it('marks a probed private world as private without treating it as a fallback lock', () => {
        const items = buildWorldItems({
            remoteWorldDetail: {
                name: 'Probed Private World',
                authorName: 'Aspen'
            },
            worldAvailabilityById: {
                wrld_favorite: 'private'
            }
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'wrld_favorite',
                title: 'Probed Private World',
                isPrivate: true,
                isDeleted: false,
                isUnavailable: false
            })
        ]);
    });

    it('shows a deleted world with its cached details and no lock icon', () => {
        const items = buildWorldItems({
            remoteWorldDetail: {
                name: 'Deleted World',
                authorName: 'Birch',
                releaseStatus: 'public'
            },
            worldAvailabilityById: {
                wrld_favorite: 'deleted'
            }
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'wrld_favorite',
                title: 'Deleted World',
                isPrivate: false,
                isDeleted: true,
                isUnavailable: false
            })
        ]);
    });

    it('keeps a deleted world with no cache source in the unavailable state with deleted copy', () => {
        const items = buildWorldItems({
            worldAvailabilityById: {
                wrld_favorite: 'deleted'
            }
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'wrld_favorite',
                subtitle: 'view.favorites.error.world_deleted',
                isPrivate: false,
                isDeleted: true,
                isUnavailable: true
            })
        ]);
    });

    it('keeps full and compact image urls separate for remote world cards', () => {
        const items = buildWorldItems({
            remoteWorldDetail: {
                name: 'Image World',
                thumbnailImageUrl:
                    'https://api.vrchat.cloud/api/1/image/file_0a0a/1/256',
                imageUrl: 'https://example.test/full/256'
            }
        });

        expect(items).toEqual([
            expect.objectContaining({
                imageUrl: 'https://example.test/full/256',
                imageSmallUrl:
                    'https://api.vrchat.cloud/api/1/image/file_0a0a/1/128'
            })
        ]);
    });

    it('keeps full and compact image urls separate for local world cards', () => {
        const items = buildFavoriteLocalItemsByGroup({
            kind: 'world',
            localGroups: [
                {
                    key: 'Worlds',
                    label: 'Worlds'
                }
            ],
            localWorldFavorites: {
                Worlds: ['wrld_local']
            },
            worldDetailsById: {
                wrld_local: {
                    id: 'wrld_local',
                    name: 'Local World',
                    thumbnailImageUrl:
                        'https://api.vrchat.cloud/api/1/image/file_0b0b/1/256',
                    imageUrl: 'https://example.test/local-full/256'
                }
            },
            sortValue: 'date',
            t: (key: string) => key
        })['Worlds'];

        expect(items).toEqual([
            expect.objectContaining({
                imageUrl: 'https://example.test/local-full/256',
                imageSmallUrl:
                    'https://api.vrchat.cloud/api/1/image/file_0b0b/1/128'
            })
        ]);
    });

    it('uses occupants from the requested local world detail', () => {
        const items = buildFavoriteLocalItemsByGroup({
            kind: 'world',
            localGroups: [
                {
                    key: 'Worlds',
                    label: 'Worlds'
                }
            ],
            localWorldFavorites: {
                Worlds: ['wrld_local']
            },
            worldDetailsById: {
                wrld_local: {
                    id: 'wrld_local',
                    name: 'Local World',
                    occupants: 3
                }
            },
            sortValue: 'date',
            t: (key: string) => key
        })['Worlds'];

        expect(items).toEqual([
            expect.objectContaining({
                id: 'wrld_local',
                playerCount: 3
            })
        ]);
    });

    it('uses Rust-requested details for a local favorite missing baseline details', () => {
        const items = buildFavoriteLocalItemsByGroup({
            kind: 'world',
            localGroups: [{ key: 'Worlds', label: 'Worlds' }],
            localWorldFavorites: { Worlds: ['wrld_local'] },
            worldDetailsById: {
                wrld_local: {
                    id: 'wrld_local',
                    name: 'Rust World'
                }
            },
            sortValue: 'date',
            t: (key: string) => key
        })['Worlds'];

        expect(items).toEqual([
            expect.objectContaining({
                id: 'wrld_local',
                title: 'Rust World',
                isLoadingDetail: false
            })
        ]);
    });

    it('separates a local favorite still awaiting details from one the backend already resolved as gone', () => {
        const buildLocal = (
            worldAvailabilityById: Record<string, string | undefined>
        ) =>
            buildFavoriteLocalItemsByGroup({
                kind: 'world',
                localGroups: [{ key: 'Worlds', label: 'Worlds' }],
                localWorldFavorites: { Worlds: ['wrld_local'] },
                worldDetailsById: {},
                worldAvailabilityById,
                sortValue: 'date',
                t: (key: string) => key
            })['Worlds'];

        expect(buildLocal({})[0]?.isLoadingDetail).toBe(true);
        expect(buildLocal({ wrld_local: 'deleted' })[0]?.isLoadingDetail).toBe(
            false
        );
    });

    it('keeps full and compact image urls separate for avatar history cards', () => {
        const items = buildFavoriteAvatarHistoryItems({
            kind: 'avatar',
            avatarHistory: [
                {
                    id: 'avtr_history',
                    name: 'History Avatar',
                    thumbnailImageUrl:
                        'https://api.vrchat.cloud/api/1/image/file_0c0c/1/256',
                    imageUrl: 'https://example.test/history-full/256'
                }
            ],
            t: (key: string) => key
        });

        expect(items).toEqual([
            expect.objectContaining({
                imageUrl: 'https://example.test/history-full/256',
                imageSmallUrl:
                    'https://api.vrchat.cloud/api/1/image/file_0c0c/1/128'
            })
        ]);
    });
});
