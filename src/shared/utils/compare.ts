import {
    presenceOf,
    presencePlace,
    presenceSection
} from '@/domain/friends/presence';

import { sortStatus } from './friendStatus';

type ComparableFieldValue = string | number | undefined;

type ComparableRecord = Record<string, unknown> & {
    $friendNumber?: number;
    created_at?: string;
    displayName?: string;
    id?: string;
    last_activity?: ComparableFieldValue;
    last_login?: ComparableFieldValue;
    memberCount?: number;
    name?: string | null;
    status?: string | null;
    updated_at?: string;
};
type Comparator = (a: ComparableRecord, b: ComparableRecord) => number;

// Mirrors JS `<` semantics for possibly-undefined operands: any comparison
// involving `undefined` is false, so it ranks the value as "not lower".
function isLessThan(a: ComparableFieldValue, b: ComparableFieldValue): boolean {
    if (a === undefined || b === undefined) {
        return false;
    }
    return a < b;
}

function isGreaterThan(
    a: ComparableFieldValue,
    b: ComparableFieldValue
): boolean {
    if (a === undefined || b === undefined) {
        return false;
    }
    return a > b;
}

function isOnlineRecord(record: ComparableRecord): boolean {
    const presence = presenceOf(record);
    return presence ? presenceSection(presence) === 'online' : false;
}

function recordPlace(record: ComparableRecord) {
    const presence = presenceOf(record);
    return presence ? presencePlace(presence)?.location : null;
}

function activityValue(
    record: ComparableRecord,
    field: string
): ComparableFieldValue {
    const value = record[field];
    return typeof value === 'string' || typeof value === 'number'
        ? value
        : undefined;
}

function compareByName(a: ComparableRecord, b: ComparableRecord): number {
    if (typeof a.name !== 'string' || typeof b.name !== 'string') {
        return 0;
    }
    return a.name.localeCompare(b.name);
}

function compareByDisplayName(
    a: ComparableRecord,
    b: ComparableRecord
): number {
    if (
        typeof a.displayName !== 'string' ||
        typeof b.displayName !== 'string'
    ) {
        return 0;
    }
    return a.displayName.localeCompare(b.displayName);
}

function compareByMemberCount(
    a: ComparableRecord,
    b: ComparableRecord
): number {
    if (
        typeof a.memberCount !== 'number' ||
        typeof b.memberCount !== 'number'
    ) {
        return 0;
    }
    return a.memberCount - b.memberCount;
}

function compareByPrivate(a: ComparableRecord, b: ComparableRecord): number {
    const aPrivate = recordPlace(a)?.isPrivate === true;
    const bPrivate = recordPlace(b)?.isPrivate === true;
    if (aPrivate === bPrivate) {
        return 0;
    }
    return aPrivate ? 1 : -1;
}

function compareByStatus(a: ComparableRecord, b: ComparableRecord): number {
    const aOffline = presenceOf(a)?.kind === 'offline';
    const bOffline = presenceOf(b)?.kind === 'offline';
    if (aOffline && !bOffline) {
        return 1;
    }
    if (!aOffline && bOffline) {
        return -1;
    }
    if (a.status === b.status) {
        return 0;
    }
    return sortStatus(a.status ?? '', b.status ?? '');
}

function onlineSince(record: ComparableRecord) {
    const presence = presenceOf(record);
    const since =
        presence?.kind === 'online' || presence?.kind === 'pendingOffline'
            ? presence.onlineSinceMs
            : null;
    return since ?? 0;
}

function compareByLastActive(a: ComparableRecord, b: ComparableRecord): number {
    if (isOnlineRecord(a) && isOnlineRecord(b)) {
        const aSince = onlineSince(a);
        const bSince = onlineSince(b);
        if (aSince && bSince && aSince === bSince) {
            return compareByActivityField(a, b, 'last_login');
        }
        return compareActivityValues(aSince, bSince);
    }

    return compareByActivityField(a, b, 'last_activity');
}

function compareByLastSeen(aLastSeen?: string, bLastSeen?: string): number {
    if (!aLastSeen || !bLastSeen) {
        return Number(!aLastSeen) - Number(!bLastSeen);
    }
    return compareActivityValues(aLastSeen, bLastSeen);
}

function compareByActivityField(
    a: ComparableRecord,
    b: ComparableRecord,
    field: string
): number {
    return compareActivityValues(
        activityValue(a, field),
        activityValue(b, field)
    );
}

function compareActivityValues(
    aValue: ComparableFieldValue,
    bValue: ComparableFieldValue
): number {
    // When the field is just and empty string, it means they've been
    // in whatever active state for the longest
    if (isLessThan(aValue, bValue) || (aValue !== '' && bValue === '')) {
        return 1;
    }
    if (isGreaterThan(aValue, bValue) || (aValue === '' && bValue !== '')) {
        return -1;
    }
    return 0;
}

function compareByLocationAt(
    a: ComparableRecord,
    b: ComparableRecord,
    aStaySinceMs?: number,
    bStaySinceMs?: number
): number {
    const aTraveling = recordPlace(a)?.isTraveling === true;
    const bTraveling = recordPlace(b)?.isTraveling === true;
    if (aTraveling !== bTraveling) {
        return aTraveling ? 1 : -1;
    }
    if (aTraveling) {
        return 0;
    }
    if (isLessThan(aStaySinceMs, bStaySinceMs)) {
        return -1;
    }
    if (isGreaterThan(aStaySinceMs, bStaySinceMs)) {
        return 1;
    }
    return 0;
}

function compareByLocation(a: ComparableRecord, b: ComparableRecord): number {
    if (!isOnlineRecord(a) || !isOnlineRecord(b)) {
        return 0;
    }

    return (recordPlace(a)?.tag ?? '').localeCompare(recordPlace(b)?.tag ?? '');
}

function compareByFriendOrder(
    a: ComparableRecord,
    b: ComparableRecord
): number {
    if (typeof a === 'undefined' || typeof b === 'undefined') {
        return 0;
    }
    return (b.$friendNumber ?? NaN) - (a.$friendNumber ?? NaN);
}

export {
    compareByName,
    compareByDisplayName,
    compareByMemberCount,
    compareByPrivate,
    compareByStatus,
    compareByLastActive,
    compareByLastSeen,
    compareByLocationAt,
    compareByLocation,
    compareByFriendOrder
};
export type { ComparableRecord, Comparator };
