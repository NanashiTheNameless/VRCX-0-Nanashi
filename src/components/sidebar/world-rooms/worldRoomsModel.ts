import { resolveInstanceRows } from '@/components/dialogs/world-dialog/WorldDialogViewParts';
import type { WorldProfileRecord } from '@/domain/entities/world';
import { presenceLiveInstanceTag } from '@/domain/friends/presence';
import type { FriendRecord } from '@/domain/friends/types';
import { parseLocation } from '@/shared/utils/location';

export type WorldRoomRow = {
    location: string;
    occupants: number | null;
    friends: FriendRecord[];
    isCurrent: boolean;
};

function worldInstanceKey(location: unknown, worldId: string) {
    const parsed = parseLocation(location);
    if (
        !parsed.isRealInstance ||
        !parsed.instanceId ||
        parsed.worldId !== worldId
    ) {
        return '';
    }
    return `${parsed.worldId}:${parsed.instanceId}`;
}

function compareWorldRoomRows(left: WorldRoomRow, right: WorldRoomRow) {
    if ((left.occupants === null) !== (right.occupants === null)) {
        return left.occupants === null ? 1 : -1;
    }
    const occupantDelta = (right.occupants ?? 0) - (left.occupants ?? 0);
    if (occupantDelta) {
        return occupantDelta;
    }
    if (left.friends.length !== right.friends.length) {
        return right.friends.length - left.friends.length;
    }
    return left.location.localeCompare(right.location);
}

export function buildWorldRoomRows({
    worldId,
    world,
    friends,
    currentLocation
}: {
    worldId: string;
    world: WorldProfileRecord | null;
    friends: readonly FriendRecord[];
    currentLocation: string;
}): WorldRoomRow[] {
    const rowsByKey = new Map<string, WorldRoomRow>();
    const ensureRow = (key: string, location: string) => {
        let row = rowsByKey.get(key);
        if (!row) {
            row = { location, occupants: null, friends: [], isCurrent: false };
            rowsByKey.set(key, row);
        }
        return row;
    };

    if (world) {
        for (const instance of resolveInstanceRows(world)) {
            const key = worldInstanceKey(instance.location, worldId);
            if (key) {
                ensureRow(key, instance.location).occupants =
                    instance.occupants ?? null;
            }
        }
    }

    for (const friend of friends) {
        const location = presenceLiveInstanceTag(friend.$presence, {
            preferTraveling: false
        });
        const key = worldInstanceKey(location, worldId);
        if (key) {
            ensureRow(key, location).friends.push(friend);
        }
    }

    const currentKey = worldInstanceKey(currentLocation, worldId);
    if (currentKey) {
        ensureRow(currentKey, currentLocation).isCurrent = true;
    }

    return Array.from(rowsByKey.values()).sort(compareWorldRoomRows);
}

export function filterWorldRoomRows(
    rows: readonly WorldRoomRow[],
    filterText: string
): WorldRoomRow[] {
    if (!filterText) {
        return [...rows];
    }
    return rows.filter(
        (row) =>
            parseLocation(row.location)
                .instanceName.toLowerCase()
                .includes(filterText) ||
            row.friends.some((friend) =>
                friend.displayName.toLowerCase().includes(filterText)
            )
    );
}
