import { useEffect, useState } from 'react';

import { commands, type LogLocationSnapshot } from '@/platform/tauri/bindings';

import { isLiveLocation } from './playerListRows';

function normalizeLogLocationSnapshot(
    snapshot: LogLocationSnapshot | null
): LogLocationSnapshot | null {
    if (!snapshot || !isLiveLocation(snapshot.location)) {
        return null;
    }

    return snapshot;
}

export function usePlayerListLogLocation({
    addGameLogEventCount,
    currentUserId,
    currentUserLocation,
    isGameRunning
}: {
    addGameLogEventCount?: number;
    currentUserId?: string | null;
    currentUserLocation?: string;
    isGameRunning: boolean;
}) {
    const [logLocationSnapshot, setLogLocationSnapshot] =
        useState<ReturnType<typeof normalizeLogLocationSnapshot>>(null);

    useEffect(() => {
        let active = true;

        if (currentUserLocation || !isGameRunning) {
            setLogLocationSnapshot(null);
            return () => {
                active = false;
            };
        }

        if (logLocationSnapshot) {
            return () => {
                active = false;
            };
        }

        commands
            .logWatcherGetCurrentLocation()
            .then((snapshot) => {
                if (!active) {
                    return;
                }

                const normalized = normalizeLogLocationSnapshot(snapshot);
                const normalizedKey = JSON.stringify(normalized || null);
                setLogLocationSnapshot((previous) =>
                    JSON.stringify(previous || null) === normalizedKey
                        ? previous
                        : normalized
                );
            })
            .catch(() => {
                if (!active) {
                    return;
                }

                setLogLocationSnapshot(null);
            });

        return () => {
            active = false;
        };
    }, [
        addGameLogEventCount,
        currentUserId,
        currentUserLocation,
        isGameRunning,
        logLocationSnapshot
    ]);

    return logLocationSnapshot;
}
