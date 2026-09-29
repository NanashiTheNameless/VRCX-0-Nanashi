// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppToastOptions } from '@/services/toastService';

const mocks = vi.hoisted(() => ({
    acceptIncoming: vi.fn(),
    appSocialFriendRequestCancel: vi.fn(),
    appSocialFriendRequestSend: vi.fn(),
    bumpRevision: vi.fn(),
    findIncoming: vi.fn(),
    hideIncoming: vi.fn(),
    notifyMenu: vi.fn(),
    toastError: vi.fn(),
    toastInfo: vi.fn(),
    toastSuccess: vi.fn(),
    toastWarning: vi.fn()
}));

vi.mock('@/services/toastService', () => ({
    toast: {
        add: (options: AppToastOptions) => {
            switch (options.type) {
                case 'error':
                    return mocks.toastError(options);
                case 'info':
                    return mocks.toastInfo(options);
                case 'success':
                    return mocks.toastSuccess(options);
                case 'warning':
                    return mocks.toastWarning(options);
                default:
                    throw new Error('Unhandled toast type: ' + options.type);
            }
        }
    }
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appSocialFriendRequestCancel: mocks.appSocialFriendRequestCancel,
        appSocialFriendRequestSend: mocks.appSocialFriendRequestSend
    }
}));

vi.mock('@/services/notificationActionService', () => ({
    acceptFriendRequestNotification: mocks.acceptIncoming,
    dismissBoopNotifications: vi.fn(),
    expireNotificationLocally: vi.fn(),
    findIncomingFriendRequestNotification: mocks.findIncoming,
    hideRemoteAndExpireNotification: mocks.hideIncoming
}));

vi.mock('@/services/recentActionService', () => ({
    recordRecentAction: vi.fn()
}));

vi.mock('@/services/friendLogMutationService', () => ({
    signalFriendLogChanged: () => {
        mocks.bumpRevision();
        mocks.notifyMenu('friend-log');
    }
}));

vi.mock('./useUserInviteActions', () => ({
    useUserInviteActions: () => ({
        handleInviteMessageDialogOpenChange: vi.fn(),
        inviteMessageRequest: null,
        selectInviteMessage: vi.fn(),
        sendUserInvite: vi.fn(),
        sendUserInviteRequest: vi.fn()
    })
}));

vi.mock('./useUserModerationActions', () => ({
    useUserModerationActions: () => ({
        setAvatarOverrideModeration: vi.fn(),
        setExtendedUserModeration: vi.fn(),
        setUserModeration: vi.fn()
    })
}));

import { useUserDialogActions } from './useUserDialogActions';

type HookProps = Parameters<typeof useUserDialogActions>[0];
type HookValue = ReturnType<typeof useUserDialogActions>;

function HookHarness({
    onValue,
    props
}: {
    onValue: (value: HookValue) => void;
    props: HookProps;
}) {
    onValue(useUserDialogActions(props));
    return null;
}

function createProps(): HookProps {
    return {
        actionStatusRef: { current: 'idle' },
        activeUserTargetRef: {
            current: {
                userId: 'usr_target',
                endpoint: 'https://api.vrchat.cloud/api/1'
            }
        },
        avatarOverrideState: { hideAvatar: false, showAvatar: false },
        canInviteFromCurrentLocation: false,
        confirm: vi.fn().mockResolvedValue({ ok: true }),
        currentEndpoint: 'https://api.vrchat.cloud/api/1',
        currentInviteLocation: null,
        currentUserId: 'usr_self',
        friendsById: {},
        isCurrentUser: false,
        isFriend: false,
        normalizedCurrentUserId: 'usr_self',
        normalizedUserId: 'usr_target',
        moderationRevisionRef: { current: 0 },
        moderationState: { block: false, mute: false },
        openNonce: 1,
        profile: { id: 'usr_target', displayName: 'Target' },
        setActionStatus: vi.fn(),
        setAvatarOverrideState: vi.fn(),
        setBaseProfile: vi.fn(),
        setExtendedModerationState: vi.fn(),
        setModerationState: vi.fn()
    };
}

describe('useUserDialogActions friend request mutations', () => {
    let current: HookValue | null;
    let props: HookProps;

    beforeEach(() => {
        vi.clearAllMocks();
        current = null;
        props = createProps();
        mocks.appSocialFriendRequestCancel.mockResolvedValue({
            status: 'applied',
            targetUserId: 'usr_target'
        });
        mocks.appSocialFriendRequestSend.mockResolvedValue({
            status: 'applied',
            targetUserId: 'usr_target'
        });
        mocks.findIncoming.mockResolvedValue(null);
        render(
            <HookHarness
                onValue={(value) => {
                    current = value;
                }}
                props={props}
            />
        );
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    function actions() {
        if (!current) {
            throw new Error('Hook value is unavailable.');
        }
        return current.actions;
    }

    it('sends an outgoing request through the backend command even when the dialog target changes before the response', async () => {
        mocks.appSocialFriendRequestSend.mockImplementation(async () => {
            props.activeUserTargetRef.current = {
                userId: 'usr_other',
                endpoint: props.currentEndpoint
            };
            return { status: 'applied', targetUserId: 'usr_target' };
        });

        await act(() => actions().updateFriendRequest('send'));

        expect(mocks.appSocialFriendRequestSend).toHaveBeenCalledWith({
            targetUserId: 'usr_target',
            targetDisplayName: 'Target'
        });
        expect(mocks.bumpRevision).toHaveBeenCalledTimes(1);
    });

    it('cancels an outgoing request through the backend command', async () => {
        await act(() => actions().updateFriendRequest('cancel'));

        expect(mocks.appSocialFriendRequestCancel).toHaveBeenCalledWith({
            targetUserId: 'usr_target',
            targetDisplayName: 'Target'
        });
        expect(mocks.bumpRevision).toHaveBeenCalledTimes(1);
    });

    it('accepts and declines an incoming request through its notification instead of the cancel command', async () => {
        const notification = { id: 'frq_incoming' };
        mocks.findIncoming.mockResolvedValue(notification);
        mocks.acceptIncoming.mockResolvedValue({
            status: 'accepted',
            outcome: { status: 'applied', targetUserId: 'usr_target' }
        });

        await act(() => actions().updateFriendRequest('accept'));

        expect(mocks.acceptIncoming).toHaveBeenCalledWith({
            notification,
            targetUser: props.profile
        });

        await act(() => actions().updateFriendRequest('decline'));

        expect(mocks.hideIncoming).toHaveBeenCalledWith({
            currentUserId: 'usr_self',
            notification
        });
        expect(mocks.appSocialFriendRequestCancel).not.toHaveBeenCalled();
    });

    it('does not signal a friend-log change when the remote request fails', async () => {
        mocks.appSocialFriendRequestSend.mockRejectedValue(
            new Error('remote failed')
        );

        await act(() => actions().updateFriendRequest('send'));

        expect(mocks.bumpRevision).not.toHaveBeenCalled();
        expect(mocks.toastError).toHaveBeenCalled();
    });

    it('keeps a successful remote action successful but warns when the local update fails', async () => {
        mocks.appSocialFriendRequestSend.mockResolvedValue({
            status: 'remoteOkLocalFailed',
            targetUserId: 'usr_target',
            localError: 'database failed'
        });

        await act(() => actions().updateFriendRequest('send'));

        expect(mocks.toastWarning).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'warning',
                title: 'dialog.user.toast.applied_on_vrchat_but_local_update_failed'
            })
        );
        expect(mocks.toastSuccess).not.toHaveBeenCalled();
        expect(mocks.toastError).not.toHaveBeenCalled();
    });
});
