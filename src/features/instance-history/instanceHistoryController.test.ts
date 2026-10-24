import { describe, expect, it } from 'vitest';

import {
    buildInstanceHistorySearchParams,
    filterAndSortInstanceHistoryRows
} from './instanceHistoryController';

describe('buildInstanceHistorySearchParams', () => {
    it('omits default search mode and self scope', () => {
        expect(
            buildInstanceHistorySearchParams({
                currentUserId: 'usr_self',
                mode: 'search',
                userId: 'usr_self'
            }).toString()
        ).toBe('');
    });

    it('keeps day mode and an explicit user scope', () => {
        expect(
            buildInstanceHistorySearchParams({
                currentUserId: 'usr_self',
                mode: 'day',
                userId: 'usr_other'
            }).toString()
        ).toBe('mode=day&scope=user&id=usr_other');
    });
});

describe('filterAndSortInstanceHistoryRows', () => {
    it('applies the date range before text filtering and sorting', () => {
        const rows = [
            {
                id: 'older',
                createdAt: 1786276800,
                location: 'wrld_match:2',
                worldName: 'Match World',
                events: [2]
            },
            {
                id: 'newer',
                createdAt: 1786363200,
                location: 'wrld_match:1',
                worldName: 'Match World',
                events: [1]
            },
            {
                id: 'outside',
                createdAt: 1785585600,
                location: 'wrld_match:3',
                worldName: 'Match World',
                events: [3]
            }
        ];

        expect(
            filterAndSortInstanceHistoryRows({
                from: new Date('2026-08-08T00:00:00.000Z'),
                query: 'match',
                rows,
                sortDesc: true,
                sortKey: 'date',
                to: new Date('2026-08-11T00:00:00.000Z')
            }).map((row) => row.id)
        ).toEqual(['newer', 'older']);
    });
});
