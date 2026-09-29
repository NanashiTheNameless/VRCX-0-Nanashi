// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import avatarProfileRepository from '@/repositories/avatarProfileRepository';

import { useAvatarDetailFallbacks } from './useAvatarDetailFallbacks';

vi.mock('@/repositories/avatarProfileRepository', () => ({
    default: {
        getAvatarProfile: vi.fn()
    }
}));

function cachedAvatar(id: string, name: string) {
    return {
        id,
        authorId: 'usr_author',
        authorName: 'Cache Author',
        created_at: '2026-06-01T00:00:00.000Z',
        description: 'Cached description',
        imageUrl: 'https://example.test/image.png',
        name,
        releaseStatus: 'private',
        thumbnailImageUrl: 'https://example.test/thumb.png',
        updated_at: '2026-06-02T00:00:00.000Z',
        version: 1,
        tags: [],
        unityPackages: [],
        $isCached: true,
        $memo: '',
        $tags: [],
        $timeSpent: 0
    };
}

const AVATAR_IDS = ['avtr_remote', 'avtr_missing'];
const REMOTE_DETAILS = { avtr_remote: { name: 'Remote Avatar' } };

describe('useAvatarDetailFallbacks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(avatarProfileRepository.getAvatarProfile).mockResolvedValue(
            cachedAvatar('avtr_missing', 'DB Missing Avatar')
        );
    });

    it('loads cached details only for favorite avatars without remote detail', async () => {
        const { result } = renderHook(() =>
            useAvatarDetailFallbacks({
                avatarIds: AVATAR_IDS,
                kind: 'avatar',
                remoteEntityDetailsData: REMOTE_DETAILS,
                remoteEntityDetailsStatus: 'ready'
            })
        );

        await waitFor(() => {
            expect(result.current).toMatchObject({
                avtr_missing: {
                    name: 'DB Missing Avatar',
                    releaseStatus: 'private'
                }
            });
        });
        expect(avatarProfileRepository.getAvatarProfile).toHaveBeenCalledOnce();
        expect(avatarProfileRepository.getAvatarProfile).toHaveBeenCalledWith({
            avatarId: 'avtr_missing'
        });
    });

    it.each([
        ['avatar', 'running'],
        ['world', 'ready']
    ] as const)(
        'does not search the avatar cache for a %s page with %s remote details',
        (kind, remoteEntityDetailsStatus) => {
            const { result } = renderHook(() =>
                useAvatarDetailFallbacks({
                    avatarIds: AVATAR_IDS,
                    kind,
                    remoteEntityDetailsData: REMOTE_DETAILS,
                    remoteEntityDetailsStatus
                })
            );

            expect(result.current).toEqual({});
            expect(
                avatarProfileRepository.getAvatarProfile
            ).not.toHaveBeenCalled();
        }
    );
});
