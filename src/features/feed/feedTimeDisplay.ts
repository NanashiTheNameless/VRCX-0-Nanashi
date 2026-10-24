import type { TFunction } from 'i18next';

import { formatDateFilter, formatRelativeTime } from '@/lib/dateTime';
import { dateFromUnknown } from '@/shared/utils/dateTime';
import { displayDayKey as toLocalDayKey } from '@/shared/utils/displayTimeZone';
import type { FeedTimeDisplayModePreference } from '@/state/preferencesStore';

type FeedTimestamp = number | string | null | undefined;

function parseTimestampMs(value: FeedTimestamp) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    return dateFromUnknown(value)?.getTime() ?? null;
}

export function formatFeedRelativeTime(
    value: FeedTimestamp,
    nowMs: number,
    _t: TFunction
) {
    const timestampMs = parseTimestampMs(value);
    if (timestampMs === null) {
        return '-';
    }

    return formatRelativeTime(timestampMs, {
        nowMs,
        style: 'short'
    });
}

export function isSameLocalDay(timestampMs: number, nowMs: number) {
    return (
        toLocalDayKey(new Date(timestampMs)) === toLocalDayKey(new Date(nowMs))
    );
}

export function formatFeedExactTime(
    value: FeedTimestamp,
    format: 'short' | 'long' = 'short'
) {
    if (value === null || value === undefined || value === '') {
        return '-';
    }

    return formatDateFilter(value, format);
}

function formatFeedCompactTime(value: FeedTimestamp, nowMs: number) {
    const timestampMs = parseTimestampMs(value);
    if (timestampMs !== null && isSameLocalDay(timestampMs, nowMs)) {
        return formatDateFilter(value, 'time');
    }

    return formatFeedExactTime(value, 'short');
}

export function resolveFeedColumnTimeDisplay({
    mode,
    nowMs,
    t,
    value
}: {
    mode: FeedTimeDisplayModePreference;
    nowMs: number;
    t: TFunction;
    value: FeedTimestamp;
}) {
    if (mode === 'relative') {
        return {
            label: formatFeedRelativeTime(value, nowMs, t),
            title: formatFeedExactTime(value, 'long')
        };
    }

    return {
        label: formatFeedCompactTime(value, nowMs),
        title: `${formatFeedExactTime(value, 'long')} (${formatFeedRelativeTime(value, nowMs, t)})`
    };
}
