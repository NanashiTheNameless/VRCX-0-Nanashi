import { beforeEach, describe, expect, it } from 'vitest';

import {
    GAME_LOG_COLUMN_IDS,
    GAME_LOG_DEFAULT_PAGE_SIZES,
    GAME_LOG_DEFAULT_SORTING,
    readPersistedGameLogState,
    resolveGameLogPageSize,
    sanitizeGameLogColumnOrder,
    sanitizeGameLogColumnVisibility,
    sanitizeGameLogPageSizes,
    sanitizeGameLogSorting,
    writePersistedGameLogState
} from './gameLogState';

const STORAGE_KEY = 'vrcx-0:table:gameLog';

beforeEach(() => {
    localStorage.clear();
});

describe('gameLogState', () => {
    it('restores and merges the saved game-log table layout', () => {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                sorting: [{ id: 'type', desc: false }],
                pageSize: 50
            })
        );

        expect(readPersistedGameLogState()).toMatchObject({
            sorting: [{ id: 'type', desc: false }],
            pageSize: 50
        });

        writePersistedGameLogState({
            columnVisibility: { detail: false }
        });

        expect(readPersistedGameLogState()).toMatchObject({
            sorting: [{ id: 'type', desc: false }],
            pageSize: 50,
            columnVisibility: { detail: false }
        });
        expect(readPersistedGameLogState().updatedAt).toEqual(
            expect.any(Number)
        );
    });

    it('falls back to defaults when saved sorting or page sizes are unusable', () => {
        expect(readPersistedGameLogState()).toEqual({});

        localStorage.setItem(STORAGE_KEY, '{not-json');
        expect(readPersistedGameLogState()).toEqual({});

        expect(sanitizeGameLogSorting([{ id: 'unknown', desc: true }])).toBe(
            GAME_LOG_DEFAULT_SORTING
        );
        expect(sanitizeGameLogPageSizes(['bad', 0])).toBe(
            GAME_LOG_DEFAULT_PAGE_SIZES
        );
    });

    it('keeps supported sorting and page-size choices users can select', () => {
        expect(
            sanitizeGameLogSorting([
                { id: 'created_at', desc: true },
                { id: 'type', desc: false },
                { id: 'unknown', desc: false },
                { id: 'detail', desc: false },
                { id: 'displayName', desc: false },
                { id: 'spacer', desc: false },
                { id: 'action', desc: true }
            ])
        ).toEqual([
            { id: 'created_at', desc: true },
            { id: 'type', desc: false }
        ]);

        expect(sanitizeGameLogPageSizes(['50', 10, 25, 10])).toEqual([
            10, 25, 50
        ]);
        expect(resolveGameLogPageSize('50', [10, 25, 50], 25)).toBe(50);
        expect(resolveGameLogPageSize('999', [10, 25, 50], 25)).toBe(50);
        expect(resolveGameLogPageSize('bad', [], 25)).toBe(10);
    });

    it('restores default sorting when saved columns cannot sort', () => {
        expect(sanitizeGameLogSorting([])).toBe(GAME_LOG_DEFAULT_SORTING);
        expect(
            sanitizeGameLogSorting([
                { id: 'detail', desc: false },
                { id: 'spacer', desc: false },
                { id: 'action', desc: true }
            ])
        ).toBe(GAME_LOG_DEFAULT_SORTING);
    });

    it('sanitizes saved columns while keeping the spacer column first', () => {
        expect(
            sanitizeGameLogColumnVisibility({
                created_at: false,
                detail: true,
                unknown: false
            })
        ).toEqual({
            created_at: false,
            detail: true
        });

        expect(sanitizeGameLogColumnOrder(['detail', 'type'])).toEqual([
            'spacer',
            'detail',
            'type',
            ...GAME_LOG_COLUMN_IDS.filter(
                (columnId) =>
                    columnId !== 'spacer' &&
                    columnId !== 'detail' &&
                    columnId !== 'type'
            )
        ]);
    });
});
