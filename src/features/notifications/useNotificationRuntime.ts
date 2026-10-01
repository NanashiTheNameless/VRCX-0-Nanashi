import { useMemo } from 'react';

import type { GroupInstanceRecord } from '@/domain/entities/group';
import { useCurrentInviteContext } from '@/lib/useCurrentInviteContext';
import { useRuntimeStore } from '@/state/runtimeStore';

import { buildCachedInstanceMap } from './notificationRows';

const EMPTY_GROUP_INSTANCES: GroupInstanceRecord[] = [];

export function useNotificationRuntime() {
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const endpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const isLocalUserVrcPlusSupporter = useRuntimeStore((state) => {
        const tags = state.auth.currentUserSnapshot?.tags;
        return Boolean(
            state.auth.currentUserSnapshot?.$isVRCPlus ||
            (Array.isArray(tags) && tags.includes('system_supporter')) ||
            globalThis.$debug?.debugVrcPlus
        );
    });
    const groupInstancesEndpoint = useRuntimeStore(
        (state) => state.groupInstances.endpoint
    );
    const groupInstancesUserId = useRuntimeStore(
        (state) => state.groupInstances.userId
    );
    const groupInstances = useRuntimeStore(
        (state) => state.groupInstances.instances
    );

    const groupInstanceRows =
        groupInstancesUserId === currentUserId &&
        groupInstancesEndpoint === endpoint
            ? groupInstances
            : EMPTY_GROUP_INSTANCES;
    const cachedInstances = useMemo(
        () => buildCachedInstanceMap(groupInstanceRows),
        [groupInstanceRows]
    );
    const { currentInviteLocation, canInviteFromCurrentLocation } =
        useCurrentInviteContext(cachedInstances);

    return {
        canInviteFromCurrentLocation,
        currentInviteLocation,
        currentUserId,
        endpoint,
        isLocalUserVrcPlusSupporter
    };
}
