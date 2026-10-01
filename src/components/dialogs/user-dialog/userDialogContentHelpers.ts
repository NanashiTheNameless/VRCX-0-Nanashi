import { AppleIcon, MonitorIcon, RectangleGogglesIcon } from 'lucide-react';

import { resolveFriendPresenceLocation } from '@/domain/friends/presence';
import {
    isOfflineOrLeavingFriend,
    resolveObservedPlayerUserIds
} from '@/domain/friends/sameInstanceFriends';
import type { CurrentInstanceRosterPlayer } from '@/domain/instances/currentInstanceRoster';
import { hasGroupIdPrefix } from '@/shared/constants/vrchatIds';
import { parseLocation } from '@/shared/utils/location';

import { normalizeUserId } from './userProfileFields';

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value))
        : {};
}

export function groupSeed(value: unknown) {
    const group = record(value);
    if (!Object.keys(group).length) {
        return null;
    }
    const groupId = normalizeUserId(
        group.groupId || group.group_id || group.id
    );
    return hasGroupIdPrefix(groupId) ? group : null;
}

function groupDisplayName(...values: unknown[]) {
    const fallback: string[] = [];
    for (const value of values) {
        const text = normalizeUserId(value);
        if (!text) {
            continue;
        }
        if (!hasGroupIdPrefix(text)) {
            return text;
        }
        fallback.push(text);
    }
    return fallback[0] || '';
}

export function hasGroupProfileDetails(
    source: unknown,
    fallbackSource: unknown = {}
) {
    const group = record(source);
    if (!Object.keys(group).length) {
        return false;
    }
    const fallback = record(fallbackSource);
    const nestedGroup = record(group.group);
    const name = groupDisplayName(
        group.name,
        group.displayName,
        group.display_name,
        group.groupName,
        group.group_name,
        group.shortCode,
        nestedGroup.name,
        nestedGroup.displayName,
        nestedGroup.display_name,
        fallback.name,
        fallback.displayName,
        fallback.display_name
    );
    const image = normalizeUserId(
        group.iconUrl ||
            group.icon_url ||
            group.thumbnailImageUrl ||
            group.thumbnail_image_url ||
            group.imageUrl ||
            group.image_url ||
            nestedGroup.iconUrl ||
            nestedGroup.icon_url ||
            nestedGroup.thumbnailImageUrl ||
            nestedGroup.thumbnail_image_url ||
            nestedGroup.imageUrl ||
            nestedGroup.image_url
    );
    return Boolean((name && !hasGroupIdPrefix(name)) || image);
}

export function resolvePlatformMeta(platform: unknown) {
    const normalized = normalizeUserId(platform).toLowerCase();

    if (
        normalized === 'standalonewindows' ||
        normalized === 'pc' ||
        normalized === 'windows'
    ) {
        return {
            label: 'PC',
            icon: MonitorIcon
        };
    }

    if (normalized === 'android' || normalized === 'quest') {
        return {
            label: 'Android',
            icon: RectangleGogglesIcon
        };
    }

    if (normalized === 'ios') {
        return {
            label: 'iOS',
            icon: AppleIcon
        };
    }

    return {
        label: normalized ? normalized : 'Unknown',
        icon: null
    };
}

export function resolveUserDialogTargetPresenceLocation({
    profile,
    targetUserId,
    localLocation,
    currentLocation,
    currentLocationPlayerIds,
    currentLocationPlayers,
    friendsById = {}
}: {
    profile: unknown;
    targetUserId: string;
    localLocation: string;
    currentLocation: string;
    currentLocationPlayerIds: readonly string[];
    currentLocationPlayers?: readonly CurrentInstanceRosterPlayer[];
    friendsById?: Record<string, unknown>;
}) {
    if (localLocation) {
        return localLocation;
    }
    const presenceLocation = resolveFriendPresenceLocation(profile, {
        preferTraveling: true
    });
    const normalizedTargetUserId = normalizeUserId(targetUserId);
    if (
        normalizedTargetUserId &&
        isOfflineOrLeavingFriend(friendsById[normalizedTargetUserId])
    ) {
        return 'offline';
    }
    if (parseLocation(presenceLocation).isRealInstance) {
        return presenceLocation;
    }

    const normalizedCurrentLocation = normalizeUserId(currentLocation);
    if (
        !normalizedTargetUserId ||
        !parseLocation(normalizedCurrentLocation).isRealInstance ||
        !resolveObservedPlayerUserIds(
            currentLocationPlayerIds,
            currentLocationPlayers,
            friendsById
        ).includes(normalizedTargetUserId)
    ) {
        return presenceLocation;
    }

    return normalizedCurrentLocation;
}

export function isSameLocationTag(left: unknown, right: unknown) {
    const leftTag = normalizeUserId(left);
    const rightTag = normalizeUserId(right);
    if (!leftTag || !rightTag) {
        return false;
    }
    if (leftTag === rightTag) {
        return true;
    }
    const leftLocation = parseLocation(leftTag);
    const rightLocation = parseLocation(rightTag);
    return Boolean(
        leftLocation.worldId &&
        rightLocation.worldId &&
        leftLocation.instanceId &&
        rightLocation.instanceId &&
        leftLocation.worldId === rightLocation.worldId &&
        leftLocation.instanceId === rightLocation.instanceId
    );
}

export function createLocationGroupRow(
    group: unknown,
    fallbackSource: unknown = {}
) {
    const source =
        typeof group === 'string'
            ? { id: group, groupId: group, name: group }
            : record(group);
    const fallback = record(fallbackSource);
    const nestedGroup = record(source.group);
    const groupId = normalizeUserId(
        source.groupId ||
            source.group_id ||
            nestedGroup.id ||
            nestedGroup.groupId ||
            nestedGroup.group_id ||
            (hasGroupIdPrefix(source.id) ? source.id : '') ||
            fallback.groupId ||
            fallback.group_id ||
            fallback.id
    );
    const name = groupDisplayName(
        source.name,
        source.displayName,
        source.display_name,
        source.groupName,
        source.group_name,
        source.shortCode,
        nestedGroup.name,
        nestedGroup.displayName,
        nestedGroup.display_name,
        fallback.name,
        fallback.displayName,
        fallback.display_name,
        groupId
    );
    return {
        ...nestedGroup,
        ...(source && typeof source === 'object' ? source : {}),
        id: groupId,
        groupId,
        name,
        displayName: source.displayName || source.display_name || name,
        iconUrl:
            source.iconUrl ||
            source.icon_url ||
            nestedGroup.iconUrl ||
            nestedGroup.icon_url ||
            fallback.iconUrl ||
            fallback.icon_url ||
            '',
        thumbnailImageUrl:
            source.thumbnailImageUrl ||
            source.thumbnail_image_url ||
            nestedGroup.thumbnailImageUrl ||
            nestedGroup.thumbnail_image_url ||
            '',
        imageUrl:
            source.imageUrl ||
            source.image_url ||
            nestedGroup.imageUrl ||
            nestedGroup.image_url ||
            ''
    };
}

function instanceLocation(instance: unknown) {
    const instanceRecord = record(instance);
    const source = record(instanceRecord.instance || instanceRecord);
    const sourceLocation = record(source.$location);
    const instanceLocationRecord = record(instanceRecord.$location);
    return normalizeUserId(
        source.location ||
            source.tag ||
            sourceLocation.tag ||
            instanceRecord.location ||
            instanceRecord.tag ||
            instanceLocationRecord.tag
    );
}

export function locationCacheKey(location: unknown) {
    const parsed = parseLocation(location);
    if (!parsed.worldId || !parsed.instanceId) {
        return '';
    }
    return `${parsed.worldId}:${parsed.instanceId}`;
}

export function buildCachedInstanceMap(instances: unknown) {
    const map = new Map<string, Record<string, unknown>>();
    for (const instance of Array.isArray(instances) ? instances : []) {
        const instanceRecord = record(instance);
        const source = record(instanceRecord.instance || instanceRecord);
        const location = instanceLocation(instance);
        if (!location) {
            continue;
        }
        map.set(location, source);
        const key = locationCacheKey(location);
        if (key) {
            map.set(key, source);
        }
    }
    return map;
}

export function resolveFriendRequestState(source: unknown) {
    const profile = record(source);
    const status = normalizeUserId(profile.friendRequestStatus).toLowerCase();
    return {
        incoming:
            Boolean(profile?.incomingRequest) || status.includes('incoming'),
        outgoing:
            Boolean(profile?.outgoingRequest) || status.includes('outgoing')
    };
}
