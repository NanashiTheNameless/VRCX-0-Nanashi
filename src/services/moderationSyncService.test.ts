import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeState = vi.hoisted(() => ({
    commands: {
        appModerationSyncRefresh: vi.fn(),
        appModerationSyncUpdate: vi.fn()
    }
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: runtimeState.commands
}));

import {
    refreshModerationSync,
    subscribeModerationSyncChanges,
    updateModerationSync
} from './moderationSyncService';

describe('moderationSyncService', () => {
    beforeEach(() => {
        runtimeState.commands.appModerationSyncRefresh.mockReset();
        runtimeState.commands.appModerationSyncUpdate.mockReset();
    });

    it('notifies subscribers with the refreshed owner after a refresh', async () => {
        runtimeState.commands.appModerationSyncRefresh.mockResolvedValue({
            userId: 'usr_current'
        });
        const listener = vi.fn();
        const unsubscribe = subscribeModerationSyncChanges(listener);

        await refreshModerationSync({ userId: 'usr_current', endpoint: '' });
        unsubscribe();

        expect(listener).toHaveBeenCalledWith({ ownerUserId: 'usr_current' });
    });

    it('notifies subscribers with the mutation owner after an update', async () => {
        runtimeState.commands.appModerationSyncUpdate.mockResolvedValue({
            ownerUserId: 'usr_current'
        });
        const listener = vi.fn();
        const unsubscribe = subscribeModerationSyncChanges(listener);

        await updateModerationSync({
            targetUserId: 'usr_target',
            type: 'block',
            enabled: false
        });
        unsubscribe();

        expect(listener).toHaveBeenCalledWith({ ownerUserId: 'usr_current' });
    });

    it('does not notify subscribers when the backend command fails', async () => {
        const error = new Error('Missing Credentials');
        runtimeState.commands.appModerationSyncRefresh.mockRejectedValue(error);
        runtimeState.commands.appModerationSyncUpdate.mockRejectedValue(error);
        const listener = vi.fn();
        const unsubscribe = subscribeModerationSyncChanges(listener);

        await expect(
            refreshModerationSync({ userId: 'usr_current', endpoint: '' })
        ).rejects.toBe(error);
        await expect(
            updateModerationSync({
                targetUserId: 'usr_target',
                type: 'block',
                enabled: false
            })
        ).rejects.toBe(error);
        unsubscribe();

        expect(listener).not.toHaveBeenCalled();
    });

    it('stops notifying a subscriber after it unsubscribes', async () => {
        runtimeState.commands.appModerationSyncRefresh.mockResolvedValue({
            userId: 'usr_current'
        });
        const listener = vi.fn();
        subscribeModerationSyncChanges(listener)();

        await refreshModerationSync({ userId: 'usr_current', endpoint: '' });

        expect(listener).not.toHaveBeenCalled();
    });
});
