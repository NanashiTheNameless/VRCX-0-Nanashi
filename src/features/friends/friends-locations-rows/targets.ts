import {
    presenceOf,
    presenceTravelingTag,
    resolveFriendPresenceLocation
} from '@/domain/friends/presence';
import { parseLocation } from '@/shared/utils/location';
import { normalizeString } from '@/shared/utils/string';

import { resolveFriendGroupName, resolveFriendWorldName } from './names';
import {
    localized,
    resolveWorldIdCandidate,
    sourceFromFriend
} from './normalization';
import type {
    FriendLocationFriend,
    FriendLocationTarget,
    TranslationFn
} from './types';

export function locationTarget(rawLocation: string): FriendLocationTarget {
    const parsed = parseLocation(rawLocation);
    return {
        rawLocation,
        parsed,
        worldId:
            !rawLocation || parsed.isOffline || parsed.isPrivate
                ? ''
                : resolveWorldIdCandidate(parsed.worldId),
        groupId: parsed.groupId || '',
        instanceId: parsed.instanceId || '',
        accessTypeName: parsed.accessTypeName || '',
        isOffline: !rawLocation || parsed.isOffline,
        isPrivate: parsed.isPrivate,
        isTraveling: parsed.isTraveling
    };
}

export function friendLocationTarget(
    friend: FriendLocationFriend | null | undefined,
    localLocation = ''
): FriendLocationTarget {
    return locationTarget(
        localLocation ||
            resolveFriendPresenceLocation(friend, { preferTraveling: true })
    );
}

export function isFriendInPrivateLocation(
    friend: FriendLocationFriend | null | undefined,
    localLocation = ''
) {
    return friendLocationTarget(friend, localLocation).isPrivate;
}

export function partitionFriendsByPrivateLocation<
    TFriend extends FriendLocationFriend
>(friends: TFriend[], localLocationOf: (friendId: string) => string) {
    const visibleLocation: TFriend[] = [];
    const privateLocation: TFriend[] = [];
    for (const friend of friends) {
        if (
            isFriendInPrivateLocation(
                friend,
                localLocationOf(normalizeString(friend?.id))
            )
        ) {
            privateLocation.push(friend);
        } else {
            visibleLocation.push(friend);
        }
    }
    return { visibleLocation, privateLocation };
}

export function resolveLocationSummary(
    friend: FriendLocationFriend | null | undefined,
    t: TranslationFn | null = null
) {
    const presence = presenceOf(sourceFromFriend(friend));
    const travelingToLocation = presence ? presenceTravelingTag(presence) : '';
    if (travelingToLocation) {
        return {
            label: resolveFriendWorldName(friend),
            meta:
                parseLocation(travelingToLocation).instanceName ||
                travelingToLocation
        };
    }

    return summarizeLocation(
        resolveFriendPresenceLocation(friend, { preferTraveling: false }),
        friend,
        t
    );
}

export function summarizeLocation(
    location: string,
    friend: FriendLocationFriend | null | undefined,
    t: TranslationFn | null = null
) {
    const parsedLocation = parseLocation(location);

    if (!location || parsedLocation.isOffline) {
        return {
            label: localized(t, 'location.offline', 'Offline'),
            meta: ''
        };
    }

    if (parsedLocation.isPrivate) {
        return {
            label: localized(t, 'location.private', 'Private'),
            meta: ''
        };
    }

    if (parsedLocation.isTraveling) {
        return {
            label: localized(t, 'location.traveling', 'Traveling'),
            meta: resolveFriendWorldName(friend) || location
        };
    }

    return {
        label: resolveFriendWorldName(friend),
        meta: [
            resolveFriendGroupName(friend),
            parsedLocation.accessTypeName,
            parsedLocation.instanceName
        ]
            .filter(Boolean)
            .join(' · ')
    };
}

export function resolveWorldDialogTarget(
    target: Partial<FriendLocationTarget> | null
) {
    const rawLocation = normalizeString(target?.rawLocation);
    const worldId = normalizeString(target?.worldId);
    const parsed = target?.parsed || parseLocation(rawLocation);
    if (parsed?.isRealInstance && parsed?.tag) {
        return parsed.tag;
    }
    const parsedWorldId = resolveWorldIdCandidate(parsed.worldId);
    return resolveWorldIdCandidate(worldId, parsedWorldId, rawLocation);
}
