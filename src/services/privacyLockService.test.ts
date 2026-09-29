import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commands, type PrivacyLockSnapshot } from '@/platform/tauri/bindings';
import { usePrivacyLockDialogStore } from '@/state/privacyLockDialogStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { requestPrivacyLock, unlockPrivacyLock } from './privacyLockService';

vi.mock('@/platform/tauri/bindings', async () =>
    (await import('@/test/mockCommands')).mockBindingsModule()
);

function snapshot(patch: Partial<PrivacyLockSnapshot>): PrivacyLockSnapshot {
    return {
        revision: 1,
        userId: 'usr_self',
        locked: false,
        hasPassword: false,
        ...patch
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    useRuntimeStore.getState().resetRuntimeState();
    usePrivacyLockDialogStore.setState({
        open: false,
        engageAfterSetup: false
    });
});

describe('requestPrivacyLock', () => {
    it('locks right away when a lock password is already set', async () => {
        useRuntimeStore
            .getState()
            .setPrivacyLock(snapshot({ hasPassword: true }));
        vi.mocked(commands.appPrivacyLockEngage).mockResolvedValue({
            status: 'ok',
            snapshot: snapshot({ revision: 2, hasPassword: true, locked: true })
        });

        await requestPrivacyLock();

        expect(commands.appPrivacyLockEngage).toHaveBeenCalledOnce();
        expect(useRuntimeStore.getState().privacyLock.locked).toBe(true);
        expect(usePrivacyLockDialogStore.getState().open).toBe(false);
    });

    it('asks for a password first and locks after setup when none is set', async () => {
        await requestPrivacyLock();

        expect(commands.appPrivacyLockEngage).not.toHaveBeenCalled();
        expect(usePrivacyLockDialogStore.getState()).toEqual({
            open: true,
            engageAfterSetup: true
        });
    });
});

describe('privacy lock outcomes', () => {
    it('keeps the current lock state when the password is wrong', async () => {
        useRuntimeStore
            .getState()
            .setPrivacyLock(snapshot({ hasPassword: true, locked: true }));
        vi.mocked(commands.appPrivacyLockUnlock).mockResolvedValue({
            status: 'wrongPassword'
        });

        await expect(unlockPrivacyLock('nope')).resolves.toEqual({
            status: 'wrongPassword'
        });
        expect(useRuntimeStore.getState().privacyLock.locked).toBe(true);
    });

    it('unlocks the app when the password is accepted', async () => {
        useRuntimeStore
            .getState()
            .setPrivacyLock(snapshot({ hasPassword: true, locked: true }));
        vi.mocked(commands.appPrivacyLockUnlock).mockResolvedValue({
            status: 'ok',
            snapshot: snapshot({ revision: 2, hasPassword: true })
        });

        await unlockPrivacyLock('secret');

        expect(commands.appPrivacyLockUnlock).toHaveBeenCalledWith('secret');
        expect(useRuntimeStore.getState().privacyLock.locked).toBe(false);
    });
});
