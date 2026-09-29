import { expect, it, vi } from 'vitest';

import type { AppLauncherSnapshot } from '@/platform/tauri/bindings';

const mocks = vi.hoisted(() => ({
    snapshot: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appAppLauncherSnapshotGet: mocks.snapshot
    }
}));

import {
    getCurrentAppLauncherSnapshot,
    handleAppLauncherSnapshotEvent,
    subscribeAppLauncherSnapshot
} from './appLauncherSnapshotService';

function snapshot(enabled: boolean): AppLauncherSnapshot {
    return {
        enabled,
        entries: [],
        activeSession: null,
        testRuns: []
    };
}

it('does not let a late initial query overwrite a newer runtime event', async () => {
    let resolveInitial: ((value: AppLauncherSnapshot) => void) | undefined;
    mocks.snapshot.mockReturnValueOnce(
        new Promise<AppLauncherSnapshot>((resolve) => {
            resolveInitial = resolve;
        })
    );
    const listener = vi.fn();
    const unsubscribe = subscribeAppLauncherSnapshot(listener);

    const initial = getCurrentAppLauncherSnapshot();
    handleAppLauncherSnapshotEvent({ snapshot: snapshot(true) });
    resolveInitial?.(snapshot(false));

    await expect(initial).resolves.toEqual(snapshot(true));
    expect(listener).toHaveBeenLastCalledWith(snapshot(true));

    unsubscribe();
});
