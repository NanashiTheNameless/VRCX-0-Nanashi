import { getFeedRowId } from '@/components/feed/feedRows';
import type { FeedRow } from '@/components/feed/feedTypes';
import { displayDayKey } from '@/shared/utils/displayTimeZone';

export type FeedListEntry =
    | { kind: 'day'; key: string; createdAt: FeedRow['created_at'] }
    | { kind: 'row'; key: string; row: FeedRow };

// Days follow the display timezone setting, not the device clock.
// 0 is how the fork stores a missing timestamp.
export function feedLocalDayKey(value: unknown): string {
    return value ? displayDayKey(value) : '';
}

export function buildFeedListEntries(
    rows: readonly FeedRow[],
    todayKey: string
) {
    const entries: FeedListEntry[] = [];
    const seenDays = new Set<string>([todayKey]);
    for (const row of rows) {
        const dayKey = feedLocalDayKey(row.created_at);
        if (dayKey && !seenDays.has(dayKey)) {
            seenDays.add(dayKey);
            entries.push({
                kind: 'day',
                key: `day:${dayKey}`,
                createdAt: row.created_at
            });
        }
        entries.push({ kind: 'row', key: getFeedRowId(row), row });
    }
    return entries;
}
