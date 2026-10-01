import { useRuntimeStore } from '@/state/runtimeStore';

function normalizeAvatarId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeTimestamp(value: unknown): number {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
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

export { getCurrentAvatarLiveWearTime };
