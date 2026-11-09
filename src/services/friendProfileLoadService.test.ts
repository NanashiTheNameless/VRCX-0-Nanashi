import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FriendProfileLoadStatusPayload } from '@/platform/tauri/bindings';
import { useRuntimeStore } from '@/state/runtimeStore';

const mocks = vi.hoisted(() => ({
    appFriendProfileLoadStart: vi.fn(),
    appFriendProfileRefreshAll: vi.fn(),
    appFriendProfileLoadCancel: vi.fn(),
    toastAdd: vi.fn(),
    confirm: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appFriendProfileLoadStart: mocks.appFriendProfileLoadStart,
        appFriendProfileRefreshAll: mocks.appFriendProfileRefreshAll,
        appFriendProfileLoadCancel: mocks.appFriendProfileLoadCancel
    }
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: mocks.toastAdd }
}));

vi.mock('@/state/modalStore', () => ({
    useModalStore: { getState: () => ({ confirm: mocks.confirm }) }
}));

vi.mock('./i18nService', () => ({
    default: { t: (key: string) => key }
}));

import {
    applyFriendProfileLoadStatusPayload,
    cancelFriendProfileLoad,
    minimizeFriendProfileLoadDialog,
    openFriendProfileLoadDialog,
    resetFriendProfileLoadService,
    startFriendProfileLoad,
    useFriendProfileRefreshStore,
    friendProfileRefreshScopeKey
} from './friendProfileLoadService';

function runningPayload() {
    return {
        runId: 1,
        status: 'running' as const,
        total: 3,
        processed: 0,
        loaded: 0,
        failed: 0,
        startedAt: 1767225600,
        finishedAt: null
    };
}

function completedPayload(
    overrides: Partial<ReturnType<typeof runningPayload>> = {}
) {
    return {
        ...runningPayload(),
        status: 'completed' as const,
        processed: 3,
        loaded: 3,
        finishedAt: 1767225605,
        ...overrides
    };
}

function deferred<T>() {
    let resolve = (_value: T) => {};
    const promise = new Promise<T>((nextResolve) => {
        resolve = nextResolve;
    });
    return { promise, resolve };
}

describe('friendProfileLoadService', () => {
    beforeEach(() => {
        resetFriendProfileLoadService();
        useRuntimeStore.getState().resetRuntimeState();
        mocks.appFriendProfileLoadStart.mockReset();
        mocks.appFriendProfileRefreshAll.mockReset();
        mocks.appFriendProfileLoadCancel.mockReset();
        mocks.toastAdd.mockReset();
        mocks.confirm.mockReset().mockResolvedValue({ ok: true });
        vi.useRealTimers();
    });

    it('starts a run by calling the backend command and opens the dialog', async () => {
        mocks.appFriendProfileLoadStart.mockResolvedValue(runningPayload());

        await startFriendProfileLoad();

        expect(mocks.appFriendProfileLoadStart).toHaveBeenCalledTimes(1);
        expect(useRuntimeStore.getState().friendProfileLoad).toMatchObject({
            runId: 1,
            status: 'running',
            totalFriends: 3,
            processedFriends: 0,
            dialogOpen: true
        });
    });

    it('refreshes every friend through the refresh command and opens progress', async () => {
        mocks.appFriendProfileRefreshAll.mockResolvedValue(runningPayload());
        await startFriendProfileLoad(true);
        expect(mocks.appFriendProfileRefreshAll).toHaveBeenCalledTimes(1);
        expect(mocks.appFriendProfileLoadStart).not.toHaveBeenCalled();
        expect(useRuntimeStore.getState().friendProfileLoad).toMatchObject({
            status: 'running',
            totalFriends: 3,
            dialogOpen: true
        });
    });

    it('waits for confirmation before starting a full refresh', async () => {
        const confirmation = deferred<{ ok: boolean }>();
        mocks.confirm.mockReturnValue(confirmation.promise);
        mocks.appFriendProfileRefreshAll.mockResolvedValue(runningPayload());
        const start = startFriendProfileLoad(true);
        expect(mocks.confirm).toHaveBeenCalledWith({
            title: 'view.friend_list.refresh_all',
            description: 'view.friend_list.refresh_all_confirm_description',
            confirmText: 'view.friend_list.refresh_all_confirm',
            cancelText: 'common.actions.cancel'
        });
        expect(mocks.appFriendProfileRefreshAll).not.toHaveBeenCalled();
        expect(useRuntimeStore.getState().friendProfileLoad.dialogOpen).toBe(
            false
        );
        confirmation.resolve({ ok: true });
        await start;
        expect(mocks.appFriendProfileRefreshAll).toHaveBeenCalledTimes(1);
    });

    it('does not start or enter cooldown when confirmation is declined', async () => {
        mocks.confirm.mockResolvedValue({ ok: false });
        await startFriendProfileLoad(true);
        expect(mocks.appFriendProfileRefreshAll).not.toHaveBeenCalled();
        expect(useFriendProfileRefreshStore.getState()).toMatchObject({
            cooldowns: {},
            pending: false
        });
        expect(useRuntimeStore.getState().friendProfileLoad.dialogOpen).toBe(
            false
        );
    });

    it('discards confirmation if the signed-in account changed while it was open', async () => {
        const confirmation = deferred<{ ok: boolean }>();
        mocks.confirm.mockReturnValue(confirmation.promise);
        const start = startFriendProfileLoad(true);
        useRuntimeStore
            .getState()
            .setAuthBootstrap({ currentUserId: 'usr_other' });
        confirmation.resolve({ ok: true });
        await start;
        expect(mocks.appFriendProfileRefreshAll).not.toHaveBeenCalled();
        expect(useFriendProfileRefreshStore.getState().pending).toBe(false);
    });

    it('asks before loading friend details and does nothing when declined', async () => {
        mocks.confirm.mockResolvedValue({ ok: false });
        await startFriendProfileLoad();
        expect(mocks.confirm).toHaveBeenCalledWith({
            title: 'view.friend_list.load',
            description: 'view.friend_list.load_confirm_description',
            confirmText: 'view.friend_list.load_confirm',
            cancelText: 'common.actions.cancel'
        });
        expect(mocks.appFriendProfileLoadStart).not.toHaveBeenCalled();
        expect(useFriendProfileRefreshStore.getState()).toMatchObject({
            cooldowns: {},
            pending: false
        });
    });

    it('starts a one minute load cooldown that does not block a full refresh', async () => {
        vi.useFakeTimers();
        mocks.appFriendProfileLoadStart.mockResolvedValue(completedPayload());
        await startFriendProfileLoad();
        const loadScope = friendProfileRefreshScopeKey('', '', 'load');
        expect(
            useFriendProfileRefreshStore.getState().cooldowns[loadScope]
        ).toBe(Date.now() + 60_000);
        expect(
            useFriendProfileRefreshStore.getState().cooldowns[
                friendProfileRefreshScopeKey('', '')
            ]
        ).toBeUndefined();

        await startFriendProfileLoad();
        expect(mocks.appFriendProfileLoadStart).toHaveBeenCalledTimes(1);
        expect(mocks.toastAdd).toHaveBeenCalledWith({
            type: 'info',
            title: 'view.friend_list.load_cooldown'
        });

        mocks.appFriendProfileRefreshAll.mockResolvedValue({
            ...runningPayload(),
            runId: 2
        });
        await startFriendProfileLoad(true);
        expect(mocks.appFriendProfileRefreshAll).toHaveBeenCalledTimes(1);
        applyFriendProfileLoadStatusPayload(completedPayload({ runId: 2 }));

        await vi.advanceTimersByTimeAsync(60_000);
        mocks.appFriendProfileLoadStart.mockResolvedValue(
            completedPayload({ runId: 3 })
        );
        await startFriendProfileLoad();
        expect(mocks.appFriendProfileLoadStart).toHaveBeenCalledTimes(2);
    });

    it('starts five minutes of cooldown at completion and keeps it after progress resets', async () => {
        vi.useFakeTimers();
        mocks.appFriendProfileRefreshAll.mockResolvedValue(runningPayload());
        await startFriendProfileLoad(true);

        await vi.advanceTimersByTimeAsync(600_000);
        applyFriendProfileLoadStatusPayload(completedPayload());
        const scope = friendProfileRefreshScopeKey('', '');
        expect(useFriendProfileRefreshStore.getState().cooldowns[scope]).toBe(
            Date.now() + 300_000
        );

        await vi.advanceTimersByTimeAsync(5000);
        expect(useRuntimeStore.getState().friendProfileLoad.status).toBe(
            'idle'
        );
        await startFriendProfileLoad(true);
        expect(mocks.appFriendProfileRefreshAll).toHaveBeenCalledTimes(1);
        expect(mocks.toastAdd).toHaveBeenCalledWith({
            type: 'info',
            title: 'view.friend_list.refresh_all_cooldown'
        });

        mocks.appFriendProfileLoadStart.mockResolvedValue(
            completedPayload({ runId: 2 })
        );
        await startFriendProfileLoad();
        expect(mocks.appFriendProfileLoadStart).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(294_999);
        await startFriendProfileLoad(true);
        expect(mocks.appFriendProfileRefreshAll).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        mocks.appFriendProfileRefreshAll.mockResolvedValue({
            ...runningPayload(),
            runId: 3
        });
        await startFriendProfileLoad(true);
        expect(mocks.appFriendProfileRefreshAll).toHaveBeenCalledTimes(2);
    });

    it('starts cooldown after cancellation without extending it for duplicate events', async () => {
        vi.useFakeTimers();
        mocks.appFriendProfileRefreshAll.mockResolvedValue(runningPayload());
        await startFriendProfileLoad(true);
        const cancelled = {
            ...completedPayload(),
            status: 'cancelled' as const
        };
        applyFriendProfileLoadStatusPayload(cancelled);
        const cooldowns = useFriendProfileRefreshStore.getState().cooldowns;
        await vi.advanceTimersByTimeAsync(1000);
        applyFriendProfileLoadStatusPayload(cancelled);
        expect(useFriendProfileRefreshStore.getState().cooldowns).toBe(
            cooldowns
        );
        await startFriendProfileLoad(true);
        expect(mocks.appFriendProfileRefreshAll).toHaveBeenCalledTimes(1);
    });

    it('keeps cooldowns separate by account and endpoint when switching back', async () => {
        vi.useFakeTimers();
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_a',
            currentUserEndpoint: 'https://api.vrchat.cloud/api/1'
        });
        mocks.appFriendProfileRefreshAll.mockResolvedValue(completedPayload());
        await startFriendProfileLoad(true);

        useRuntimeStore.getState().setAuthBootstrap({ currentUserId: 'usr_b' });
        mocks.appFriendProfileRefreshAll.mockResolvedValue(
            completedPayload({ runId: 2 })
        );
        await startFriendProfileLoad(true);
        expect(mocks.appFriendProfileRefreshAll).toHaveBeenCalledTimes(2);

        useRuntimeStore.getState().setAuthBootstrap({ currentUserId: 'usr_a' });
        await startFriendProfileLoad(true);
        expect(mocks.appFriendProfileRefreshAll).toHaveBeenCalledTimes(2);

        useRuntimeStore.getState().setAuthBootstrap({
            currentUserEndpoint: 'https://example.com/api/1'
        });
        mocks.appFriendProfileRefreshAll.mockResolvedValue(
            completedPayload({ runId: 3 })
        );
        await startFriendProfileLoad(true);
        expect(mocks.appFriendProfileRefreshAll).toHaveBeenCalledTimes(3);
    });

    it('handles completion arriving before the start response', async () => {
        vi.useFakeTimers();
        const pending = deferred<FriendProfileLoadStatusPayload>();
        mocks.appFriendProfileRefreshAll.mockReturnValue(pending.promise);
        const start = startFriendProfileLoad(true);
        await startFriendProfileLoad(true);
        expect(mocks.appFriendProfileRefreshAll).toHaveBeenCalledTimes(1);
        applyFriendProfileLoadStatusPayload(completedPayload());
        pending.resolve(runningPayload());
        await start;
        await startFriendProfileLoad(true);
        expect(mocks.appFriendProfileRefreshAll).toHaveBeenCalledTimes(1);
        expect(useFriendProfileRefreshStore.getState().pending).toBe(false);
    });

    it('allows retry when starting the refresh fails', async () => {
        mocks.appFriendProfileRefreshAll.mockRejectedValueOnce(
            new Error('offline')
        );
        await expect(startFriendProfileLoad(true)).rejects.toThrow('offline');
        expect(useFriendProfileRefreshStore.getState()).toMatchObject({
            cooldowns: {},
            pending: false
        });
        mocks.appFriendProfileRefreshAll.mockResolvedValue(runningPayload());
        await startFriendProfileLoad(true);
        expect(mocks.appFriendProfileRefreshAll).toHaveBeenCalledTimes(2);
    });

    it('shows the already-loaded toast when the backend completes with nothing to load', async () => {
        mocks.appFriendProfileLoadStart.mockResolvedValue(
            completedPayload({ total: 0, processed: 0, loaded: 0 })
        );

        await startFriendProfileLoad();

        expect(mocks.toastAdd).toHaveBeenCalledWith({
            type: 'success',
            title: 'view.friend_list.label.friend_details_are_already_loaded'
        });
        expect(useRuntimeStore.getState().friendProfileLoad).toMatchObject({
            status: 'completed',
            totalFriends: 0
        });
    });

    it('cancels a run by calling the backend command', async () => {
        mocks.appFriendProfileLoadStart.mockResolvedValue(runningPayload());
        await startFriendProfileLoad();

        mocks.appFriendProfileLoadCancel.mockResolvedValue({
            ...runningPayload(),
            status: 'cancelling'
        });
        await cancelFriendProfileLoad();

        expect(mocks.appFriendProfileLoadCancel).toHaveBeenCalledTimes(1);
        expect(useRuntimeStore.getState().friendProfileLoad.status).toBe(
            'cancelling'
        );
    });

    it('stays cancelling while queued running events arrive', async () => {
        applyFriendProfileLoadStatusPayload({
            ...runningPayload(),
            processed: 4,
            loaded: 4
        });
        openFriendProfileLoadDialog();
        const pendingCancel = deferred<FriendProfileLoadStatusPayload>();
        mocks.appFriendProfileLoadCancel.mockReturnValue(pendingCancel.promise);

        const cancelPromise = cancelFriendProfileLoad();
        expect(useRuntimeStore.getState().friendProfileLoad).toMatchObject({
            status: 'cancelling',
            processedFriends: 4,
            cancelRequested: true,
            dialogOpen: false
        });

        applyFriendProfileLoadStatusPayload({
            ...runningPayload(),
            processed: 10,
            loaded: 10
        });
        expect(useRuntimeStore.getState().friendProfileLoad).toMatchObject({
            status: 'cancelling',
            processedFriends: 4
        });

        pendingCancel.resolve({
            ...runningPayload(),
            status: 'cancelling',
            processed: 74,
            loaded: 74
        });
        await cancelPromise;
        expect(useRuntimeStore.getState().friendProfileLoad).toMatchObject({
            status: 'cancelling',
            processedFriends: 74
        });
    });

    it('reopens the dialog if the cancel command fails', async () => {
        applyFriendProfileLoadStatusPayload(runningPayload());
        openFriendProfileLoadDialog();
        mocks.appFriendProfileLoadCancel.mockRejectedValue(
            new Error('cancel failed')
        );

        await cancelFriendProfileLoad();

        expect(useRuntimeStore.getState().friendProfileLoad).toMatchObject({
            status: 'running',
            cancelRequested: false,
            dialogOpen: true
        });
    });

    it('does not let queued events revive a terminal run', async () => {
        vi.useFakeTimers();
        applyFriendProfileLoadStatusPayload({
            ...runningPayload(),
            processed: 10,
            loaded: 10
        });
        applyFriendProfileLoadStatusPayload({
            ...runningPayload(),
            status: 'cancelled',
            processed: 74,
            loaded: 74,
            finishedAt: 1767225605
        });
        applyFriendProfileLoadStatusPayload({
            ...runningPayload(),
            processed: 31,
            loaded: 31
        });
        expect(useRuntimeStore.getState().friendProfileLoad).toMatchObject({
            status: 'cancelled',
            processedFriends: 74
        });

        await vi.advanceTimersByTimeAsync(5000);
        applyFriendProfileLoadStatusPayload({
            ...runningPayload(),
            processed: 40,
            loaded: 40
        });
        expect(useRuntimeStore.getState().friendProfileLoad.status).toBe(
            'idle'
        );

        applyFriendProfileLoadStatusPayload({
            ...runningPayload(),
            runId: 2,
            processed: 0,
            loaded: 0
        });
        expect(useRuntimeStore.getState().friendProfileLoad).toMatchObject({
            runId: 2,
            status: 'running',
            processedFriends: 0
        });
    });

    it('merges a pushed status event without touching dialogOpen', () => {
        openFriendProfileLoadDialog();
        applyFriendProfileLoadStatusPayload(runningPayload());
        expect(useRuntimeStore.getState().friendProfileLoad).toMatchObject({
            status: 'running',
            dialogOpen: true
        });

        minimizeFriendProfileLoadDialog();
        applyFriendProfileLoadStatusPayload({
            ...runningPayload(),
            processed: 1
        });
        expect(useRuntimeStore.getState().friendProfileLoad).toMatchObject({
            status: 'running',
            processedFriends: 1,
            dialogOpen: false
        });
    });

    it('keeps terminal progress for five seconds before resetting', async () => {
        vi.useFakeTimers();
        applyFriendProfileLoadStatusPayload(completedPayload());
        expect(useRuntimeStore.getState().friendProfileLoad.status).toBe(
            'completed'
        );

        await vi.advanceTimersByTimeAsync(4999);
        expect(useRuntimeStore.getState().friendProfileLoad.status).toBe(
            'completed'
        );
        await vi.advanceTimersByTimeAsync(1);
        expect(useRuntimeStore.getState().friendProfileLoad.status).toBe(
            'idle'
        );
    });

    it('minimize and open toggle dialogOpen without touching progress', () => {
        applyFriendProfileLoadStatusPayload(runningPayload());
        minimizeFriendProfileLoadDialog();
        expect(useRuntimeStore.getState().friendProfileLoad).toMatchObject({
            status: 'running',
            dialogOpen: false
        });
        openFriendProfileLoadDialog();
        expect(useRuntimeStore.getState().friendProfileLoad).toMatchObject({
            status: 'running',
            dialogOpen: true
        });
    });
});
