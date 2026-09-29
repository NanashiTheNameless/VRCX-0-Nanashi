import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appAvatarGet: vi.fn(),
    appAvatarFindByImageUrl: vi.fn(),
    appVrchatAvatarSelect: vi.fn(),
    appVrchatAvatarSelectFallback: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appAvatarGet: mocks.appAvatarGet,
        appAvatarFindByImageUrl: mocks.appAvatarFindByImageUrl,
        appVrchatAvatarSelect: mocks.appVrchatAvatarSelect,
        appVrchatAvatarSelectFallback: mocks.appVrchatAvatarSelectFallback
    }
}));

import { queryClient } from '@/lib/queryClient';

import avatarProfileRepository from './avatarProfileRepository';

beforeEach(() => {
    vi.resetAllMocks();
    queryClient.clear();
});

describe('AvatarProfileRepository', () => {
    it.each([
        {
            options: {},
            expected: { avatarId: 'avtr_policy', full: false, fresh: false }
        },
        {
            options: { dialog: true },
            expected: { avatarId: 'avtr_policy', full: true, fresh: false }
        },
        {
            options: { force: true },
            expected: { avatarId: 'avtr_policy', full: true, fresh: true }
        }
    ])(
        'delegates avatar freshness policy to Rust: $expected',
        async ({ options, expected }) => {
            mocks.appAvatarGet.mockResolvedValue({
                id: 'avtr_policy',
                name: 'Policy Avatar'
            });

            await expect(
                avatarProfileRepository.getAvatarProfile({
                    avatarId: 'avtr_policy',
                    ...options
                })
            ).resolves.toMatchObject({
                id: 'avtr_policy',
                name: 'Policy Avatar'
            });

            expect(mocks.appAvatarGet).toHaveBeenCalledWith(expected);
        }
    );

    it('normalizes the stable avatar fields while preserving nullable metadata', () => {
        const avatar = avatarProfileRepository.normalize({
            id: 'avtr_redacted',
            name: 'Avatar',
            acknowledgements: null,
            attribution: null,
            authorId: 'usr_redacted',
            authorName: 'Author',
            created_at: '2026-01-01T00:00:00.000Z',
            listingDate: null,
            styles: { primary: 'classic', secondary: 'expressive' },
            unityPackages: [
                {
                    id: 'unp_redacted',
                    platform: 'standalonewindows',
                    variant: 'security'
                }
            ],
            updated_at: '2026-01-02T00:00:00.000Z'
        });

        expect(avatar).toMatchObject({
            id: 'avtr_redacted',
            acknowledgements: null,
            attribution: null,
            listingDate: null,
            styles: { primary: 'classic', secondary: 'expressive' },
            unityPackages: [
                { platform: 'standalonewindows', variant: 'security' }
            ],
            $tags: [],
            $timeSpent: 0,
            $memo: '',
            $isCached: false
        });
    });

    it('applies local snapshot metadata during normalization', () => {
        const avatar = avatarProfileRepository.normalize(
            {
                id: ' avtr_local ',
                authorId: ' usr_author '
            },
            {
                cachedAvatar: true,
                localTags: [
                    { tag: ' favorite ', color: ' #123456 ' },
                    { tag: '', color: 'ignored' }
                ],
                timeSpent: 42,
                memo: ' local memo '
            }
        );

        expect(avatar).toMatchObject({
            id: 'avtr_local',
            authorId: 'usr_author',
            authorName: 'usr_author',
            $tags: [{ tag: 'favorite', color: '#123456' }],
            $timeSpent: 42,
            $memo: ' local memo ',
            $isCached: true
        });
    });

    it('finds one persisted avatar by image URL without listing the avatar table', async () => {
        mocks.appAvatarFindByImageUrl.mockResolvedValue({
            id: 'avtr_image',
            name: 'Image Avatar'
        });

        await expect(
            avatarProfileRepository.findAvatarByImageUrl(
                ' https://example.test/file/file_image/1/file '
            )
        ).resolves.toMatchObject({
            id: 'avtr_image',
            name: 'Image Avatar'
        });

        expect(mocks.appAvatarFindByImageUrl).toHaveBeenCalledWith(
            'https://example.test/file/file_image/1/file'
        );
    });

    it('returns current-user selection responses', async () => {
        const currentUser = {
            id: 'usr_self',
            currentAvatar: 'avtr_selected'
        };
        mocks.appVrchatAvatarSelect.mockResolvedValue({
            applied: true,
            response: {
                status: 200,
                data: JSON.stringify(currentUser)
            }
        });
        mocks.appVrchatAvatarSelectFallback.mockResolvedValue({
            applied: true,
            response: {
                status: 200,
                data: JSON.stringify(currentUser)
            }
        });

        await expect(
            avatarProfileRepository.selectAvatar({
                avatarId: ' avtr_selected '
            })
        ).resolves.toMatchObject({ applied: true, json: currentUser });
        await expect(
            avatarProfileRepository.selectFallbackAvatar({
                avatarId: ' avtr_selected '
            })
        ).resolves.toMatchObject({ applied: true, json: currentUser });

        expect(mocks.appVrchatAvatarSelect).toHaveBeenCalledWith({
            avatarId: 'avtr_selected'
        });
        expect(mocks.appVrchatAvatarSelectFallback).toHaveBeenCalledWith({
            avatarId: 'avtr_selected'
        });
    });
});
