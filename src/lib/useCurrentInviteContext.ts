import { useMemo } from 'react';

import {
    checkCanInvite,
    resolveCurrentInviteLocation,
    resolveInviteLocation,
    type CheckCanInviteDeps
} from '@/shared/utils/invite';
import { useRuntimeStore } from '@/state/runtimeStore';

export function useCurrentInviteContext(
    cachedInstances: CheckCanInviteDeps['cachedInstances'] = null
) {
    const currentUserId = useRuntimeStore(
        (state) => state.auth.currentUserId ?? ''
    );
    const currentUserLocationTag = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot?.$locationTag
    );
    const currentUserLocation = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot?.location
    );
    const currentUserPresence = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot?.$presence
    );
    const gameCurrentLocation = useRuntimeStore(
        (state) => state.gameState.currentLocation
    );
    const currentDestination = useRuntimeStore(
        (state) => state.gameState.currentDestination
    );
    const isGameRunning = useRuntimeStore(
        (state) => state.gameState.isGameRunning
    );
    const gameState = {
        currentLocation: gameCurrentLocation,
        currentDestination,
        isGameRunning
    };
    const currentUserSnapshot = {
        $locationTag: currentUserLocationTag,
        location: currentUserLocation,
        $presence: currentUserPresence
    };
    const currentLocation = resolveCurrentInviteLocation(
        gameState,
        currentUserSnapshot
    );
    const currentInviteLocation = resolveInviteLocation(
        gameState,
        currentUserSnapshot
    );
    const canInviteFromCurrentLocation = useMemo(
        () =>
            checkCanInvite(currentInviteLocation, {
                currentUserId,
                lastLocationStr: currentInviteLocation,
                cachedInstances
            }),
        [cachedInstances, currentInviteLocation, currentUserId]
    );
    return {
        currentLocation,
        currentInviteLocation,
        canInviteFromCurrentLocation,
        canSendInvite: Boolean(
            currentInviteLocation && canInviteFromCurrentLocation
        )
    };
}
