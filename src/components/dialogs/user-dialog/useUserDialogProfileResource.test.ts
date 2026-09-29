// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getFriendStatus: vi.fn(),
    getUserAppearanceProfile: vi.fn(),
    getUserProfile: vi.fn()
}));

vi.mock('@/repositories/userProfileRepository', async (importOriginal) => {
    const actual =
        await importOriginal<
            typeof import('@/repositories/userProfileRepository')
        >();
    return {
        ...actual,
        default: {
            ...actual.default,
            getFriendStatus: mocks.getFriendStatus,
            getUserAppearanceProfile: mocks.getUserAppearanceProfile,
            getUserProfile: mocks.getUserProfile
        }
    };
});

import {
    mergeLocalSnapshotIntoProfile,
    mergeUserDialogLocalSnapshot,
    useUserDialogProfileResource
} from './useUserDialogProfileResource';

describe('useUserDialogProfileResource', () => {
    beforeEach(() => {
        mocks.getFriendStatus.mockReset();
        mocks.getFriendStatus.mockResolvedValue({
            incomingRequest: false,
            isFriend: false,
            outgoingRequest: false
        });
        mocks.getUserAppearanceProfile.mockReset();
        mocks.getUserAppearanceProfile.mockResolvedValue({
            id: 'usr_target'
        });
        mocks.getUserProfile.mockReset();
        mocks.getUserProfile.mockResolvedValue({
            id: 'usr_target',
            displayName: 'Target'
        });
    });

    it('bypasses the user query cache whenever the current user dialog loads', async () => {
        renderHook(() =>
            useUserDialogProfileResource({
                currentEndpoint: 'https://api.vrchat.cloud/api/1',
                currentUserSnapshot: {
                    id: 'usr_target',
                    displayName: 'Target'
                },
                isTargetCurrentUser: true,
                localSnapshot: {
                    id: 'usr_target',
                    displayName: 'Target'
                },
                normalizedUserId: 'usr_target',
                updateEntityDialogMetadata: vi.fn()
            })
        );

        await waitFor(() => {
            expect(mocks.getFriendStatus).not.toHaveBeenCalled();
            expect(mocks.getUserAppearanceProfile).toHaveBeenCalledWith({
                userId: 'usr_target',
                asSelf: true
            });
            expect(mocks.getUserProfile).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 'usr_target',
                    force: true,
                    dialog: true
                })
            );
        });
    });

    it('keeps the initial user query cached for other user dialogs', async () => {
        renderHook(() =>
            useUserDialogProfileResource({
                currentEndpoint: 'https://api.vrchat.cloud/api/1',
                isTargetCurrentUser: false,
                localSnapshot: {
                    id: 'usr_target',
                    displayName: 'Target'
                },
                normalizedUserId: 'usr_target',
                updateEntityDialogMetadata: vi.fn()
            })
        );

        await waitFor(() => {
            expect(mocks.getFriendStatus).toHaveBeenCalledWith({
                userId: 'usr_target'
            });
            expect(mocks.getUserAppearanceProfile).toHaveBeenCalledWith({
                userId: 'usr_target',
                asSelf: false
            });
            expect(mocks.getUserProfile).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 'usr_target',
                    force: false,
                    dialog: true
                })
            );
        });
    });

    it('hydrates an outgoing friend request for the action menu', async () => {
        mocks.getFriendStatus.mockResolvedValue({
            incomingRequest: false,
            isFriend: false,
            outgoingRequest: true
        });

        const { result } = renderHook(() =>
            useUserDialogProfileResource({
                currentEndpoint: 'https://api.vrchat.cloud/api/1',
                isTargetCurrentUser: false,
                localSnapshot: {
                    id: 'usr_target',
                    displayName: 'Target'
                },
                normalizedUserId: 'usr_target',
                updateEntityDialogMetadata: vi.fn()
            })
        );

        await waitFor(() => {
            expect(result.current.loadStatus).toBe('ready');
            expect(result.current.profile).toEqual(
                expect.objectContaining({
                    incomingRequest: false,
                    isFriend: false,
                    outgoingRequest: true
                })
            );
        });
    });

    it('keeps the friend number after the remote profile finishes loading', async () => {
        mocks.getUserProfile.mockResolvedValue({
            id: 'usr_target',
            displayName: 'Target',
            $friendNumber: 0
        });

        const { result } = renderHook(() =>
            useUserDialogProfileResource({
                currentEndpoint: 'https://api.vrchat.cloud/api/1',
                isFriend: true,
                isTargetCurrentUser: false,
                localSnapshot: {
                    id: 'usr_target',
                    displayName: 'Target',
                    friendNumber: 42,
                    $friendNumber: 42
                },
                normalizedUserId: 'usr_target',
                updateEntityDialogMetadata: vi.fn()
            })
        );

        await waitFor(() => {
            expect(result.current.loadStatus).toBe('ready');
            expect(result.current.profile).toEqual(
                expect.objectContaining({
                    friendNumber: 42,
                    $friendNumber: 42
                })
            );
        });
    });

    it('merges appearance fields without overwriting ordinary user state', async () => {
        mocks.getUserProfile.mockResolvedValue({
            id: 'usr_target',
            displayName: 'Ordinary user',
            status: 'active',
            location: 'wrld_live:instance',
            iconFrame: 'invt_old'
        });
        mocks.getUserAppearanceProfile.mockResolvedValue({
            id: 'usr_target',
            displayName: 'Profile endpoint name',
            status: 'offline',
            location: 'offline',
            iconFrame: '',
            profileEffect: 'invt_profile'
        });

        const { result } = renderHook(() =>
            useUserDialogProfileResource({
                currentEndpoint: 'https://api.vrchat.cloud/api/1',
                isTargetCurrentUser: false,
                localSnapshot: {
                    id: 'usr_target',
                    displayName: 'Target'
                },
                normalizedUserId: 'usr_target',
                updateEntityDialogMetadata: vi.fn()
            })
        );

        await waitFor(() => {
            expect(result.current.loadStatus).toBe('ready');
            expect(result.current.profile).toEqual(
                expect.objectContaining({
                    displayName: 'Ordinary user',
                    status: 'active',
                    location: 'wrld_live:instance',
                    iconFrame: '',
                    profileEffect: 'invt_profile'
                })
            );
        });
    });

    it('keeps the ordinary user ready when the appearance request fails', async () => {
        mocks.getUserAppearanceProfile.mockRejectedValue(
            new Error('appearance unavailable')
        );

        const { result } = renderHook(() =>
            useUserDialogProfileResource({
                currentEndpoint: 'https://api.vrchat.cloud/api/1',
                isTargetCurrentUser: false,
                localSnapshot: {
                    id: 'usr_target',
                    displayName: 'Target'
                },
                normalizedUserId: 'usr_target',
                updateEntityDialogMetadata: vi.fn()
            })
        );

        await waitFor(() => {
            expect(result.current.loadStatus).toBe('ready');
            expect(result.current.profile?.displayName).toBe('Target');
        });
    });

    it('does not block the ordinary user while appearance is still loading', async () => {
        mocks.getUserAppearanceProfile.mockReturnValue(new Promise(() => {}));

        const { result } = renderHook(() =>
            useUserDialogProfileResource({
                currentEndpoint: 'https://api.vrchat.cloud/api/1',
                isTargetCurrentUser: false,
                localSnapshot: {
                    id: 'usr_target',
                    displayName: 'Target'
                },
                normalizedUserId: 'usr_target',
                updateEntityDialogMetadata: vi.fn()
            })
        );

        await waitFor(() => {
            expect(result.current.loadStatus).toBe('ready');
            expect(result.current.profile?.displayName).toBe('Target');
        });
    });

    it('keeps the current background until an appearance response changes it', async () => {
        let resolveAppearance:
            | ((value: {
                  id: string;
                  backgroundType: string;
                  backgroundTextureId: string;
              }) => void)
            | undefined;
        mocks.getUserAppearanceProfile.mockReturnValue(
            new Promise((resolve) => {
                resolveAppearance = resolve;
            })
        );
        mocks.getUserProfile.mockResolvedValue({
            id: 'usr_target',
            displayName: 'Remote Target',
            state: 'online',
            location: 'wrld_remote:instance'
        });
        const initialSnapshot: Record<string, unknown> = {
            id: 'usr_target',
            displayName: 'Target',
            state: 'online',
            location: 'wrld_local:instance',
            backgroundType: 'texture',
            backgroundTextureId: 'grid'
        };

        const { result, rerender } = renderHook(
            ({ snapshot }: { snapshot: Record<string, unknown> }) =>
                useUserDialogProfileResource({
                    currentEndpoint: 'https://api.vrchat.cloud/api/1',
                    currentUserSnapshot: snapshot,
                    isTargetCurrentUser: true,
                    localSnapshot: snapshot,
                    normalizedUserId: 'usr_target',
                    updateEntityDialogMetadata: vi.fn()
                }),
            {
                initialProps: {
                    snapshot: initialSnapshot
                }
            }
        );

        await waitFor(() => {
            expect(result.current.loadStatus).toBe('ready');
            expect(result.current.profile?.displayName).toBe('Remote Target');
        });
        expect(result.current.profile).toEqual(
            expect.objectContaining({
                backgroundType: 'texture',
                backgroundTextureId: 'grid'
            })
        );

        rerender({
            snapshot: {
                id: 'usr_target',
                displayName: 'Target',
                state: 'online',
                location: 'wrld_next:instance'
            }
        });

        await waitFor(() => {
            expect(result.current.profile?.location).toBe('wrld_next:instance');
        });
        expect(result.current.profile).toEqual(
            expect.objectContaining({
                backgroundType: 'texture',
                backgroundTextureId: 'grid'
            })
        );

        resolveAppearance?.({
            id: 'usr_target',
            backgroundType: 'default',
            backgroundTextureId: ''
        });
        await waitFor(() => {
            expect(result.current.profile).toEqual(
                expect.objectContaining({
                    backgroundType: 'default',
                    backgroundTextureId: ''
                })
            );
        });
    });
});

describe('mergeLocalSnapshotIntoProfile', () => {
    it('refreshes presence fields without erasing full profile fields', () => {
        const profile = {
            id: 'usr_target',
            displayName: 'Target',
            bio: 'Full profile bio',
            bioLinks: ['https://example.test'],
            date_joined: '2024-05-19',
            status: 'active',
            location: 'private'
        };
        const localSnapshot = {
            id: 'usr_target',
            displayName: 'Target',
            status: 'join me',
            location: 'wrld_live:12345',
            bio: '',
            date_joined: ''
        };

        expect(mergeLocalSnapshotIntoProfile(localSnapshot, profile)).toEqual({
            ...profile,
            status: 'join me',
            location: 'wrld_live:12345'
        });
    });

    it('does not clear profile presence with normalized empty snapshot defaults', () => {
        const profile = {
            id: 'usr_target',
            displayName: 'Target',
            bio: 'Full profile bio',
            status: 'active',
            location: 'wrld_profile:12345'
        };
        const localSnapshot = {
            id: 'usr_target',
            displayName: 'Target',
            status: '',
            location: ''
        };

        expect(mergeLocalSnapshotIntoProfile(localSnapshot, profile)).toEqual(
            profile
        );
    });

    it('keeps seed profile details when a friend snapshot provides fresher presence', () => {
        const seedData = {
            id: 'usr_target',
            displayName: 'Target',
            bio: 'Full profile bio',
            bioLinks: ['https://example.test'],
            date_joined: '2024-05-19',
            status: 'active',
            location: 'private'
        };
        const friendSnapshot = {
            id: 'usr_target',
            displayName: 'Target',
            status: 'join me',
            location: 'wrld_live:12345',
            bio: '',
            date_joined: ''
        };

        expect(
            mergeUserDialogLocalSnapshot({
                friendSnapshot,
                seedData,
                knownTargetUser: null
            })
        ).toEqual({
            ...seedData,
            status: 'join me',
            location: 'wrld_live:12345'
        });
    });

    it('fills an id-only seed from the known target without changing target identity', () => {
        const seedData = {
            id: 'usr_target',
            displayName: 'usr_target',
            location: 'private'
        };
        const knownTargetUser = {
            id: 'usr_target',
            displayName: 'Known Target',
            bio: 'Known profile bio',
            location: 'wrld_known:12345'
        };

        expect(
            mergeUserDialogLocalSnapshot({ seedData, knownTargetUser })
        ).toEqual({
            ...knownTargetUser,
            location: 'private'
        });
    });

    it('does not merge known data from a different target into the seed', () => {
        const seedData = {
            id: 'usr_seed',
            displayName: 'Seed'
        };
        const knownTargetUser = {
            id: 'usr_other',
            displayName: 'Other',
            bio: 'Other profile bio'
        };

        expect(
            mergeUserDialogLocalSnapshot({ seedData, knownTargetUser })
        ).toBe(seedData);
    });
});
