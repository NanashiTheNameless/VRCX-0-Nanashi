import { useMemo } from 'react';

import { buildPlayerSourceRows } from './playerListRows';
import type {
    PlayerListContext,
    PlayerListCurrentUserSnapshot,
    PlayerListRosterRow,
    PlayerListSourceRow
} from './playerListTypes';

export function usePlayerListSourceRows({
    context,
    currentLocationStartedAt,
    currentUserId,
    currentUserLocation,
    currentUserSnapshot,
    isGameRunning,
    playerRows
}: {
    context: PlayerListContext;
    currentLocationStartedAt?: number | null;
    currentUserId?: string | null;
    currentUserLocation?: string | null;
    currentUserSnapshot?: PlayerListCurrentUserSnapshot | null;
    isGameRunning: boolean;
    playerRows?: readonly PlayerListRosterRow[];
}): PlayerListSourceRow[] {
    return useMemo(() => {
        return buildPlayerSourceRows({
            context,
            currentLocationStartedAt,
            currentUserId,
            currentUserLocation,
            currentUserSnapshot,
            isGameRunning,
            playerRows
        });
    }, [
        context,
        currentLocationStartedAt,
        currentUserId,
        currentUserLocation,
        currentUserSnapshot,
        isGameRunning,
        playerRows
    ]);
}
