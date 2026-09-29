// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NotificationRow as NotificationRecord } from '@/repositories/notificationPersistenceRepository';
import { openGroupDialog, openUserDialog } from '@/services/dialogService';

import {
    NotificationRow,
    type NotificationFeedHandlers
} from './components/NotificationRow';
import { NotificationDrawerRow } from './drawer/NotificationDrawerRow';

vi.mock('./useNotificationActorImage', () => ({
    useNotificationActorImage: () => ''
}));

vi.mock('@/services/dialogService', () => ({
    openUserDialog: vi.fn(),
    openGroupDialog: vi.fn()
}));

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

function friendRequest(): NotificationRecord {
    return {
        id: 'notif_friend_request',
        type: 'friendRequest',
        version: 1,
        senderUserId: 'usr_sender',
        senderUsername: 'Sender',
        seen: false,
        created_at: '2026-08-05T00:00:00.000Z',
        responses: []
    };
}

function actionHandlers() {
    return {
        onAcceptFriendRequest: vi.fn(),
        onAcceptRequestInvite: vi.fn(),
        onHideNotification: vi.fn(),
        onMarkSeen: vi.fn(),
        onSendInviteResponseWithMessage: vi.fn(),
        onSendNotificationResponse: vi.fn()
    };
}

describe('group invite notification rows', () => {
    it.each(['page', 'drawer'] as const)(
        'opens the inviter profile separately from the group in the %s',
        (surface) => {
            const userId = 'usr_00000000-0000-0000-0000-000000000001';
            const notification: NotificationRecord = {
                id: 'not_group_invite',
                type: 'group.invite',
                version: 2,
                senderUserId: userId,
                message: 'Maple has invited you to Maple Club!',
                title: 'Group invitation',
                link: 'group:grp_club',
                data: {
                    managerUserDisplayName: 'Maple',
                    groupName: 'Maple Club',
                    groupId: 'grp_club'
                }
            };
            const handlers = {
                ...actionHandlers(),
                onDeleteNotification: vi.fn(),
                onOpenImagePreview: vi.fn(),
                onOpenLink: vi.fn(),
                onJoinQueueReady: vi.fn()
            };
            render(
                surface === 'page' ? (
                    <NotificationRow
                        notification={notification}
                        canInviteFromCurrentLocation={false}
                        handlers={handlers}
                    />
                ) : (
                    <NotificationDrawerRow
                        notification={notification}
                        isUnseen
                        canInviteFromCurrentLocation={false}
                        handlers={handlers}
                    />
                )
            );

            fireEvent.click(screen.getByRole('button', { name: 'Maple' }));
            expect(openUserDialog).toHaveBeenCalledExactlyOnceWith({
                userId,
                title: 'Maple'
            });
            expect(openGroupDialog).not.toHaveBeenCalled();

            fireEvent.click(
                screen.getByText(
                    surface === 'page' ? 'Maple Club' : 'Group invitation'
                )
            );
            expect(openGroupDialog).toHaveBeenCalledWith({
                groupId: 'grp_club',
                title: 'Group invitation'
            });
        }
    );
});

describe('friend request notification rows', () => {
    it('renders mark seen as the third action in the notification page row', () => {
        const handlers: NotificationFeedHandlers = {
            ...actionHandlers(),
            onDeleteNotification: vi.fn(),
            onOpenImagePreview: vi.fn(),
            onOpenLink: vi.fn()
        };

        render(
            <NotificationRow
                notification={friendRequest()}
                currentUserId="usr_self"
                canInviteFromCurrentLocation={false}
                handlers={handlers}
            />
        );

        const actionButtons = screen
            .getAllByRole('button')
            .filter((button) =>
                [
                    'view.notification.actions.accept',
                    'view.notification.actions.decline',
                    'view.notification.action.mark_seen'
                ].includes(button.textContent || '')
            );
        expect(actionButtons.map((button) => button.textContent)).toEqual([
            'view.notification.actions.accept',
            'view.notification.actions.decline',
            'view.notification.action.mark_seen'
        ]);

        fireEvent.click(actionButtons[2]);
        expect(handlers.onMarkSeen).toHaveBeenCalledTimes(1);
    });
});
