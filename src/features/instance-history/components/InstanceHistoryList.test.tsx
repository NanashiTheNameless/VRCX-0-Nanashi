// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

const virtualizerMocks = vi.hoisted(() => ({
    scrollKeyToView: vi.fn()
}));

vi.mock('@/components/instances/InstanceActionBar', () => ({
    InstanceActionBar: () => null
}));

vi.mock('@/components/Location', () => ({
    Location: ({ location }: { location: string }) => <span>{location}</span>
}));

vi.mock('@/components/sidebar/useVirtualSidebarRows', () => ({
    useVirtualSidebarRows: () => ({
        getRowRef: () => () => undefined,
        viewportRef: () => undefined,
        virtualItems: [],
        totalSize: 0,
        firstVisibleIndex: 0,
        scrollKeyToView: (key: string | number, topInset?: number) =>
            virtualizerMocks.scrollKeyToView(key, topInset)
    })
}));

import {
    InstanceHistoryList,
    InstanceHistoryRow,
    resolveGrouping,
    rowKey
} from './InstanceHistoryList';

describe('resolveGrouping', () => {
    function rowsOnDays(days: string[]) {
        return days.map((day, index) => ({
            createdAt: `${day}T10:0${index}:00Z`,
            location: `wrld_test:${index}`,
            time: 60_000,
            events: [1]
        }));
    }

    it('groups by month when most days hold a single visit', () => {
        const rows = rowsOnDays([
            '2026-06-29',
            '2026-05-11',
            '2026-05-10',
            '2026-04-30'
        ]);

        expect(resolveGrouping(rows, true)).toBe('month');
    });

    it('groups by day when days hold several visits', () => {
        const rows = rowsOnDays([
            '2026-06-29',
            '2026-06-29',
            '2026-06-28',
            '2026-06-28'
        ]);

        expect(resolveGrouping(rows, true)).toBe('day');
    });

    it('disables grouping when the caller opts out', () => {
        expect(resolveGrouping(rowsOnDays(['2026-06-29']), false)).toBe('none');
        expect(resolveGrouping([], true)).toBe('none');
    });
});

describe('InstanceHistoryRow', () => {
    it('keeps row selection and deletion as separate native buttons', async () => {
        const user = userEvent.setup();
        const row = {
            createdAt: '2026-07-01T10:00:00Z',
            location: 'wrld_test:1',
            time: 60_000,
            events: [1]
        };
        const onOpenDetails = vi.fn();
        const onDeleteRow = vi.fn();

        render(
            <InstanceHistoryRow
                row={row}
                selected={false}
                showDate={false}
                onOpenDetails={onOpenDetails}
                onDeleteRow={onDeleteRow}
            />
        );

        const selectionButton = screen.getByRole('button', {
            name: /wrld_test:1/
        });
        const deleteButton = screen.getByRole('button', {
            name: 'common.actions.delete'
        });

        expect(selectionButton.tagName).toBe('BUTTON');
        await user.click(deleteButton);
        expect(onDeleteRow).toHaveBeenCalledWith(row);
        expect(onOpenDetails).not.toHaveBeenCalled();

        await user.click(selectionButton);
        expect(onOpenDetails).toHaveBeenCalledWith(row);
    });
});

describe('InstanceHistoryList', () => {
    it('does not relocate the selected row when virtual measurements update', () => {
        const row = {
            createdAt: '2026-07-01T10:00:00Z',
            location: 'wrld_test:1',
            time: 60_000,
            events: [1]
        };
        const visibleRows = [row];
        const props = {
            visibleRows,
            selectedRow: row,
            search: '',
            onSearchChange: vi.fn(),
            sortKey: 'date',
            onOpenDetails: vi.fn(),
            onDeleteRow: vi.fn()
        } satisfies ComponentProps<typeof InstanceHistoryList>;

        const { rerender } = render(<InstanceHistoryList {...props} />);

        expect(virtualizerMocks.scrollKeyToView).toHaveBeenCalledOnce();
        expect(virtualizerMocks.scrollKeyToView).toHaveBeenCalledWith(
            rowKey(row),
            28
        );

        rerender(<InstanceHistoryList {...props} />);

        expect(virtualizerMocks.scrollKeyToView).toHaveBeenCalledOnce();
    });
});
