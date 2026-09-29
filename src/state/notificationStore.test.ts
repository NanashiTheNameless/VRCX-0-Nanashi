import { afterEach, describe, expect, it } from 'vitest';

import { useNotificationStore } from './notificationStore';

afterEach(() => {
    useNotificationStore.getState().resetNotificationState();
});

describe('pushNotification', () => {
    it('shows the newest toast first, so the most recent event is always what the user sees on top', () => {
        useNotificationStore.getState().pushNotification({ title: 'First' });
        useNotificationStore.getState().pushNotification({ title: 'Second' });

        const { items } = useNotificationStore.getState();
        expect(items.map((item) => item.title)).toEqual(['Second', 'First']);
    });

    it('starts a pushed notification as unread, so it counts toward the unread badge until the user sees it', () => {
        useNotificationStore.getState().pushNotification({ title: 'New' });
        expect(useNotificationStore.getState().items[0].read).toBe(false);
    });

    it('caps the notification history at 50 entries, so a burst of events cannot leak memory or make the panel unusably long', () => {
        for (let i = 0; i < 55; i += 1) {
            useNotificationStore
                .getState()
                .pushNotification({ title: `Notification ${i}` });
        }

        const { items } = useNotificationStore.getState();
        expect(items).toHaveLength(50);
        expect(items[0].title).toBe('Notification 54');
    });
});

describe('markAllRead / dismissNotification', () => {
    it('marks every notification read at once, e.g. for a "mark all as read" action', () => {
        useNotificationStore.getState().pushNotification({ title: 'A' });
        useNotificationStore.getState().pushNotification({ title: 'B' });

        useNotificationStore.getState().markAllRead();

        expect(
            useNotificationStore
                .getState()
                .items.every((item) => item.read === true)
        ).toBe(true);
    });

    it('removes a dismissed notification from the list entirely', () => {
        useNotificationStore.getState().pushNotification({ title: 'A' });
        const target = useNotificationStore.getState().items[0];

        useNotificationStore.getState().dismissNotification(target.id);

        expect(useNotificationStore.getState().items).toHaveLength(0);
    });
});

describe('setPanelOpen', () => {
    it('marks every notification as read when the panel is closed after being open, since the user has now seen them', () => {
        useNotificationStore.getState().pushNotification({ title: 'A' });
        useNotificationStore.getState().setPanelOpen(true);

        useNotificationStore.getState().setPanelOpen(false);

        expect(
            useNotificationStore
                .getState()
                .items.every((item) => item.read === true)
        ).toBe(true);
    });

    it('does not touch read state just from opening the panel, only from closing it', () => {
        useNotificationStore.getState().pushNotification({ title: 'A' });

        useNotificationStore.getState().setPanelOpen(true);

        expect(useNotificationStore.getState().items[0].read).toBe(false);
    });

    it('does not re-trigger the mark-all-read side effect when the panel was already closed', () => {
        useNotificationStore.getState().pushNotification({ title: 'A' });

        useNotificationStore.getState().setPanelOpen(false);

        const [unreadStillUnread] = useNotificationStore.getState().items;
        expect(unreadStillUnread.read).toBe(false);
    });
});

describe('resetNotificationState', () => {
    it('clears the notification history and panel state, used on logout so the next account starts clean', () => {
        useNotificationStore.getState().pushNotification({ title: 'A' });
        useNotificationStore.getState().setPanelOpen(true);

        useNotificationStore.getState().resetNotificationState();

        expect(useNotificationStore.getState().items).toEqual([]);
        expect(useNotificationStore.getState().isPanelOpen).toBe(false);
    });
});
