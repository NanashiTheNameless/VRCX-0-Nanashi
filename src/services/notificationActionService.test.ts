import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationActionOutcome } from '@/platform/tauri/bindings';

const mocks = vi.hoisted(() => ({
    queryNotifications: vi.fn(),
    expireNotification: vi.fn(),
    appSocialFriendRequestNotificationAccept: vi.fn(),
    appNotificationHideAndExpire: vi.fn(),
    appNotificationRequestInviteAccept: vi.fn(),
    appNotificationInviteResponseSend: vi.fn(),
    appNotificationBoopDismiss: vi.fn(),
    appNotificationBoopReply: vi.fn(),
    appNotificationRespondAndExpire: vi.fn(),
    recordRecentBoopEmoji: vi.fn()
}));

vi.mock('@/services/boopRecentService', () => ({
    recordRecentBoopEmoji: mocks.recordRecentBoopEmoji
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appSocialFriendRequestNotificationAccept:
            mocks.appSocialFriendRequestNotificationAccept,
        appNotificationHideAndExpire: mocks.appNotificationHideAndExpire,
        appNotificationRequestInviteAccept:
            mocks.appNotificationRequestInviteAccept,
        appNotificationInviteResponseSend:
            mocks.appNotificationInviteResponseSend,
        appNotificationBoopDismiss: mocks.appNotificationBoopDismiss,
        appNotificationBoopReply: mocks.appNotificationBoopReply,
        appNotificationRespondAndExpire: mocks.appNotificationRespondAndExpire
    }
}));

vi.mock('@/repositories/notificationPersistenceRepository', () => ({
    default: {
        queryNotifications: mocks.queryNotifications,
        expireNotification: mocks.expireNotification
    }
}));

const notification = {
    id: 'notif_target',
    version: 2,
    type: 'boop',
    senderUserId: 'usr_sender',
    senderUsername: 'Sender'
};

function outcome(
    overrides: Partial<NotificationActionOutcome> = {}
): NotificationActionOutcome {
    return {
        status: 'applied',
        expiredIds: [],
        sentPhoto: false,
        remoteError: null,
        localError: null,
        ...overrides
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((nextResolve) => {
        resolve = nextResolve;
    });
    return { promise, resolve };
}

describe('notificationActionService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.recordRecentBoopEmoji.mockResolvedValue(undefined);
        mocks.queryNotifications.mockResolvedValue([]);
        mocks.expireNotification.mockResolvedValue(undefined);
        mocks.appSocialFriendRequestNotificationAccept.mockResolvedValue({
            status: 'accepted',
            outcome: {
                status: 'applied',
                targetUserId: 'usr_sender'
            }
        });
        mocks.appNotificationHideAndExpire.mockResolvedValue(outcome());
        mocks.appNotificationRequestInviteAccept.mockResolvedValue(outcome());
        mocks.appNotificationInviteResponseSend.mockResolvedValue(outcome());
        mocks.appNotificationBoopDismiss.mockResolvedValue(outcome());
        mocks.appNotificationBoopReply.mockResolvedValue(outcome());
        mocks.appNotificationRespondAndExpire.mockResolvedValue(outcome());
    });

    it('sends a boop reply through the single backend chain command', async () => {
        mocks.appNotificationBoopReply.mockResolvedValue(
            outcome({ expiredIds: ['notif_previous', 'notif_target'] })
        );
        const { sendBoopReplyNotification } =
            await import('./notificationActionService');

        await sendBoopReplyNotification({
            currentUserId: 'usr_self',
            notification,
            emoji: {
                kind: 'default',
                id: 'default_hand_wave',
                imageUrl: 'https://wiki-files.vrchat.com/Handwave.webp',
                name: 'Hand Wave'
            }
        });

        expect(mocks.appNotificationBoopReply).toHaveBeenCalledWith({
            ownerUserId: 'usr_self',
            target: {
                id: 'notif_target',
                version: 2,
                type: 'boop',
                senderUserId: 'usr_sender'
            },
            emojiId: 'default_hand_wave',
            inventoryItemId: ''
        });
    });

    it('maps an inventory emoji reply onto inventoryItemId', async () => {
        mocks.appNotificationBoopReply.mockResolvedValue(outcome());
        const { sendBoopReplyNotification } =
            await import('./notificationActionService');

        await sendBoopReplyNotification({
            currentUserId: 'usr_self',
            notification,
            emoji: {
                kind: 'inventory',
                id: 'inv_miku',
                imageUrl: 'https://example.test/miku.png',
                name: 'Miku'
            }
        });

        expect(mocks.appNotificationBoopReply).toHaveBeenCalledWith(
            expect.objectContaining({
                emojiId: '',
                inventoryItemId: 'inv_miku'
            })
        );
        expect(mocks.recordRecentBoopEmoji).toHaveBeenCalledWith(
            expect.objectContaining({ kind: 'inventory', id: 'inv_miku' })
        );
    });

    it('surfaces a boop send failure reported by the backend chain', async () => {
        mocks.appNotificationBoopReply.mockResolvedValue(
            outcome({
                status: 'remoteFailed',
                expiredIds: ['notif_previous'],
                remoteError: 'send failed'
            })
        );
        const { sendBoopReplyNotification } =
            await import('./notificationActionService');

        await expect(
            sendBoopReplyNotification({
                currentUserId: 'usr_self',
                notification,
                emoji: {
                    kind: 'inventory',
                    id: 'inv_miku',
                    imageUrl: 'https://example.test/miku.png',
                    name: 'Miku'
                }
            })
        ).rejects.toThrow('send failed');
        expect(mocks.recordRecentBoopEmoji).not.toHaveBeenCalled();
    });

    it('dismisses boops for a sender through the backend command', async () => {
        const { dismissBoopNotifications } =
            await import('./notificationActionService');

        await dismissBoopNotifications({
            currentUserId: 'usr_self',
            senderUserId: 'usr_sender'
        });

        expect(mocks.appNotificationBoopDismiss).toHaveBeenCalledWith({
            ownerUserId: 'usr_self',
            senderUserId: 'usr_sender'
        });
    });

    it('skips the boop dismiss command without a sender user id', async () => {
        const { dismissBoopNotifications } =
            await import('./notificationActionService');

        await dismissBoopNotifications({
            currentUserId: 'usr_self',
            senderUserId: ' '
        });

        expect(mocks.appNotificationBoopDismiss).not.toHaveBeenCalled();
    });

    it('throws the remote error for a failed notification response', async () => {
        mocks.appNotificationRespondAndExpire.mockResolvedValue(
            outcome({ status: 'remoteFailed', remoteError: 'response failed' })
        );
        const { sendNotificationButtonResponse } =
            await import('./notificationActionService');

        await expect(
            sendNotificationButtonResponse({
                currentUserId: 'usr_self',
                notification,
                response: { type: 'accept', data: 'payload' }
            })
        ).rejects.toThrow('response failed');

        expect(mocks.appNotificationRespondAndExpire).toHaveBeenCalledWith({
            ownerUserId: 'usr_self',
            target: {
                id: 'notif_target',
                version: 2,
                type: 'boop',
                senderUserId: 'usr_sender'
            },
            responseType: 'accept',
            responseData: 'payload'
        });
    });

    it('treats an already-resolved response as success', async () => {
        mocks.appNotificationRespondAndExpire.mockResolvedValue(
            outcome({
                status: 'alreadyResolved',
                expiredIds: ['notif_target'],
                remoteError: 'not found (404)'
            })
        );
        const { sendNotificationButtonResponse } =
            await import('./notificationActionService');

        await expect(
            sendNotificationButtonResponse({
                currentUserId: 'usr_self',
                notification,
                response: { type: 'accept', data: 'payload' }
            })
        ).resolves.toBeUndefined();
    });

    it('does not swallow a remote-ok-local-failed hide outcome', async () => {
        mocks.appNotificationHideAndExpire.mockResolvedValue(
            outcome({
                status: 'remoteOkLocalFailed',
                localError: 'database failed'
            })
        );
        const { hideRemoteAndExpireNotification } =
            await import('./notificationActionService');

        await expect(
            hideRemoteAndExpireNotification({
                currentUserId: 'usr_self',
                notification
            })
        ).rejects.toThrow('database failed');
    });

    it('delegates invite-request acceptance and world resolution to the backend', async () => {
        const { acceptRequestInviteNotification } =
            await import('./notificationActionService');

        await acceptRequestInviteNotification({
            currentUserId: 'usr_self',
            notification,
            instanceId: 'wrld_1:1234',
            worldId: 'wrld_1'
        });

        expect(mocks.appNotificationRequestInviteAccept).toHaveBeenCalledWith({
            ownerUserId: 'usr_self',
            target: {
                id: 'notif_target',
                version: 2,
                type: 'boop',
                senderUserId: 'usr_sender'
            },
            instanceId: 'wrld_1:1234',
            worldId: 'wrld_1'
        });
    });

    it('wraps the photo invite response command in the upload timeout', async () => {
        const pending = deferred<NotificationActionOutcome>();
        mocks.appNotificationInviteResponseSend.mockReturnValue(
            pending.promise
        );
        const withUploadTimeout = vi.fn(
            (
                promise: Promise<NotificationActionOutcome>
            ): Promise<NotificationActionOutcome> => promise
        );
        const { sendInviteResponseNotification } =
            await import('./notificationActionService');

        const action = sendInviteResponseNotification({
            currentUserId: 'usr_self',
            notification,
            responseSlot: 1,
            imageData: 'base64data',
            withUploadTimeout
        });

        expect(withUploadTimeout).toHaveBeenCalledTimes(1);
        pending.resolve(outcome({ sentPhoto: true }));
        await expect(action).resolves.toEqual({ sentPhoto: true });
        expect(mocks.appNotificationInviteResponseSend).toHaveBeenCalledWith({
            ownerUserId: 'usr_self',
            target: {
                id: 'notif_target',
                version: 2,
                type: 'boop',
                senderUserId: 'usr_sender'
            },
            responseSlot: 1,
            imageData: 'base64data'
        });
    });

    it('sends a plain invite response without the upload timeout', async () => {
        const withUploadTimeout = vi.fn(
            (
                promise: Promise<NotificationActionOutcome>
            ): Promise<NotificationActionOutcome> => promise
        );
        const { sendInviteResponseNotification } =
            await import('./notificationActionService');

        await expect(
            sendInviteResponseNotification({
                currentUserId: 'usr_self',
                notification,
                responseSlot: 0,
                withUploadTimeout
            })
        ).resolves.toEqual({ sentPhoto: false });

        expect(withUploadTimeout).not.toHaveBeenCalled();
        expect(mocks.appNotificationInviteResponseSend).toHaveBeenCalledWith(
            expect.objectContaining({ responseSlot: 0, imageData: '' })
        );
    });

    it('accepts a friend request through one backend command using the sender username', async () => {
        const { acceptFriendRequestNotification } =
            await import('./notificationActionService');

        await expect(
            acceptFriendRequestNotification({
                notification
            })
        ).resolves.toEqual({
            status: 'accepted',
            outcome: { status: 'applied', targetUserId: 'usr_sender' }
        });

        expect(
            mocks.appSocialFriendRequestNotificationAccept
        ).toHaveBeenCalledWith({
            notificationId: 'notif_target',
            targetUserId: 'usr_sender',
            targetDisplayName: 'Sender'
        });
    });

    it('treats a missing remote friend request as resolved locally', async () => {
        mocks.appSocialFriendRequestNotificationAccept.mockResolvedValue({
            status: 'notFound',
            outcome: null
        });
        const { acceptFriendRequestNotification } =
            await import('./notificationActionService');

        await expect(
            acceptFriendRequestNotification({
                notification
            })
        ).resolves.toEqual({ status: 'not-found' });
    });

    it('rejects invalid action input before crossing the command boundary', async () => {
        const {
            expireNotificationLocally,
            findIncomingFriendRequestNotification,
            sendBoopReplyNotification
        } = await import('./notificationActionService');

        await expect(
            expireNotificationLocally({
                currentUserId: 'usr_self',
                notification: null
            })
        ).rejects.toThrow('Notification action requires a notification.');
        await expect(
            sendBoopReplyNotification({
                currentUserId: 'usr_self',
                notification: { id: 'notif_without_sender' }
            })
        ).rejects.toThrow('Cannot send boop: no sender user id is available.');
        await expect(
            findIncomingFriendRequestNotification({
                currentUserId: ' ',
                targetUserId: 'usr_sender'
            })
        ).resolves.toBeNull();

        expect(mocks.queryNotifications).not.toHaveBeenCalled();
        expect(mocks.expireNotification).not.toHaveBeenCalled();
        expect(mocks.appNotificationBoopReply).not.toHaveBeenCalled();
        expect(mocks.appNotificationInviteResponseSend).not.toHaveBeenCalled();
    });
});
