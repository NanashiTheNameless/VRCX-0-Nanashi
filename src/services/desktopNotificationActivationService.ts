import { commands } from '@/platform/tauri/bindings';
import { tauriClient } from '@/platform/tauri/client';
import { isGroupId, isUserId } from '@/shared/constants/vrchatIds';

import {
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from './dialogService';

const DESKTOP_NOTIFICATION_ACTIVATED_EVENT = 'desktopNotificationActivated';

export async function bindDesktopNotificationActivationEvents(): Promise<
    () => void
> {
    return tauriClient.events.subscribe(
        DESKTOP_NOTIFICATION_ACTIVATED_EVENT,
        () => {
            takePendingDesktopNotificationActivation().catch(
                logDesktopNotificationActivationFailure
            );
        }
    );
}

export async function takePendingDesktopNotificationActivation(): Promise<void> {
    const activation =
        await commands.appTakePendingDesktopNotificationActivation();
    if (!activation) {
        return;
    }
    if (activation.target.kind === 'openUserProfile') {
        if (!isUserId(activation.target.userId)) {
            console.warn(
                'Ignored desktop notification activation with invalid user id:',
                activation.target.userId
            );
            return;
        }
        openUserDialog({ userId: activation.target.userId });
        return;
    }
    if (activation.target.kind === 'openLocation') {
        openWorldDialog({ worldId: activation.target.location });
        return;
    }
    if (!isGroupId(activation.target.groupId)) {
        console.warn(
            'Ignored desktop notification activation with invalid group id:',
            activation.target.groupId
        );
        return;
    }
    openGroupDialog({ groupId: activation.target.groupId });
}

function logDesktopNotificationActivationFailure(error: unknown): void {
    console.warn(
        'Failed to take pending desktop notification activation:',
        error
    );
}
