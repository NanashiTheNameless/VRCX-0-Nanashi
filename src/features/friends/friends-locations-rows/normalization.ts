import { hasWorldIdPrefix } from '@/shared/constants/vrchatIds';
import { isRecord } from '@/shared/utils/record';
import { normalizeString } from '@/shared/utils/string';

import type {
    FriendLocationFriend,
    FriendLocationRecord,
    TranslationFn
} from './types';

export { isRecord };

export function sourceFromFriend(friend: unknown): FriendLocationRecord {
    return isRecord(friend) ? friend : {};
}

function interpolateFallback(
    value: unknown,
    values: Record<string, unknown> = {}
) {
    return String(value ?? '').replace(/\{(\w+)\}/g, (match, key) =>
        Object.hasOwn(values, key) ? String(values[key]) : match
    );
}

export function localized(
    t: TranslationFn | null | undefined,
    key: string,
    fallback: string,
    values: Record<string, unknown> = {}
) {
    if (typeof t !== 'function') {
        return interpolateFallback(fallback, values);
    }

    return interpolateFallback(
        t(key, { defaultValue: fallback, ...values }),
        values
    );
}

export function normalizeDisplayText(value: unknown) {
    if (typeof value === 'string') {
        return value.trim();
    }
    if (!isRecord(value)) {
        return String(value ?? '').trim();
    }
    const location = isRecord(value.$location) ? value.$location : {};
    return normalizeDisplayText(
        value.name ||
            value.displayName ||
            value.worldName ||
            value.groupName ||
            value.shortCode ||
            location.worldName ||
            location.groupName
    );
}

export function resolveWorldIdCandidate(...values: unknown[]) {
    for (const value of values) {
        const normalizedValue = normalizeString(value);
        if (normalizedValue && hasWorldIdPrefix(normalizedValue)) {
            return normalizedValue;
        }
    }
    return '';
}

export function isRawWorldReference(value: unknown) {
    return Boolean(resolveWorldIdCandidate(value));
}

export function resolveDisplayWorldName(...values: unknown[]) {
    for (const value of values) {
        const normalizedValue = normalizeDisplayText(value);
        if (normalizedValue && !isRawWorldReference(normalizedValue)) {
            return normalizedValue;
        }
    }
    return '';
}

export function uniqueFriendsById<TFriend extends FriendLocationFriend>(
    friends: TFriend[] | null
) {
    const seen = new Set<string>();
    const rows: TFriend[] = [];
    for (const friend of friends ?? []) {
        const id = normalizeString(
            isRecord(friend) ? friend.id || friend.userId : ''
        );
        if (!id) {
            rows.push(friend);
            continue;
        }
        if (seen.has(id)) {
            continue;
        }
        seen.add(id);
        rows.push(friend);
    }
    return rows;
}
