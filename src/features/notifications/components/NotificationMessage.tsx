import type { NotificationRow } from '@/repositories/notificationPersistenceRepository';
import { openUserDialog } from '@/services/dialogService';
import { isUserId } from '@/shared/constants/vrchatIds';

export function NotificationMessage({
    notification,
    message
}: {
    notification: NotificationRow;
    message: string;
}) {
    const userId = notification.senderUserId?.trim();
    const name =
        typeof notification.data?.managerUserDisplayName === 'string'
            ? notification.data.managerUserDisplayName.trim()
            : notification.senderUsername?.trim() || '';
    const index = name ? message.indexOf(name) : -1;
    if (
        notification.type !== 'group.invite' ||
        !isUserId(userId) ||
        index < 0
    ) {
        return message;
    }

    return (
        <>
            {message.slice(0, index)}
            <button
                type="button"
                className="hover:text-foreground cursor-pointer text-left font-medium"
                onClick={() => openUserDialog({ userId, title: name })}
            >
                {name}
            </button>
            {message.slice(index + name.length)}
        </>
    );
}
