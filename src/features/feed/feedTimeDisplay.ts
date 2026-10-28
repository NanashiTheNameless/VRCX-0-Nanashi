import { formatDateFilter, formatRelativeTime } from '@/lib/dateTime';
import { dateFromUnknown } from '@/shared/utils/dateTime';
import { displayDayKey as toLocalDayKey } from '@/shared/utils/displayTimeZone';
import type { FeedTimeDisplayModePreference } from '@/state/preferencesStore';

type FeedTimestamp = number | string | null | undefined;

const MINUTE_MS = 60_000;
const RELATIVE_WIDTH_SAMPLE_OFFSETS_MS = [
    59 * MINUTE_MS,
    23 * 60 * MINUTE_MS,
    6 * 24 * 60 * MINUTE_MS,
    3 * 7 * 24 * 60 * MINUTE_MS,
    11 * 30 * 24 * 60 * MINUTE_MS,
    99 * 365 * 24 * 60 * MINUTE_MS
];

function parseTimestampMs(value: FeedTimestamp) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    return dateFromUnknown(value)?.getTime() ?? null;
}

export function formatFeedRelativeTime(value: FeedTimestamp, nowMs: number) {
    const timestampMs = parseTimestampMs(value);
    if (timestampMs === null) {
        return '-';
    }

    return formatRelativeTime(timestampMs, {
        nowMs,
        style: 'short',
        minUnit: 'minute'
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
    value
}: {
    mode: FeedTimeDisplayModePreference;
    nowMs: number;
    value: FeedTimestamp;
}) {
    if (mode === 'relative') {
        return {
            label: formatFeedRelativeTime(value, nowMs),
            title: formatFeedExactTime(value, 'long')
        };
    }

    return {
        label: formatFeedCompactTime(value, nowMs),
        title: `${formatFeedExactTime(value, 'long')} (${formatFeedRelativeTime(value, nowMs)})`
    };
}

function textWidthInCh(text: string) {
    let width = 0;
    for (const char of text) {
        width += (char.codePointAt(0) ?? 0) >= 0x2e80 ? 2 : 1;
    }
    return width;
}

const relativeTimeMinWidthByPreference = new Map<string, string>();

export function getFeedRelativeTimeMinWidth(preferenceKey: string) {
    const cached = relativeTimeMinWidthByPreference.get(preferenceKey);
    if (cached) {
        return cached;
    }
    const nowMs = Date.now();
    const samples = [
        formatFeedRelativeTime(new Date(nowMs).toISOString(), nowMs),
        ...RELATIVE_WIDTH_SAMPLE_OFFSETS_MS.map((offsetMs) =>
            formatFeedRelativeTime(
                new Date(nowMs - offsetMs).toISOString(),
                nowMs
            )
        )
    ];
    const minWidth = `${Math.max(...samples.map(textWidthInCh))}ch`;
    relativeTimeMinWidthByPreference.set(preferenceKey, minWidth);
    return minWidth;
}
