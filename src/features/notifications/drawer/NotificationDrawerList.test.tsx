// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NotificationCategories } from '@/state/vrcNotificationStore';

import { NotificationDrawerList } from './NotificationDrawerList';

afterEach(cleanup);

describe('NotificationDrawerList', () => {
    it('shows the full notification history link when the drawer is empty', () => {
        const categories: NotificationCategories = {
            friend: { unseen: [], recent: [] },
            group: { unseen: [], recent: [] },
            other: { unseen: [], recent: [] }
        };
        const onNavigateToTable = vi.fn();

        render(
            <NotificationDrawerList
                categories={categories}
                canInviteFromCurrentLocation={false}
                handlers={{
                    onAcceptFriendRequest: vi.fn(),
                    onAcceptRequestInvite: vi.fn(),
                    onDeleteNotification: vi.fn(),
                    onHideNotification: vi.fn(),
                    onIgnoreNotificationLocally: vi.fn(),
                    onJoinQueueReady: vi.fn(),
                    onMarkSeen: vi.fn(),
                    onSendInviteResponseWithMessage: vi.fn(),
                    onSendNotificationResponse: vi.fn()
                }}
                onNavigateToTable={onNavigateToTable}
            />
        );

        expect(
            screen.getByText(
                'side_panel.notification_center.no_new_notifications'
            )
        ).toBeTruthy();

        fireEvent.click(
            screen.getByRole('button', {
                name: 'side_panel.notification_center.view_more'
            })
        );
        expect(onNavigateToTable).toHaveBeenCalledTimes(1);
    });
});
