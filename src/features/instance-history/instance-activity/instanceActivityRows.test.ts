import { describe, expect, it } from 'vitest';

import {
    buildChartRows,
    buildDetailGroups,
    filterDetailGroups,
    getLocalDayBounds
} from './instanceActivityRows';
import type { InstanceActivityDetailRow } from './instanceActivityTypes';

function iso(value: number | string | Date) {
    return Math.floor(new Date(value).getTime() / 1000);
}

function detailRow(id: string, isFriend: boolean): InstanceActivityDetailRow {
    return {
        id,
        created_at: 1704153600,
        user_id: id,
        display_name: id,
        location: 'wrld_filter:1',
        time: 1,
        type: 'Location',
        displayName: id,
        userId: id,
        joinMs: 0,
        leaveMs: 1,
        durationMs: 1,
        isCurrentUser: id === 'self',
        isFriend,
        isFavorite: false
    };
}

describe('instanceActivityRows', () => {
    it('normalizes current-user chart rows, clips them to the selected local day, and sorts by join time', () => {
        const selectedDate = '2024-01-02';
        const { startMs } = getLocalDayBounds(selectedDate);
        const currentUserId = 'usr_self';

        const rows = buildChartRows(
            [
                {
                    id: 1,
                    user_id: currentUserId,
                    display_name: 'Self',
                    location: 'wrld_late:2',
                    created_at: iso(startMs + 5 * 60 * 60 * 1000),
                    time: 60 * 60 * 1000,
                    type: 'Location'
                },
                {
                    id: 2,
                    user_id: 'usr_other',
                    display_name: 'Other',
                    location: 'wrld_other:1',
                    created_at: iso(startMs + 2 * 60 * 60 * 1000),
                    time: 60 * 60 * 1000,
                    type: 'Location'
                },
                {
                    id: 3,
                    user_id: currentUserId,
                    display_name: 'Self',
                    location: 'traveling:traveling',
                    created_at: iso(startMs + 3 * 60 * 60 * 1000),
                    time: 60 * 60 * 1000,
                    type: 'Location'
                },
                {
                    id: 4,
                    user_id: currentUserId,
                    display_name: 'Self',
                    location: 'wrld_known:1',
                    created_at: iso(startMs + 2 * 60 * 60 * 1000),
                    time: 4 * 60 * 60 * 1000,
                    type: 'Location'
                }
            ],
            selectedDate,
            currentUserId,
            {
                wrld_known: { name: 'Known World' }
            }
        );

        expect(rows).toHaveLength(2);
        expect(rows.map((row) => row.id)).toEqual(['4', '1']);
        expect(rows[0]).toMatchObject({
            worldId: 'wrld_known',
            worldName: 'Known World',
            worldResolvedFromCache: true,
            visibleStartMs: startMs,
            visibleDurationMs: 2 * 60 * 60 * 1000
        });
        expect(rows[1]).toMatchObject({
            worldId: 'wrld_late',
            worldName: '',
            visibleStartMs: startMs + 4 * 60 * 60 * 1000,
            visibleDurationMs: 60 * 60 * 1000
        });
    });

    it('groups instance details by current-user overlap and preserves friend markers', () => {
        const { startMs } = getLocalDayBounds('2024-01-02');
        const currentUserId = 'usr_self';
        const location = 'wrld_group:1';
        const rawRows = [
            {
                id: 10,
                user_id: currentUserId,
                display_name: 'Self',
                location,
                created_at: iso(startMs + 60 * 60 * 1000),
                time: 60 * 60 * 1000,
                type: 'Location'
            },
            {
                id: 11,
                user_id: 'usr_friend',
                display_name: 'Friend',
                location,
                created_at: iso(startMs + 45 * 60 * 1000),
                time: 30 * 60 * 1000,
                type: 'Location'
            },
            {
                id: 12,
                user_id: currentUserId,
                display_name: 'Self',
                location,
                created_at: iso(startMs + 4 * 60 * 60 * 1000),
                time: 60 * 60 * 1000,
                type: 'Location'
            },
            {
                id: 13,
                user_id: 'usr_favorite',
                display_name: 'Favorite',
                location,
                created_at: iso(startMs + 3.5 * 60 * 60 * 1000),
                time: 15 * 60 * 1000,
                type: 'Location'
            }
        ];

        const chartRows = buildChartRows(
            rawRows,
            '2024-01-02',
            currentUserId,
            {}
        );
        const groups = buildDetailGroups(
            rawRows,
            chartRows,
            currentUserId,
            new Set(['usr_friend']),
            new Set(['usr_favorite'])
        );

        expect(groups).toHaveLength(2);
        expect(groups.map((group) => group.map((entry) => entry.id))).toEqual([
            ['10', '11'],
            ['12', '13']
        ]);
        expect(
            groups[0].find((entry) => entry.userId === 'usr_friend')
        ).toMatchObject({
            isFriend: true,
            isFavorite: false
        });
        expect(
            groups[1].find((entry) => entry.userId === 'usr_favorite')
        ).toMatchObject({
            isFriend: true,
            isFavorite: true
        });
        expect(
            groups.flat().filter((entry) => entry.userId === currentUserId)
        ).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    isCurrentUser: true,
                    isFriend: false,
                    isFavorite: false
                })
            ])
        );
    });

    it('filters detail groups according to instance visibility toggles', () => {
        const soloGroup = [detailRow('solo', false)];
        const noFriendGroup = [
            detailRow('self', false),
            detailRow('stranger', false)
        ];
        const friendGroup = [
            detailRow('self', false),
            detailRow('friend', true)
        ];
        const groups = [soloGroup, noFriendGroup, friendGroup];

        expect(
            filterDetailGroups(groups, {
                isSoloInstanceVisible: false,
                isNoFriendInstanceVisible: true
            })
        ).toEqual([noFriendGroup, friendGroup]);
        expect(
            filterDetailGroups(groups, {
                isSoloInstanceVisible: true,
                isNoFriendInstanceVisible: false
            })
        ).toEqual([soloGroup, friendGroup]);
    });
});
