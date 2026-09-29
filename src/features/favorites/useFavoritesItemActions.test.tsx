// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppToastOptions } from '@/services/toastService';

import type { FavoriteItem } from './favoritesTypes';

const mocks = vi.hoisted(() => ({
    boopPrompt: vi.fn(),
    clearAvatarHistory: vi.fn(),
    confirm: vi.fn(),
    selectAvatar: vi.fn(),
    sendInvite: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn()
}));

vi.mock('@/services/toastService', () => ({
    toast: {
        add: (options: AppToastOptions) => {
            switch (options.type) {
                case 'error':
                    return mocks.toastError(options);
                case 'success':
                    return mocks.toastSuccess(options);
                default:
                    throw new Error('Unhandled toast type: ' + options.type);
            }
        }
    }
}));

vi.mock('@/state/modalStore', () => ({
    useModalStore: (
        selector: (state: {
            boopPrompt: typeof mocks.boopPrompt;
            confirm: typeof mocks.confirm;
        }) => unknown
    ) =>
        selector({
            boopPrompt: mocks.boopPrompt,
            confirm: mocks.confirm
        })
}));

vi.mock('@/repositories/avatarLocalRepository', () => ({
    default: {
        clearAvatarHistory: mocks.clearAvatarHistory,
        getAvatarHistory: vi.fn()
    }
}));

vi.mock('@/repositories/favoritePersistenceRepository', () => ({
    default: { createLocalFavoriteGroup: vi.fn() }
}));

vi.mock('@/services/avatarSelectionService', () => ({
    selectAvatar: mocks.selectAvatar
}));

vi.mock('@/services/inviteDeliveryService', () => ({
    sendBoopToUser: vi.fn(),
    sendInviteToLocation: mocks.sendInvite,
    sendRequestInviteToUser: vi.fn()
}));

vi.mock('@/services/clipboardService', () => ({
    copyTextToClipboard: vi.fn()
}));
vi.mock('@/services/dialogService', () => ({ openWorldDialog: vi.fn() }));
vi.mock('@/services/directAccessService', () => ({
    tryOpenLaunchLocation: vi.fn()
}));
vi.mock('@/services/launchService', () => ({ selfInviteToInstance: vi.fn() }));

import { useFavoritesItemActions } from './useFavoritesItemActions';

const favoriteFriend: FavoriteItem = {
    key: 'friend:usr_friend',
    id: 'usr_friend',
    kind: 'friend',
    source: 'remote',
    title: 'Friend',
    seedData: {
        id: 'usr_friend',
        displayName: 'Friend'
    }
};

function renderActions(
    overrides: {
        kind?: 'friend' | 'world' | 'avatar';
        selectedSource?: 'remote' | 'local' | 'history';
    } = {}
) {
    const setAvatarHistory = vi.fn();
    const setSelectedGroupKey = vi.fn();
    const hook = renderHook(() =>
        useFavoritesItemActions({
            avatarHistoryLoading: false,
            canInviteFromCurrentLocation: true,
            currentInviteLocation: 'wrld_target:12345',
            currentUserId: 'usr_self',
            friendsById: {},
            friendsMap: new Map(),
            kind: overrides.kind ?? 'friend',
            localGroups: [],
            newLocalGroupName: '',
            refreshing: false,
            selectedContentItems: [],
            selectedSource: overrides.selectedSource ?? 'remote',
            setAvatarHistory,
            setAvatarHistoryLoading: vi.fn(),
            setCreatingLocalGroup: vi.fn(),
            setNewLocalGroupName: vi.fn(),
            setSelectedGroupKey,
            setSelectedSource: vi.fn()
        })
    );
    return { ...hook, setAvatarHistory, setSelectedGroupKey };
}

describe('useFavoritesItemActions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('keeps avatar history when destructive confirmation is cancelled', async () => {
        mocks.confirm.mockResolvedValue({ ok: false, reason: 'cancelled' });
        const rendered = renderActions({
            kind: 'avatar',
            selectedSource: 'history'
        });

        await act(async () =>
            rendered.result.current.handleAvatarHistoryClear()
        );

        expect(mocks.clearAvatarHistory).not.toHaveBeenCalled();
        expect(rendered.setAvatarHistory).not.toHaveBeenCalled();
        expect(rendered.setSelectedGroupKey).not.toHaveBeenCalled();
    });

    it('clears history state only after persistence succeeds', async () => {
        mocks.confirm.mockResolvedValue({ ok: true, value: undefined });
        mocks.clearAvatarHistory.mockResolvedValue(undefined);
        const rendered = renderActions({
            kind: 'avatar',
            selectedSource: 'history'
        });

        await act(async () =>
            rendered.result.current.handleAvatarHistoryClear()
        );

        expect(mocks.clearAvatarHistory).toHaveBeenCalledWith('usr_self');
        expect(rendered.setAvatarHistory).toHaveBeenCalledWith([]);
        expect(rendered.setSelectedGroupKey).toHaveBeenCalledWith('');
        expect(mocks.toastSuccess).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'success',
                title: 'view.favorite.success.avatar_history_cleared'
            })
        );
    });

    it('does not send an invite after the confirmation is cancelled', async () => {
        mocks.confirm.mockResolvedValue({ ok: false, reason: 'cancelled' });
        const { result } = renderActions();

        await act(async () =>
            result.current.sendFavoriteFriendInvite(favoriteFriend)
        );

        expect(mocks.confirm).toHaveBeenCalledOnce();
        expect(mocks.sendInvite).not.toHaveBeenCalled();
        expect(mocks.toastSuccess).not.toHaveBeenCalled();
    });

    it('does not report avatar selection success when VRChat rejects it', async () => {
        mocks.selectAvatar.mockResolvedValue({ applied: false });
        const { result } = renderActions({ kind: 'avatar' });

        await act(async () =>
            result.current.selectFavoriteAvatar({
                ...favoriteFriend,
                kind: 'avatar'
            })
        );

        expect(mocks.toastSuccess).not.toHaveBeenCalled();
        expect(mocks.toastError).not.toHaveBeenCalled();
    });
});
