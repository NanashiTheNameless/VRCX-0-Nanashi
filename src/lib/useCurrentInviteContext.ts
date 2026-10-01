import { useMemo } from 'react';

import {
    checkCanInvite,
    resolveCurrentInviteLocation,
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
    const currentLocation = useRuntimeStore(
        (state) => state.gameState.currentLocation
    );
    const currentDestination = useRuntimeStore(
        (state) => state.gameState.currentDestination
    );
    const isGameRunning = useRuntimeStore(
        (state) => state.gameState.isGameRunning
    );
    const currentInviteLocation = resolveCurrentInviteLocation(
        { currentLocation, currentDestination, isGameRunning },
        { $locationTag: currentUserLocationTag, location: currentUserLocation }
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
        currentInviteLocation,
        canInviteFromCurrentLocation,
        canSendInvite: Boolean(
            isGameRunning &&
            currentInviteLocation &&
            canInviteFromCurrentLocation
        )
    };
}
