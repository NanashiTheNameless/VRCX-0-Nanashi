import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appTakePendingDesktopNotificationActivation:
        vi.fn<
            () => Promise<
                | import('@/platform/tauri/bindings').DesktopNotificationActivation
                | null
            >
        >(),
    eventHandlers: new Map<string, () => void>(),
    openGroupDialog: vi.fn(),
    openUserDialog: vi.fn(),
    openWorldDialog: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appTakePendingDesktopNotificationActivation:
            mocks.appTakePendingDesktopNotificationActivation
    }
}));

vi.mock('@/platform/tauri/client', () => ({
    tauriClient: {
        events: {
            subscribe: mocks.subscribe
        }
    }
}));

vi.mock('./dialogService', () => ({
    openGroupDialog: mocks.openGroupDialog,
    openUserDialog: mocks.openUserDialog,
    openWorldDialog: mocks.openWorldDialog
}));

import {
    bindDesktopNotificationActivationEvents,
    takePendingDesktopNotificationActivation
} from './desktopNotificationActivationService';

const USER_ID = 'usr_12345678-1234-1234-1234-1234567890ab';
const GROUP_ID = 'grp_abcdefab-cdef-abcd-efab-cdefabcdefab';

describe('desktopNotificationActivationService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.eventHandlers.clear();
        mocks.appTakePendingDesktopNotificationActivation.mockResolvedValue(
            null
        );
        mocks.subscribe.mockImplementation(
            async (name: string, handler: () => void) => {
                mocks.eventHandlers.set(name, handler);
                return mocks.unsubscribe;
            }
        );
    });

    it('subscribes to activation wake events and takes the pending target', async () => {
        const unbind = await bindDesktopNotificationActivationEvents();
        mocks.appTakePendingDesktopNotificationActivation.mockResolvedValueOnce(
            { target: { kind: 'openUserProfile', userId: USER_ID } }
        );

        mocks.eventHandlers.get('desktopNotificationActivated')?.();

        await vi.waitFor(() => {
            expect(mocks.openUserDialog).toHaveBeenCalledWith({
                userId: USER_ID
            });
        });
        unbind();
        expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    });

    it('opens the instance a clicked place points at', async () => {
        const location =
            'wrld_12345678-1234-1234-1234-1234567890ab:12345~region(jp)';
        mocks.appTakePendingDesktopNotificationActivation.mockResolvedValueOnce(
            { target: { kind: 'openLocation', location } }
        );

        await takePendingDesktopNotificationActivation();

        expect(mocks.openWorldDialog).toHaveBeenCalledWith({
            worldId: location
        });
        expect(mocks.openUserDialog).not.toHaveBeenCalled();
    });

    it('opens a canonical pending user profile only once', async () => {
        mocks.appTakePendingDesktopNotificationActivation
            .mockResolvedValueOnce({
                target: { kind: 'openUserProfile', userId: USER_ID }
            })
            .mockResolvedValueOnce(null);

        await takePendingDesktopNotificationActivation();
        await takePendingDesktopNotificationActivation();

        expect(mocks.openUserDialog).toHaveBeenCalledOnce();
        expect(mocks.openUserDialog).toHaveBeenCalledWith({ userId: USER_ID });
    });

    it('ignores an invalid user id returned across the IPC boundary', async () => {
        mocks.appTakePendingDesktopNotificationActivation.mockResolvedValueOnce(
            {
                target: {
                    kind: 'openUserProfile',
                    userId: 'usr_invalid'
                }
            }
        );

        await takePendingDesktopNotificationActivation();

        expect(mocks.openUserDialog).not.toHaveBeenCalled();
    });

    it('opens the group dialog for a saved-group instance notification', async () => {
        mocks.appTakePendingDesktopNotificationActivation.mockResolvedValueOnce(
            {
                target: {
                    kind: 'openGroupProfile',
                    groupId: GROUP_ID
                }
            }
        );

        await takePendingDesktopNotificationActivation();

        expect(mocks.openGroupDialog).toHaveBeenCalledWith({
            groupId: GROUP_ID
        });
        expect(mocks.openUserDialog).not.toHaveBeenCalled();
    });
});
