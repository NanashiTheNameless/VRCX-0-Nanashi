import {
    commands,
    type HostSessionProjection
} from '@/platform/tauri/bindings';
import {
    startCurrentAvatarWearTimer,
    stopCurrentAvatarWearTimer
} from '@/services/avatarWearTimeService';
import { resetGameLogSessionState } from '@/services/gameLogIngestService';
import { isRecord } from '@/shared/utils/record';
import { normalizeString } from '@/shared/utils/string';
import { useNotificationStore } from '@/state/notificationStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

type RuntimeState = ReturnType<typeof useRuntimeStore.getState>;
type GameState = RuntimeState['gameState'];
type GameStatePatch = Parameters<RuntimeState['setGameState']>[0];

async function handleGameStopped(
    previousGameState: GameState,
    currentUserSnapshot: unknown
) {
    const stoppedAt = new Date().toISOString();
    useRuntimeStore.getState().clearInstanceQueueState();

    resetGameLogSessionState(stoppedAt);

    clearStoppedGameLocationSnapshot(previousGameState, currentUserSnapshot);
    await commands.appRuntimeDiscordReconcileRequest().catch((error) => {
        console.warn(
            'Discord presence reconcile after game stop failed:',
            error
        );
    });

    try {
        await stopCurrentAvatarWearTimer();
    } catch (error) {
        console.warn('Game stop side effect failed:', error);
    }
}

function buildNewGameSessionPatch(startedAt: string): GameStatePatch {
    return {
        currentLocation: '',
        currentWorldId: '',
        currentWorldName: '',
        currentDestination: '',
        currentLocationStartedAt: null,
        currentLocationPlayerIds: [],
        currentLocationPlayers: [],
        lastGameStartedAt: startedAt
    };
}

function buildStoppedGameSessionPatch(stoppedAt: string): GameStatePatch {
    return {
        currentLocation: '',
        currentWorldId: '',
        currentWorldName: '',
        currentDestination: '',
        currentLocationStartedAt: null,
        currentLocationPlayerIds: [],
        currentLocationPlayers: [],
        lastGameLogAt: stoppedAt,
        lastGameLogType: 'game-stopped'
    };
}

function clearStoppedGameLocationSnapshot(
    previousGameState: GameState,
    currentUserSnapshot: unknown
) {
    if (!isRecord(currentUserSnapshot)) {
        return;
    }

    const stoppedLocation = normalizeString(previousGameState.currentLocation);
    const stoppedDestination = normalizeString(
        previousGameState.currentDestination
    );
    const stoppedWorldId = normalizeString(previousGameState.currentWorldId);
    if (!stoppedLocation && !stoppedDestination && !stoppedWorldId) {
        return;
    }

    const clearedFields: Record<string, string> = {};
    const clearIfMatches = (field: string, ...values: unknown[]) => {
        const currentValue = normalizeString(currentUserSnapshot[field]);
        if (
            currentValue &&
            values.some((value) => Boolean(value) && currentValue === value)
        ) {
            clearedFields[field] = '';
        }
    };

    clearIfMatches('location', stoppedLocation);
    clearIfMatches('$locationTag', stoppedLocation);
    clearIfMatches('travelingToLocation', stoppedDestination);
    clearIfMatches('$travelingToLocation', stoppedDestination);
    clearIfMatches('worldId', stoppedWorldId);

    if (Object.keys(clearedFields).length) {
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserSnapshot: {
                ...currentUserSnapshot,
                ...clearedFields
            }
        });
    }
}

export async function handleGameRunningUpdate(
    projection: HostSessionProjection
) {
    const runtimeStore = useRuntimeStore.getState();
    const previousGameState = runtimeStore.gameState;
    const currentUserSnapshot = runtimeStore.auth.currentUserSnapshot;
    const previousGameRunning = runtimeStore.gameState.isGameRunning;
    const previousSteamVrRunning = runtimeStore.gameState.isSteamVRRunning;
    const nextGameRunning = projection.isGameRunning;
    const nextSteamVrRunning = projection.isSteamVRRunning;
    const gameRunningChanged = previousGameRunning !== nextGameRunning;
    const steamVrRunningChanged = previousSteamVrRunning !== nextSteamVrRunning;
    const changed = gameRunningChanged || steamVrRunningChanged;
    const payloadChangedAt =
        projection.lastGameStateChangedAt || projection.changedAt;
    const payloadStartedAt = projection.lastGameStartedAt || '';
    const shouldRefreshDiscordPresence =
        gameRunningChanged ||
        (nextGameRunning === true &&
            useSessionStore.getState().sessionPhase === 'ready');
    const now = payloadChangedAt || new Date().toISOString();
    const gameStartedAt =
        gameRunningChanged && nextGameRunning
            ? payloadStartedAt || now
            : payloadStartedAt || runtimeStore.gameState.lastGameStartedAt;
    const newSessionPatch =
        gameRunningChanged && nextGameRunning
            ? buildNewGameSessionPatch(gameStartedAt ?? now)
            : {};
    const stoppedSessionPatch =
        gameRunningChanged && previousGameRunning === true && !nextGameRunning
            ? buildStoppedGameSessionPatch(now)
            : {};

    runtimeStore.setGameState({
        isGameRunning: nextGameRunning,
        isSteamVRRunning: nextSteamVrRunning,
        lastGameStateChangedAt: changed
            ? now
            : runtimeStore.gameState.lastGameStateChangedAt,
        lastGameStartedAt: gameStartedAt,
        ...newSessionPatch,
        ...stoppedSessionPatch
    });

    if (gameRunningChanged && previousGameRunning !== null) {
        useNotificationStore.getState().pushNotification({
            level: 'info',
            title: nextGameRunning ? 'VRChat running' : 'VRChat stopped',
            message: nextSteamVrRunning
                ? 'SteamVR is running.'
                : 'SteamVR is not running.'
        });
    }

    if (nextGameRunning && gameRunningChanged) {
        useRuntimeStore.getState().resetNowPlayingState();
        startCurrentAvatarWearTimer();
    }

    if (
        gameRunningChanged &&
        previousGameRunning === true &&
        !nextGameRunning
    ) {
        await handleGameStopped(previousGameState, currentUserSnapshot);
        return;
    }

    if (shouldRefreshDiscordPresence) {
        await commands.appRuntimeDiscordReconcileRequest().catch((error) => {
            console.warn(
                'Discord presence reconcile after game state update failed:',
                error
            );
        });
    }
}
