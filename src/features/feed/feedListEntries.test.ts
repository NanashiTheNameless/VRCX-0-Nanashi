import { afterEach, describe, expect, it } from 'vitest';

import type { FeedRow } from '@/components/feed/feedTypes';
import { setDisplayTimeZone } from '@/shared/utils/displayTimeZone';

import { buildFeedListEntries, feedLocalDayKey } from './feedListEntries';

// Feed rows store epoch seconds; 0 stands for a missing timestamp.
function row(rowId: number, createdAt: Date | null): FeedRow {
    return {
        created_at: createdAt ? Math.floor(createdAt.getTime() / 1000) : 0,
        rowId,
        sourceRank: 40,
        type: 'GPS'
    };
}

describe('buildFeedListEntries', () => {
    it('heads each earlier local day but leaves today unlabeled', () => {
        const entries = buildFeedListEntries(
            [
                row(4, new Date(2026, 10, 8, 0, 37)),
                row(3, new Date(2026, 10, 8, 0, 1)),
                row(2, new Date(2026, 10, 7, 23, 59)),
                row(1, new Date(2026, 10, 6, 12, 0))
            ],
            '2026-11-08'
        );

        expect(
            entries.map((entry) =>
                entry.kind === 'day' ? entry.key : entry.row.rowId
            )
        ).toEqual([4, 3, 'day:2026-11-07', 2, 'day:2026-11-06', 1]);
    });

    it('keeps rows without a usable timestamp under the current day', () => {
        const entries = buildFeedListEntries(
            [
                row(3, new Date(2026, 10, 8, 1, 0)),
                row(2, null),
                row(1, new Date(2026, 10, 8, 0, 0))
            ],
            '2026-11-09'
        );

        expect(entries.filter((entry) => entry.kind === 'day')).toHaveLength(1);
        expect(entries).toHaveLength(4);
    });

    it('never repeats a day heading key for out-of-order rows', () => {
        const entries = buildFeedListEntries(
            [
                row(3, new Date(2026, 10, 8, 1, 0)),
                row(2, new Date(2026, 10, 7, 1, 0)),
                row(1, new Date(2026, 10, 8, 0, 0))
            ],
            '2026-11-09'
        );
        const keys = entries.map((entry) => entry.key);

        expect(new Set(keys).size).toBe(keys.length);
    });
});

describe('feedLocalDayKey', () => {
    afterEach(() => setDisplayTimeZone(''));

    it('follows the display timezone setting, not the device clock', () => {
        // 2026-11-07 22:30 UTC is already 2026-11-08 at UTC+05:45.
        const instant = Date.UTC(2026, 10, 7, 22, 30) / 1000;
        setDisplayTimeZone('UTC');
        expect(feedLocalDayKey(instant)).toBe('2026-11-07');
        setDisplayTimeZone('UTC+05:45');
        expect(feedLocalDayKey(instant)).toBe('2026-11-08');
    });

    it('uses the local calendar day', () => {
        expect(feedLocalDayKey(new Date(2026, 0, 2, 23, 30))).toBe(
            '2026-01-02'
        );
        expect(feedLocalDayKey('not a date')).toBe('');
    });
});
