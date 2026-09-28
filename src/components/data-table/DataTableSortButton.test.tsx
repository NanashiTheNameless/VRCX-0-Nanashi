// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DataTableSortButton } from './DataTableSortButton';

afterEach(() => {
    cleanup();
});

describe('DataTableSortButton (controlled mode)', () => {
    it('cycles a column through ascending, then descending, then back to unsorted on repeated clicks', () => {
        const onSort = vi.fn();
        const { rerender } = render(
            <DataTableSortButton
                label="Display Name"
                direction={false}
                onSort={onSort}
            />
        );

        fireEvent.click(screen.getByRole('button'));
        expect(onSort).toHaveBeenLastCalledWith('asc', false);

        rerender(
            <DataTableSortButton
                label="Display Name"
                direction="asc"
                onSort={onSort}
            />
        );
        fireEvent.click(screen.getByRole('button'));
        expect(onSort).toHaveBeenLastCalledWith('desc', 'asc');

        rerender(
            <DataTableSortButton
                label="Display Name"
                direction="desc"
                onSort={onSort}
            />
        );
        fireEvent.click(screen.getByRole('button'));
        expect(onSort).toHaveBeenLastCalledWith(false, 'desc');
    });

    it('starts a table that wants its busiest column first (e.g. last-seen time) sorted descending on the very first click', () => {
        const onSort = vi.fn();
        render(
            <DataTableSortButton
                label="Last Seen"
                direction={false}
                descFirst
                onSort={onSort}
            />
        );

        fireEvent.click(screen.getByRole('button'));
        expect(onSort).toHaveBeenLastCalledWith('desc', false);
    });
});

describe('DataTableSortButton (bound to a TanStack Table column)', () => {
    function createColumnStub(initialSort: 'asc' | 'desc' | false) {
        let sorted = initialSort;
        return {
            getIsSorted: () => sorted,
            toggleSorting: (desc: boolean) => {
                sorted = desc ? 'desc' : 'asc';
            },
            clearSorting: () => {
                sorted = false;
            },
            __getState: () => sorted
        };
    }

    it("drives the bound column's own sort state directly, so clicking the header updates the table without an onSort prop", () => {
        const column = createColumnStub(false);
        render(
            <DataTableSortButton
                label="Display Name"
                column={column as never}
            />
        );

        fireEvent.click(screen.getByRole('button'));
        expect(column.__getState()).toBe('asc');
    });

    it('clears sorting on the bound column once it cycles past descending', () => {
        const column = createColumnStub('desc');
        render(
            <DataTableSortButton
                label="Display Name"
                column={column as never}
            />
        );

        fireEvent.click(screen.getByRole('button'));
        expect(column.__getState()).toBe(false);
    });
});
