import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/events/preferenceEvents', () => ({
    publishPreferenceChanged: vi.fn()
}));

vi.mock('./configRepository', () => ({
    default: {
        getBool: vi.fn(),
        getString: vi.fn(),
        setString: vi.fn(),
        setBool: vi.fn(),
        setMany: vi.fn(),
        has: vi.fn(),
        remove: vi.fn()
    }
}));

vi.mock('./externalApiRepository', () => ({
    default: {
        searchAvatarProvider: vi.fn()
    }
}));

vi.mock('./avatarProfileRepository', () => ({
    default: {
        normalize: vi.fn()
    }
}));

import { publishPreferenceChanged } from '@/shared/events/preferenceEvents';

import avatarProfileRepository from './avatarProfileRepository';
import avatarSearchProviderRepository from './avatarSearchProviderRepository';
import configRepository from './configRepository';
import externalApiRepository from './externalApiRepository';

const AVTRDB_PROVIDER = 'https://api.avtrdb.com/v3/avatar/search/vrcx';
type ConfigFallback = string | number | boolean | null;
type NormalizedAvatar = { id: string };

describe('AvatarSearchProviderRepository', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(configRepository.getBool).mockResolvedValue(true);
        vi.mocked(configRepository.getString).mockImplementation(
            (_key: string, fallback: ConfigFallback = '') =>
                Promise.resolve(String(fallback ?? ''))
        );
        vi.mocked(configRepository.setString).mockResolvedValue(null);
        vi.mocked(configRepository.setBool).mockResolvedValue(null);
        vi.mocked(configRepository.setMany).mockResolvedValue(undefined);
        vi.mocked(configRepository.has).mockResolvedValue(true);
        vi.mocked(configRepository.remove).mockResolvedValue(0);
        vi.mocked(externalApiRepository.searchAvatarProvider).mockResolvedValue(
            {
                status: 200,
                data: '[]',
                raw: []
            }
        );
        vi.mocked(avatarProfileRepository.normalize).mockImplementation(
            (avatarInput: unknown) => {
                const avatar = (avatarInput ?? {}) as Record<string, unknown>;
                return {
                    ...avatar,
                    id: String(avatar.id ?? ''),
                    name: String(avatar.name ?? ''),
                    description: '',
                    authorId: String(avatar.authorId ?? ''),
                    authorName: String(avatar.authorName ?? ''),
                    releaseStatus: String(avatar.releaseStatus ?? 'public'),
                    thumbnailImageUrl: String(avatar.thumbnailImageUrl ?? ''),
                    imageUrl: String(avatar.imageUrl ?? ''),
                    created_at:
                        typeof avatar.created_at === 'string'
                            ? avatar.created_at
                            : '',
                    updated_at:
                        typeof avatar.updated_at === 'string'
                            ? avatar.updated_at
                            : '',
                    version: 0,
                    tags: [],
                    unityPackages: [],
                    $tags: [],
                    $timeSpent: 0,
                    $memo: '',
                    $isCached: false,
                    normalized: true
                };
            }
        );
    });

    it('normalizes legacy provider lists and preserves a selected custom provider', async () => {
        const customProvider = 'https://avatars.example.test/search';
        const selectedProvider = 'https://selected.example.test/search';
        vi.mocked(configRepository.getString).mockImplementation(
            (key: string, fallback: ConfigFallback = '') => {
                if (key === 'VRCX_avatarRemoteDatabaseProviderList') {
                    return Promise.resolve(
                        JSON.stringify([
                            'https://api.avtrdb.com/v1/avatar/search/vrcx',
                            customProvider,
                            'https://avtr.just-h.party/vrcx_search.php',
                            customProvider
                        ])
                    );
                }
                if (key === 'VRCX_avatarRemoteDatabaseProvider') {
                    return Promise.resolve(selectedProvider);
                }
                return Promise.resolve(String(fallback ?? ''));
            }
        );

        await expect(
            avatarSearchProviderRepository.getConfig()
        ).resolves.toEqual({
            enabled: true,
            providerList: [AVTRDB_PROVIDER, customProvider, selectedProvider],
            selectedProvider,
            disabledProviders: [],
            activeProviders: [AVTRDB_PROVIDER, customProvider, selectedProvider]
        });

        expect(configRepository.setString).toHaveBeenCalledWith(
            'VRCX_avatarRemoteDatabaseProviderList',
            JSON.stringify([AVTRDB_PROVIDER, customProvider, selectedProvider])
        );
    });

    it('does not remove the stored selected-provider key while reading config, so the selection cannot be wiped back to the default on the next read', async () => {
        const selectedProvider = 'https://selected.example.test/search';
        vi.mocked(configRepository.getString).mockImplementation(
            (key: string, fallback: ConfigFallback = '') => {
                if (key === 'VRCX_avatarRemoteDatabaseProviderList') {
                    return Promise.resolve(
                        JSON.stringify([AVTRDB_PROVIDER, selectedProvider])
                    );
                }
                if (key === 'VRCX_avatarRemoteDatabaseProvider') {
                    return Promise.resolve(selectedProvider);
                }
                return Promise.resolve(String(fallback ?? ''));
            }
        );

        const config = await avatarSearchProviderRepository.getConfig();

        expect(config.selectedProvider).toBe(selectedProvider);
        expect(configRepository.remove).not.toHaveBeenCalled();
    });

    it('builds provider search requests and deduplicates normalized avatar ids', async () => {
        vi.mocked(configRepository.getString).mockImplementation(
            (key: string, fallback: ConfigFallback = '') => {
                if (key === 'id') {
                    return Promise.resolve('client-id');
                }
                return Promise.resolve(String(fallback ?? ''));
            }
        );
        vi.mocked(externalApiRepository.searchAvatarProvider).mockResolvedValue(
            {
                status: 200,
                data: JSON.stringify([
                    {
                        Id: 'avtr_alpha',
                        Name: 'Alpha',
                        AuthorName: 'Creator A',
                        image_url: 'https://cdn.example.test/alpha.png'
                    },
                    {
                        _id: 'avtr_alpha',
                        Name: 'Duplicate Alpha'
                    },
                    {
                        avatarId: 'avtr_beta',
                        author_id: 'usr_beta',
                        CreatedAt: '2024-01-01T00:00:00Z',
                        updatedAt: '2024-01-02T00:00:00Z'
                    }
                ]),
                raw: { provider: true }
            }
        );

        const result = await avatarSearchProviderRepository.search({
            provider: ' https://avatars.example.test/search ',
            query: ' alpha '
        });

        const request = vi.mocked(externalApiRepository.searchAvatarProvider)
            .mock.calls[0][0];
        const url = new URL(request.url);
        expect(`${url.origin}${url.pathname}`).toBe(
            'https://avatars.example.test/search'
        );
        expect(url.searchParams.get('search')).toBe('alpha');
        expect(url.searchParams.get('n')).toBe('5000');
        expect(request).toMatchObject({
            vrcxId: 'client-id'
        });
        expect(avatarProfileRepository.normalize).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                id: 'avtr_alpha',
                name: 'Alpha',
                authorName: 'Creator A',
                imageUrl: 'https://cdn.example.test/alpha.png',
                releaseStatus: 'public'
            })
        );
        expect(result).toMatchObject({
            provider: 'https://avatars.example.test/search',
            query: 'alpha',
            status: 200,
            raw: { provider: true }
        });
        expect(
            (result.avatars as NormalizedAvatar[]).map((avatar) => avatar.id)
        ).toEqual(['avtr_alpha', 'avtr_beta']);
    });

    it('persists the default provider list when no provider list is configured', async () => {
        vi.mocked(configRepository.has).mockResolvedValue(false);

        await expect(
            avatarSearchProviderRepository.getConfig()
        ).resolves.toMatchObject({
            enabled: true,
            providerList: [AVTRDB_PROVIDER],
            selectedProvider: AVTRDB_PROVIDER
        });

        expect(configRepository.setString).toHaveBeenCalledWith(
            'VRCX_avatarRemoteDatabaseProviderList',
            JSON.stringify([AVTRDB_PROVIDER])
        );
    });

    it('validates provider and English-equivalent query length', async () => {
        await expect(
            avatarSearchProviderRepository.search({
                provider: '',
                query: 'avatar'
            })
        ).rejects.toThrow('Avatar provider is not configured');
        await expect(
            avatarSearchProviderRepository.search({
                provider: AVTRDB_PROVIDER,
                query: 'ab'
            })
        ).rejects.toThrow('3 English characters');
        await expect(
            avatarSearchProviderRepository.search({
                provider: AVTRDB_PROVIDER,
                query: '你好'
            })
        ).resolves.toMatchObject({
            query: '你好',
            status: 200
        });

        expect(
            externalApiRepository.searchAvatarProvider
        ).toHaveBeenCalledTimes(1);
    });

    it('publishes normalized config after saving provider preferences', async () => {
        await expect(
            avatarSearchProviderRepository.saveConfig({
                enabled: true,
                providerList: [
                    'https://api.avtrdb.com/v2/avatar/search/vrcx',
                    'https://custom.example.test/search',
                    'https://custom.example.test/search'
                ],
                selectedProvider: ''
            })
        ).resolves.toEqual({
            enabled: true,
            providerList: [
                AVTRDB_PROVIDER,
                'https://custom.example.test/search'
            ],
            selectedProvider: AVTRDB_PROVIDER,
            disabledProviders: [],
            activeProviders: [
                AVTRDB_PROVIDER,
                'https://custom.example.test/search'
            ]
        });

        expect(configRepository.setMany).toHaveBeenCalledWith([
            [
                'VRCX_avatarRemoteDatabaseProviderList',
                JSON.stringify([
                    AVTRDB_PROVIDER,
                    'https://custom.example.test/search'
                ])
            ],
            ['VRCX_avatarRemoteDatabase', 'true'],
            ['VRCX_avatarRemoteDatabaseProvider', AVTRDB_PROVIDER]
        ]);
        expect(publishPreferenceChanged).toHaveBeenCalledWith(
            'VRCX_avatarRemoteDatabaseProviderList',
            {
                enabled: true,
                providerList: [
                    AVTRDB_PROVIDER,
                    'https://custom.example.test/search'
                ],
                selectedProvider: AVTRDB_PROVIDER,
                disabledProviders: [],
                activeProviders: [
                    AVTRDB_PROVIDER,
                    'https://custom.example.test/search'
                ]
            }
        );
    });

    it('searches every provider in parallel and merges duplicate avatars', async () => {
        vi.mocked(
            externalApiRepository.searchAvatarProvider
        ).mockImplementation(async ({ url }: { url: string }) => {
            const avatars = url.startsWith('https://a.example.test')
                ? [
                      { id: 'avtr_shared', name: 'Shared', authorName: '' },
                      { id: 'avtr_only_a', name: 'Only A' }
                  ]
                : [
                      {
                          id: 'avtr_shared',
                          name: 'Other Name',
                          authorName: 'Author From B'
                      },
                      { id: 'avtr_only_b', name: 'Only B' }
                  ];
            return { status: 200, data: JSON.stringify(avatars), raw: '' };
        });

        const result = await avatarSearchProviderRepository.search({
            providers: [
                'https://a.example.test/search',
                'https://b.example.test/search'
            ],
            query: 'avatar'
        });

        expect(
            (result.avatars as NormalizedAvatar[]).map((avatar) => avatar.id)
        ).toEqual(['avtr_shared', 'avtr_only_a', 'avtr_only_b']);
        const shared = result.avatars[0] as NormalizedAvatar & {
            authorName?: string;
            name?: string;
        };
        expect(shared.name).toBe('Shared');
        expect(shared.authorName).toBe('Author From B');
    });

    it('keeps results from working providers when another provider fails', async () => {
        vi.mocked(
            externalApiRepository.searchAvatarProvider
        ).mockImplementation(async ({ url }: { url: string }) =>
            url.startsWith('https://down.example.test')
                ? { status: 500, data: '', raw: '' }
                : {
                      status: 200,
                      data: JSON.stringify([{ id: 'avtr_ok', name: 'Ok' }]),
                      raw: ''
                  }
        );

        const result = await avatarSearchProviderRepository.search({
            providers: [
                'https://down.example.test/search',
                'https://up.example.test/search'
            ],
            query: 'avatar'
        });

        expect(
            (result.avatars as NormalizedAvatar[]).map((avatar) => avatar.id)
        ).toEqual(['avtr_ok']);
    });
});
