import { describe, expect, it } from 'vitest';

import type { BrowseHistoryItemOutput } from '@/platform/tauri/bindings';

import {
    BROWSE_HISTORY_CARD_HEIGHT,
    BROWSE_HISTORY_GRID_GAP,
    BROWSE_HISTORY_HEADING_HEIGHT,
    buildBrowseHistoryRows
} from './browseHistoryRows';

function item(entityId: string, lastViewedAt: string): BrowseHistoryItemOutput {
    return {
        entityKind: 'world',
        entityId,
        title: entityId,
        imageUrl: '',
        firstViewedAt: lastViewedAt,
        lastViewedAt,
        viewCount: 1
    };
}

describe('buildBrowseHistoryRows', () => {
    it('groups days and chunks cards to the current column count', () => {
        const result = buildBrowseHistoryRows(
            [
                item('a', '2026-08-05T12:00:00Z'),
                item('b', '2026-08-05T11:00:00Z'),
                item('c', '2026-08-05T10:00:00Z'),
                item('d', '2026-08-04T10:00:00Z')
            ],
            2
        );

        expect(result.rows.map((row) => row.kind)).toEqual([
            'heading',
            'cards',
            'cards',
            'heading',
            'cards'
        ]);
        expect(result.totalHeight).toBe(
            BROWSE_HISTORY_HEADING_HEIGHT * 2 +
                (BROWSE_HISTORY_CARD_HEIGHT + BROWSE_HISTORY_GRID_GAP) * 3
        );
    });
});
