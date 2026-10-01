import type {
    UserFactMergeOptions,
    UserFactSource
} from '@/domain/users/userFacts';
import {
    ingestUserFactEntries,
    resetPendingUserFactEntries
} from '@/services/userFactAccessService';
import { parseLocation } from '@/shared/utils/location';
import { isRecord } from '@/shared/utils/record';
import { useInstanceJoinHistoryStore } from '@/state/instanceJoinHistoryStore';
import { useInstancePresenceStore } from '@/state/instancePresenceStore';
import { useLocationHintStore } from '@/state/locationHintStore';
import { useUserFactsStore } from '@/state/userFactsStore';

interface RecordKnownUserOptions extends UserFactMergeOptions {
    source?: UserFactSource;
}

interface GameRuntimePresenceInput {
    endpoint?: string;
    currentLocation?: string;
    currentDestination?: string;
    currentLocationStartedAt?: string | null;
    currentLocationPlayers?: unknown[];
    currentWorldName?: string;
}

interface LocationHintsInput {
    endpoint?: string;
    instances?: unknown[];
}

function text(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function record(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {};
}

function toIngestEntry(
    user: Record<string, unknown>,
    options: RecordKnownUserOptions
) {
    return {
        user,
        source: typeof options.source === 'string' ? options.source : 'seed',
        isFriend: Boolean(options.isFriend),
        isCurrentUser: Boolean(options.isCurrentUser)
    };
}

function recordKnownUser(
    user: Record<string, unknown> | null | undefined,
    options: RecordKnownUserOptions = {}
) {
    if (!user || typeof user !== 'object') {
        return;
    }
    ingestUserFactEntries([toIngestEntry(user, options)]);
}

function recordKnownUsers(
    users: unknown[],
    options: RecordKnownUserOptions = {}
) {
    ingestUserFactEntries(
        (Array.isArray(users) ? users : [])
            .filter((user): user is Record<string, unknown> =>
                Boolean(user && typeof user === 'object')
            )
            .map((user) => toIngestEntry(user, options))
    );
}

function recordCurrentUserSnapshot(
    user: Record<string, unknown> | null | undefined,
    { endpoint = '', source = 'currentUser' }: RecordKnownUserOptions = {}
) {
    recordKnownUser(user, {
        endpoint,
        source,
        isCurrentUser: true
    });
}

function recordGameRuntimePresence({
    endpoint = '',
    currentLocation = '',
    currentDestination = '',
    currentLocationStartedAt = '',
    currentLocationPlayers = [],
    currentWorldName = ''
}: GameRuntimePresenceInput = {}) {
    const rawCurrentLocation = text(currentLocation);
    const location = rawCurrentLocation || text(currentDestination);
    const isTraveling = parseLocation(rawCurrentLocation).isTraveling;
    if (isTraveling) {
        return;
    }
    const parsed = parseLocation(location);
    if (!parsed.isRealInstance || !parsed.worldId || !parsed.instanceName) {
        return;
    }
    useInstancePresenceStore.getState().upsertInstancePresence({
        endpoint,
        location,
        source: 'gameRuntime',
        worldName: currentWorldName,
        players: currentLocationPlayers,
        receivedAt: text(currentLocationStartedAt)
    });
    useLocationHintStore.getState().upsertLocationHint({
        endpoint,
        location,
        worldId: parsed.worldId,
        groupId: parsed.groupId || '',
        worldName: currentWorldName,
        instanceName: parsed.instanceName,
        region: parsed.region,
        ageGate: parsed.ageGate
    });
    for (const player of Array.isArray(currentLocationPlayers)
        ? currentLocationPlayers
        : []) {
        const source = record(player);
        const playerUserId = text(source.userId || source.user_id);
        recordKnownUser(
            { ...source, id: playerUserId, userId: playerUserId },
            {
                endpoint,
                source: 'playerSnapshot'
            }
        );
    }
}

function instanceLocation(instance: unknown): string {
    const source = record(instance);
    const nestedLocation = record(source.$location);
    const directLocation = text(
        source.location || source.tag || nestedLocation.tag
    );
    if (directLocation) {
        return directLocation;
    }
    const worldId = text(source.worldId || nestedLocation.worldId);
    const instanceId = text(source.instanceId || nestedLocation.instanceId);
    return worldId && instanceId ? `${worldId}:${instanceId}` : '';
}

function recordLocationHintsFromInstances({
    endpoint = '',
    instances = []
}: LocationHintsInput = {}) {
    for (const instance of Array.isArray(instances) ? instances : []) {
        const source = record(instance);
        const location = instanceLocation(source);
        if (!location) {
            continue;
        }
        const parsed = parseLocation(location);
        useLocationHintStore.getState().upsertLocationHint({
            endpoint,
            location,
            worldId: parsed.worldId || text(source.worldId),
            groupId: parsed.groupId || text(source.groupId),
            worldName: text(
                source.worldName ||
                    record(source.world).name ||
                    record(source.ref).worldName
            ),
            groupName: text(
                source.groupName ||
                    record(source.group).name ||
                    record(source.group).displayName
            ),
            instanceName: text(
                source.displayName ||
                    source.instanceDisplayName ||
                    parsed.instanceName
            ),
            region: parsed.region || text(source.region),
            isClosed: Boolean(
                source.closedAt || source.closed_at || source.isClosed
            ),
            ageGate: Boolean(source.ageGate || parsed.ageGate)
        });
        const users = [
            ...(Array.isArray(source.users) ? source.users : []),
            ...(Array.isArray(source.players) ? source.players : []),
            ...(Array.isArray(source.playerList) ? source.playerList : []),
            ...(Array.isArray(source.userList) ? source.userList : []),
            ...(Array.isArray(source.userIds)
                ? source.userIds.map((userId: unknown) =>
                      typeof userId === 'string'
                          ? {
                                id: userId,
                                userId,
                                displayName: userId
                            }
                          : userId
                  )
                : []),
            ...(source.usersById && typeof source.usersById === 'object'
                ? Object.values(source.usersById)
                : [])
        ];
        recordKnownUsers(users, {
            endpoint,
            source: 'instance'
        });
        useInstancePresenceStore.getState().upsertInstancePresence({
            endpoint,
            location,
            source: 'instance',
            ownerUserId: text(source.ownerId),
            ownerGroupId: text(parsed.groupId || source.groupId),
            worldName: text(
                source.worldName ||
                    record(source.world).name ||
                    record(source.ref).worldName
            ),
            groupName: text(
                source.groupName ||
                    record(source.group).name ||
                    record(source.group).displayName
            ),
            instanceName: text(
                source.displayName ||
                    source.instanceDisplayName ||
                    parsed.instanceName
            ),
            players: users
        });
    }
}

function resetDomainFacts() {
    resetPendingUserFactEntries();
    useUserFactsStore.getState().resetUserFacts();
    useInstancePresenceStore.getState().resetInstancePresence();
    useInstanceJoinHistoryStore.getState().resetInstanceJoinHistory();
    useLocationHintStore.getState().resetLocationHints();
}

export {
    recordCurrentUserSnapshot,
    recordGameRuntimePresence,
    recordKnownUser,
    recordKnownUsers,
    recordLocationHintsFromInstances,
    resetDomainFacts
};
