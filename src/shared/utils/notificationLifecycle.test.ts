import { describe, expect, it } from 'vitest';

import { getNotificationLifecycleBucket } from './notificationLifecycle';

describe('getNotificationLifecycleBucket', () => {
    it('groups notifications that need a user decision into the action bucket, shown first in the notification center', () => {
        expect(getNotificationLifecycleBucket('friendRequest')).toBe('action');
        expect(getNotificationLifecycleBucket('invite')).toBe('action');
        expect(getNotificationLifecycleBucket('group.invite')).toBe('action');
        expect(getNotificationLifecycleBucket('group.joinRequest')).toBe(
            'action'
        );
    });

    it("groups replies to the user's own past requests into the activity bucket, shown after pending actions", () => {
        expect(getNotificationLifecycleBucket('inviteResponse')).toBe(
            'activity'
        );
        expect(getNotificationLifecycleBucket('message')).toBe('activity');
    });

    it('falls unrecognized or purely informational notification types into the system bucket, shown last', () => {
        expect(getNotificationLifecycleBucket('votekick')).toBe('system');
        expect(getNotificationLifecycleBucket(undefined)).toBe('system');
        expect(getNotificationLifecycleBucket('')).toBe('system');
    });
});
