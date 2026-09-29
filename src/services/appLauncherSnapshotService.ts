import {
    commands,
    type AppLauncherSnapshot,
    type AppLauncherSnapshotEvent
} from '@/platform/tauri/bindings';

type AppLauncherSnapshotListener = (snapshot: AppLauncherSnapshot) => void;

const listeners = new Set<AppLauncherSnapshotListener>();
let snapshotSequence = 0;
let latestSnapshot: AppLauncherSnapshot | null = null;

function publishSnapshot(snapshot: AppLauncherSnapshot) {
    latestSnapshot = snapshot;
    for (const listener of listeners) {
        listener(snapshot);
    }
    return snapshot;
}

export function handleAppLauncherSnapshotEvent(
    event: AppLauncherSnapshotEvent
): void {
    snapshotSequence += 1;
    publishSnapshot(event.snapshot);
}

export function subscribeAppLauncherSnapshot(
    listener: AppLauncherSnapshotListener
): () => void {
    listeners.add(listener);
    if (latestSnapshot) {
        listener(latestSnapshot);
    }
    return () => {
        listeners.delete(listener);
    };
}

export async function setAppLauncherEntryEnabled(
    entryId: string,
    enabled: boolean
): Promise<AppLauncherSnapshot> {
    const snapshot = await commands.appAppLauncherEntryEnabledSet(
        entryId,
        enabled
    );
    snapshotSequence += 1;
    return publishSnapshot(snapshot);
}

export async function getCurrentAppLauncherSnapshot(): Promise<AppLauncherSnapshot> {
    snapshotSequence += 1;
    const requestSequence = snapshotSequence;
    const snapshot = await commands.appAppLauncherSnapshotGet();
    if (requestSequence !== snapshotSequence && latestSnapshot) {
        return latestSnapshot;
    }
    return publishSnapshot(snapshot);
}
