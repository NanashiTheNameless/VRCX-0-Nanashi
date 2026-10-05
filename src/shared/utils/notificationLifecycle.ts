export type NotificationLifecycleBucket = 'action' | 'activity' | 'system';

export const NOTIFICATION_LIFECYCLE_ORDER: NotificationLifecycleBucket[] = [
    'action',
    'activity',
    'system'
];

const ACTION_TYPES = new Set<string>([
    'friendRequest',
    'invite',
    'requestInvite',
    'boop',
    'group.invite',
    'group.joinRequest',
    'group.transfer',
    'group.queueReady'
]);

const ACTIVITY_TYPES = new Set<string>([
    'inviteResponse',
    'requestInviteResponse',
    'message',
    'ignoredFriendRequest'
]);

const LOCALLY_IGNORABLE_TYPES = new Set<string>(['invite', 'requestInvite']);

export function canIgnoreNotificationLocally(
    type: string | null | undefined
): boolean {
    return LOCALLY_IGNORABLE_TYPES.has(type ?? '');
}

export function getNotificationLifecycleBucket(
    type: string | null | undefined
): NotificationLifecycleBucket {
    const normalized = type ?? '';
    if (ACTION_TYPES.has(normalized)) {
        return 'action';
    }
    if (ACTIVITY_TYPES.has(normalized)) {
        return 'activity';
    }
    return 'system';
}
