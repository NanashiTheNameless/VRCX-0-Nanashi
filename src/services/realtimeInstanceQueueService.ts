import type { RealtimeInstanceQueueProjection } from '@/platform/tauri/bindings';
import i18n from '@/services/i18nService';
import { toast } from '@/services/toastService';
import { displayLocation, parseLocation } from '@/shared/utils/location';
import {
    locationHintKey,
    useLocationHintStore
} from '@/state/locationHintStore';
import { useRuntimeStore } from '@/state/runtimeStore';

type ProjectionRecord = Record<string, unknown>;
function translated(
    key: string,
    params: ProjectionRecord,
    fallback: string
): string {
    const value = i18n.t(key, params);
    return typeof value === 'string' && value !== key ? value : fallback;
}

function resolveQueueLocationLabel(instanceLocation: string): string {
    const runtimeState = useRuntimeStore.getState();
    const endpoint = runtimeState.auth.currentUserEndpoint;
    const hint =
        useLocationHintStore.getState().hintsByKey[
            locationHintKey(endpoint, instanceLocation)
        ];
    const parsed = parseLocation(instanceLocation);
    const worldName = hint?.worldName || parsed.worldId || instanceLocation;
    const groupName = hint?.groupName || '';
    return (
        displayLocation(instanceLocation, worldName, groupName) ||
        worldName ||
        instanceLocation
    );
}

export function handleRealtimeInstanceQueueProjection(
    projection: RealtimeInstanceQueueProjection
) {
    const { kind } = projection;
    const instanceLocation = projection.instanceLocation.trim();
    if (!instanceLocation) {
        return;
    }

    const runtimeStore = useRuntimeStore.getState();
    const currentQueue = runtimeStore.instanceQueue;
    const label =
        currentQueue.instanceLocation === instanceLocation && currentQueue.label
            ? currentQueue.label
            : resolveQueueLocationLabel(instanceLocation);

    if (kind === 'ready') {
        if (
            !currentQueue.instanceLocation ||
            currentQueue.instanceLocation === instanceLocation
        ) {
            runtimeStore.clearInstanceQueueState();
        }
        toast.add({
            type: 'success',
            title: translated(
                'status_bar.instance_queue_ready_to_join',
                { location: label },
                `Instance ready to join ${label}`
            )
        });
        return;
    }

    if (kind === 'left') {
        if (currentQueue.instanceLocation === instanceLocation) {
            runtimeStore.clearInstanceQueueState();
        }
        return;
    }

    runtimeStore.setInstanceQueueState({
        active: true,
        instanceLocation,
        position: Math.max(0, projection.position),
        queueSize: Math.max(0, projection.queueSize),
        label,
        updatedAt: projection.receivedAt
    });
}

export function handleQueuedInstancePatch(instanceLocation: string) {
    const normalizedLocation = instanceLocation.trim();
    if (!normalizedLocation) {
        return;
    }

    const runtimeStore = useRuntimeStore.getState();
    const currentQueue = runtimeStore.instanceQueue;
    runtimeStore.setInstanceQueueState({
        active: true,
        instanceLocation: normalizedLocation,
        position: 0,
        queueSize: 0,
        label:
            currentQueue.instanceLocation === normalizedLocation &&
            currentQueue.label
                ? currentQueue.label
                : resolveQueueLocationLabel(normalizedLocation),
        updatedAt: Math.floor(Date.now() / 1000)
    });
}
