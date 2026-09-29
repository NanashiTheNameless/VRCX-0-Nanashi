import { isRecord } from '@/shared/utils/record';
import { useRuntimeStore } from '@/state/runtimeStore';

type AvatarWearSnapshotUpdateOptions = {
    previousSnapshot?: unknown;
    nextSnapshot?: unknown;
    isGameRunning?: boolean | null;
    now?: number;
};

type TimerOptions = {
    now?: number;
};

function normalizeAvatarId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeTimestamp(value: unknown): number {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

function buildAvatarWearSnapshotUpdate({
    previousSnapshot,
    nextSnapshot,
    isGameRunning,
    now = Date.now()
}: AvatarWearSnapshotUpdateOptions): {
    snapshot: unknown;
} {
    const next = isRecord(nextSnapshot) ? { ...nextSnapshot } : null;

    if (!next) {
        return {
            snapshot: nextSnapshot
        };
    }

    const previous =
        isRecord(previousSnapshot) &&
        normalizeAvatarId(previousSnapshot.id) === normalizeAvatarId(next.id)
            ? previousSnapshot
            : null;
    const previousAvatarId = normalizeAvatarId(previous?.currentAvatar);
    const nextAvatarId = normalizeAvatarId(next.currentAvatar);
    const previousSwapTime = normalizeTimestamp(
        previous?.$previousAvatarSwapTime
    );
    const running = isGameRunning === true;

    if (!running) {
        next.$previousAvatarSwapTime = null;
        return {
            snapshot: next
        };
    }

    if (!nextAvatarId) {
        next.$previousAvatarSwapTime = previousSwapTime || null;
        return {
            snapshot: next
        };
    }

    if (!previousAvatarId) {
        next.$previousAvatarSwapTime =
            normalizeTimestamp(next.$previousAvatarSwapTime) || now;
        return {
            snapshot: next
        };
    }

    if (previousAvatarId !== nextAvatarId) {
        next.$previousAvatarSwapTime = now;
        return {
            snapshot: next
        };
    }

    next.$previousAvatarSwapTime =
        previousSwapTime ||
        normalizeTimestamp(next.$previousAvatarSwapTime) ||
        now;
    return {
        snapshot: next
    };
}

function startCurrentAvatarWearTimer({ now = Date.now() }: TimerOptions = {}) {
    const runtimeStore = useRuntimeStore.getState();
    const snapshot = runtimeStore.auth.currentUserSnapshot;
    if (!snapshot || typeof snapshot !== 'object') {
        return;
    }

    const avatarId = normalizeAvatarId(snapshot.currentAvatar);
    runtimeStore.setAuthBootstrap({
        currentUserSnapshot: {
            ...snapshot,
            $previousAvatarSwapTime: avatarId ? now : null
        }
    });
}

async function stopCurrentAvatarWearTimer(): Promise<void> {
    const runtimeStore = useRuntimeStore.getState();
    const snapshot = runtimeStore.auth.currentUserSnapshot;
    if (!snapshot || typeof snapshot !== 'object') {
        return;
    }

    runtimeStore.setAuthBootstrap({
        currentUserSnapshot: {
            ...snapshot,
            $previousAvatarSwapTime: null
        }
    });
}

function getCurrentAvatarLiveWearTime(
    avatarId: string,
    baseTimeSpent = 0
): number {
    const normalizedAvatarId = normalizeAvatarId(avatarId);
    const runtimeState = useRuntimeStore.getState();
    const currentUserSnapshot = runtimeState.auth.currentUserSnapshot;
    if (
        !normalizedAvatarId ||
        runtimeState.gameState.isGameRunning !== true ||
        normalizeAvatarId(currentUserSnapshot?.currentAvatar) !==
            normalizedAvatarId
    ) {
        return baseTimeSpent || 0;
    }

    const startedAt = normalizeTimestamp(
        currentUserSnapshot?.$previousAvatarSwapTime
    );
    if (!startedAt) {
        return baseTimeSpent || 0;
    }

    return (baseTimeSpent || 0) + Math.max(0, Date.now() - startedAt);
}

export {
    buildAvatarWearSnapshotUpdate,
    getCurrentAvatarLiveWearTime,
    startCurrentAvatarWearTimer,
    stopCurrentAvatarWearTimer
};
