import {
    afterEach,
    beforeEach,
    describe,
    expect,
    expectTypeOf,
    it,
    vi
} from 'vitest';

const tauriMock = vi.hoisted(() => ({
    commands: {
        appVrchatCurrentUserUpdate: vi.fn(),
        appVrchatCurrentUserProfileUpdate: vi.fn(),
        appVrchatFriendStatusGet: vi.fn(),
        appVrchatUserProfileGet: vi.fn(),
        appVrchatUserGet: vi.fn(),
        appVrchatCurrentUserBadgeUpdate: vi.fn(),
        appUserMutualFriendsListGet: vi.fn()
    }
}));

vi.mock('@/platform/tauri/bindings', () => ({ commands: tauriMock.commands }));

import {
    clearEntityQueryCache,
    getCachedQueryData,
    queryKeys,
    setCachedQueryData
} from '@/lib/entityQueryCache';
import { DEFAULT_VRCHAT_API_ENDPOINT } from '@/shared/vrchatEndpoint';

import userProfileRepository from './userProfileRepository';

describe('UserProfileRepository', () => {
    afterEach(() => clearEntityQueryCache());
    beforeEach(() => {
        tauriMock.commands.appVrchatCurrentUserUpdate.mockReset();
        vi.mocked(
            tauriMock.commands.appVrchatCurrentUserProfileUpdate
        ).mockReset();
        vi.mocked(tauriMock.commands.appVrchatFriendStatusGet).mockReset();
        vi.mocked(tauriMock.commands.appVrchatUserProfileGet).mockReset();
        tauriMock.commands.appVrchatUserGet.mockReset();
        tauriMock.commands.appVrchatCurrentUserBadgeUpdate.mockReset();
        vi.mocked(tauriMock.commands.appUserMutualFriendsListGet).mockReset();
    });

    it('stores the normalized mutation result in the shared user query', async () => {
        const key = queryKeys.user('usr_current', DEFAULT_VRCHAT_API_ENDPOINT);
        setCachedQueryData(key, { badges: [{ badgeId: 'badge_one' }] });
        tauriMock.commands.appVrchatCurrentUserUpdate.mockResolvedValue({
            status: 200,
            data: JSON.stringify({
                id: 'usr_current',
                displayName: 'Current',
                tags: ['system_trust_basic']
            })
        });
        const user = await userProfileRepository.updateCurrentUser({
            userId: 'usr_current',
            params: { statusDescription: 'updated' }
        });
        expect(getCachedQueryData(key)).toEqual(user);
        expect(user).toMatchObject({
            statusDescription: 'updated',
            badges: [{ badgeId: 'badge_one' }],
            $trustClass: 'x-tag-basic'
        });
    });

    it('reads and normalizes the friend relationship status', async () => {
        vi.mocked(
            tauriMock.commands.appVrchatFriendStatusGet
        ).mockResolvedValue({
            status: 200,
            data: JSON.stringify({
                incomingRequest: false,
                isFriend: false,
                outgoingRequest: true
            })
        });

        await expect(
            userProfileRepository.getFriendStatus({ userId: ' usr_target ' })
        ).resolves.toEqual({
            incomingRequest: false,
            isFriend: false,
            outgoingRequest: true
        });
        expect(
            tauriMock.commands.appVrchatFriendStatusGet
        ).toHaveBeenCalledWith({ userId: 'usr_target' });
    });

    it('normalizes user profile defaults, trust metadata, moderator flags, and platform fallback', () => {
        expect(
            userProfileRepository.normalize({
                id: 'usr_123',
                displayName: 'User',
                tags: ['system_trust_trusted', 'admin_moderator'],
                developerType: 'none',
                platform: 'web',
                last_platform: 'android'
            })
        ).toMatchObject({
            id: 'usr_123',
            displayName: 'User',
            currentAvatarTags: [],
            $trustLevel: 'Known User',
            $trustClass: 'x-tag-trusted',
            $trustSortNum: 4.3,
            $isModerator: true,
            $isTroll: false,
            $isProbableTroll: false,
            $platform: 'android'
        });
    });

    it('keeps omitted profile fields absent while preserving explicit clears', () => {
        const user = userProfileRepository.normalize({ id: 'usr_target' });
        for (const field of [
            'bio',
            'bioLinks',
            'pronouns',
            'badges',
            'iconUrl'
        ]) {
            expect(user).not.toHaveProperty(field);
        }

        const cleared = {
            id: 'usr_target',
            bio: '',
            bioLinks: [],
            pronouns: '',
            badges: [],
            iconUrl: ''
        };
        expect(userProfileRepository.normalize(cleared)).toMatchObject(cleared);
    });

    it.each([
        { badges: [] },
        { badges: [{ badgeId: 'bdg_target', hidden: false, showcased: true }] }
    ])(
        'refreshes badges from the self profile after a badge mutation: %j',
        async ({ badges }) => {
            tauriMock.commands.appVrchatCurrentUserBadgeUpdate.mockResolvedValue(
                {
                    status: 200,
                    data: '{}'
                }
            );
            tauriMock.commands.appVrchatUserGet.mockResolvedValue({
                status: 200,
                data: JSON.stringify({
                    id: 'usr_target',
                    displayName: 'Target',
                    badges: [{ badgeId: 'bdg_stale' }]
                })
            });
            tauriMock.commands.appVrchatUserProfileGet.mockResolvedValue({
                status: 200,
                data: JSON.stringify({ id: 'usr_target', badges })
            });

            const result = await userProfileRepository.updateCurrentUserBadge({
                userId: 'usr_target',
                badgeId: 'bdg_target',
                showcased: true
            });

            expect(result).toMatchObject({
                id: 'usr_target',
                displayName: 'Target',
                badges
            });
            expect(
                tauriMock.commands.appVrchatUserProfileGet
            ).toHaveBeenCalledWith({
                userId: 'usr_target',
                asSelf: true
            });
        }
    );

    it('preserves optional, nullable, and nested profile fields from dialog data', () => {
        const profile = userProfileRepository.normalize({
            id: 'usr_redacted',
            ageVerificationStatus: 'hidden',
            ageVerified: false,
            accountDeletionDate: null,
            badges: [
                {
                    badgeId: 'bdg_redacted',
                    badgeName: 'Badge',
                    assignedAt: '2026-01-01T00:00:00.000Z',
                    hidden: false,
                    showcased: true
                }
            ],
            last_mobile: null,
            platform_history: [
                {
                    isMobile: false,
                    platform: 'standalonewindows',
                    recorded: '2026-01-01T00:00:00.000Z'
                }
            ],
            tags: ['system_trust_known'],
            $travelingToLocation: {
                worldId: 'wrld_redacted',
                instanceId: 'instance-redacted'
            }
        });

        expect(profile).toMatchObject({
            id: 'usr_redacted',
            ageVerificationStatus: 'hidden',
            ageVerified: false,
            accountDeletionDate: null,
            badges: [{ badgeId: 'bdg_redacted', showcased: true }],
            last_mobile: null,
            platform_history: [{ platform: 'standalonewindows' }],
            $travelingToLocation: { worldId: 'wrld_redacted' },
            $trustLevel: 'User'
        });
    });

    it('preserves typed profile appearance fields from current profile responses', () => {
        const profile = userProfileRepository.normalize({
            id: 'usr_redacted',
            backgroundGradientBottom: '',
            backgroundGradientTop: '',
            backgroundTemplateId: '',
            backgroundTextureId: '',
            backgroundType: 'default',
            bannerColor: '2cc968',
            bannerCustomUrl: 'https://example.test/banner.png',
            hasVrcPlus: true,
            iconFrame: 'invt_frame',
            iconType: '',
            nameplateEffect: 'invt_nameplate',
            profileEffect: 'invt_profile',
            themeId: 'default',
            themes: []
        });

        expect(profile).toMatchObject({
            backgroundType: 'default',
            bannerColor: '2cc968',
            iconFrame: 'invt_frame',
            nameplateEffect: 'invt_nameplate',
            profileEffect: 'invt_profile',
            themeId: 'default'
        });
        expectTypeOf(profile).toMatchTypeOf<{
            backgroundGradientBottom?: string;
            backgroundGradientTop?: string;
            backgroundTemplateId?: string;
            backgroundTextureId?: string;
            backgroundType?: string;
            bannerColor?: string;
            bannerCustomUrl?: string;
            hasVrcPlus?: boolean;
            iconFrame?: string;
            iconType?: string;
            nameplateEffect?: string;
            profileEffect?: string;
            themeId?: string;
            themes?: unknown[];
        }>();

        expect(
            userProfileRepository.normalize({
                iconFrame: '',
                nameplateEffect: '',
                profileEffect: ''
            })
        ).toMatchObject({
            iconFrame: '',
            nameplateEffect: '',
            profileEffect: ''
        });
    });

    it('reads public and self appearance profiles without normalizing their partial payloads', async () => {
        const publicProfile = {
            id: 'usr_target',
            backgroundType: 'default',
            iconFrame: '',
            profileEffect: 'invt_profile'
        };
        const selfProfile = {
            id: 'usr_target',
            backgroundGradientBottom: '',
            bannerColor: '2cc968',
            nameplateEffect: ''
        };
        vi.mocked(tauriMock.commands.appVrchatUserProfileGet)
            .mockResolvedValueOnce({
                status: 200,
                data: JSON.stringify(publicProfile)
            })
            .mockResolvedValueOnce({
                status: 200,
                data: JSON.stringify(selfProfile)
            });

        await expect(
            userProfileRepository.getUserAppearanceProfile({
                userId: ' usr_target '
            })
        ).resolves.toEqual(publicProfile);
        await expect(
            userProfileRepository.getUserAppearanceProfile({
                userId: 'usr_target',
                asSelf: true
            })
        ).resolves.toEqual(selfProfile);

        expect(
            tauriMock.commands.appVrchatUserProfileGet
        ).toHaveBeenNthCalledWith(1, {
            userId: 'usr_target',
            asSelf: false
        });
        expect(
            tauriMock.commands.appVrchatUserProfileGet
        ).toHaveBeenNthCalledWith(2, {
            userId: 'usr_target',
            asSelf: true
        });
        expect(publicProfile).toHaveProperty('iconFrame', '');
        expect(selfProfile).toHaveProperty('nameplateEffect', '');
        expect(publicProfile).not.toHaveProperty('$trustLevel');
    });

    it('rejects appearance profile reads without a user id', async () => {
        await expect(
            userProfileRepository.getUserAppearanceProfile({ userId: ' ' })
        ).rejects.toThrow(
            'UserProfileRepository.getUserAppearanceProfile requires a user id.'
        );
        expect(
            tauriMock.commands.appVrchatUserProfileGet
        ).not.toHaveBeenCalled();
    });

    it('updates the authenticated user profile background', async () => {
        const responseProfile = {
            id: 'usr_target',
            backgroundType: 'texture',
            backgroundTextureId: 'grid'
        };
        vi.mocked(
            tauriMock.commands.appVrchatCurrentUserProfileUpdate
        ).mockResolvedValueOnce({
            status: 200,
            data: JSON.stringify(responseProfile)
        });

        await expect(
            userProfileRepository.updateCurrentUserProfile({
                expectedUserId: ' usr_target ',
                params: {
                    backgroundType: 'texture',
                    backgroundTextureId: 'grid'
                }
            })
        ).resolves.toEqual(responseProfile);
        expect(
            tauriMock.commands.appVrchatCurrentUserProfileUpdate
        ).toHaveBeenCalledWith({
            params: {
                backgroundType: 'texture',
                backgroundTextureId: 'grid'
            }
        });
    });

    it('rejects profile background updates without a user id', async () => {
        await expect(
            userProfileRepository.updateCurrentUserProfile({
                expectedUserId: ' ',
                params: { backgroundType: 'default' }
            })
        ).rejects.toThrow(
            'UserProfileRepository.updateCurrentUserProfile requires a user id.'
        );
        expect(
            tauriMock.commands.appVrchatCurrentUserProfileUpdate
        ).not.toHaveBeenCalled();
    });

    it('strips the default robot avatar image so it resolves as unknown, not "Robot"', () => {
        const robotImage =
            'https://api.vrchat.cloud/api/1/file/file_0e8c4e32-7444-44ea-ade4-313c010d4bae/1/file';
        expect(
            userProfileRepository.normalize({
                id: 'usr_robot',
                currentAvatarImageUrl: robotImage,
                currentAvatarThumbnailImageUrl: robotImage
            })
        ).toMatchObject({
            currentAvatarImageUrl: '',
            currentAvatarThumbnailImageUrl: ''
        });

        const realImage =
            'https://api.vrchat.cloud/api/1/file/file_real-avatar/1/file';
        expect(
            userProfileRepository.normalize({
                id: 'usr_real',
                currentAvatarImageUrl: realImage,
                currentAvatarThumbnailImageUrl: realImage
            })
        ).toMatchObject({
            currentAvatarImageUrl: realImage,
            currentAvatarThumbnailImageUrl: realImage
        });
    });

    it('treats troll and probable-troll tags as trust sorting modifiers', () => {
        expect(
            userProfileRepository.normalize({
                tags: ['system_trust_basic', 'system_probable_troll']
            })
        ).toMatchObject({
            $trustLevel: 'New User',
            $isTroll: false,
            $isProbableTroll: true,
            $trustSortNum: 2.1
        });

        expect(
            userProfileRepository.normalize({
                tags: [
                    'system_trust_known',
                    'system_troll',
                    'system_probable_troll'
                ]
            })
        ).toMatchObject({
            $trustLevel: 'User',
            $isTroll: true,
            $isProbableTroll: false,
            $trustSortNum: 3.1
        });
    });

    it('loads the backend-collected mutual friend list', async () => {
        vi.mocked(
            tauriMock.commands.appUserMutualFriendsListGet
        ).mockResolvedValue({
            rows: [
                { id: 'usr_mutual', futureField: 'keep' },
                null,
                { displayName: 'Missing id' }
            ],
            persisted: true
        });

        const result = await userProfileRepository.getAllMutualFriends({
            userId: 'usr_target'
        });

        expect(
            tauriMock.commands.appUserMutualFriendsListGet
        ).toHaveBeenCalledWith({
            userId: 'usr_target'
        });
        expect(result).toEqual({
            rows: [{ id: 'usr_mutual', futureField: 'keep' }],
            persisted: true
        });
        expect(
            getCachedQueryData(
                queryKeys.userMutualFriends(
                    'usr_target',
                    DEFAULT_VRCHAT_API_ENDPOINT
                )
            )
        ).toEqual([{ id: 'usr_mutual', futureField: 'keep' }]);
    });

    it('keeps at most three mutual friend requests in flight and skips aborted ones', async () => {
        const pending: Array<() => void> = [];
        let inFlight = 0;
        let maxInFlight = 0;
        vi.mocked(
            tauriMock.commands.appUserMutualFriendsListGet
        ).mockImplementation(() => {
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            return new Promise((resolve) => {
                pending.push(() => {
                    inFlight -= 1;
                    resolve({ rows: [], persisted: false });
                });
            });
        });
        const aborted = new AbortController();
        const settled = Promise.allSettled([
            ...['usr_1', 'usr_2', 'usr_3', 'usr_4'].map((userId) =>
                userProfileRepository.getAllMutualFriends({ userId })
            ),
            userProfileRepository.getAllMutualFriends({
                userId: 'usr_aborted',
                signal: aborted.signal
            })
        ]);
        aborted.abort();

        while (pending.length) {
            await Promise.resolve();
            pending.shift()?.();
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        const results = await settled;

        expect(maxInFlight).toBe(3);
        expect(
            tauriMock.commands.appUserMutualFriendsListGet
        ).toHaveBeenCalledTimes(4);
        expect(results.map((result) => result.status)).toEqual([
            'fulfilled',
            'fulfilled',
            'fulfilled',
            'fulfilled',
            'rejected'
        ]);
    });
});
