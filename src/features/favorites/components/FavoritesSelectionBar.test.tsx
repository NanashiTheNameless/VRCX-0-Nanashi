// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, PropsWithChildren, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/ui/shadcn/button', () => ({
    Button: ({
        children,
        size: _size,
        variant: _variant,
        ...props
    }: PropsWithChildren<
        ComponentProps<'button'> & { size?: string; variant?: string }
    >) => <button {...props}>{children}</button>
}));

vi.mock('@/ui/shadcn/dropdown-menu', () => {
    const Container = ({ children }: PropsWithChildren) => (
        <div>{children}</div>
    );

    return {
        DropdownMenu: Container,
        DropdownMenuContent: Container,
        DropdownMenuGroup: Container,
        DropdownMenuItem: ({
            children,
            ...props
        }: ComponentProps<'button'>) => (
            <button role="menuitem" {...props}>
                {children}
            </button>
        ),
        DropdownMenuLabel: ({ children }: PropsWithChildren) => (
            <span>{children}</span>
        ),
        DropdownMenuSeparator: () => <hr />,
        DropdownMenuTrigger: ({ render }: { render?: ReactNode }) => (
            <>{render}</>
        )
    };
});

import type { FavoriteGroupView } from '../favoritesTypes';
import { FavoritesSelectionBar } from './FavoritesSelectionBar';

type SelectionBarProps = ComponentProps<typeof FavoritesSelectionBar>;

function createProps(
    overrides: Partial<SelectionBarProps> = {}
): SelectionBarProps {
    return {
        selectedCount: 2,
        isAllSelected: false,
        moveTargets: [],
        copyTargets: [],
        showCopyIdsButton: true,
        actionsDisabled: false,
        onSelectAll: vi.fn(),
        onClearSelection: vi.fn(),
        onCopyIds: vi.fn(),
        onCopySelection: vi.fn(),
        onMoveSelection: vi.fn(),
        onBulkRemove: vi.fn(),
        ...overrides
    };
}

describe('FavoritesSelectionBar', () => {
    afterEach(cleanup);

    it('does not render bulk controls without a selection', () => {
        render(
            <FavoritesSelectionBar {...createProps({ selectedCount: 0 })} />
        );

        expect(
            screen.queryByRole('button', {
                name: 'view.favorite.select_all'
            })
        ).toBeNull();
    });

    it('locks mutation actions while preserving selection controls', () => {
        const props = createProps({ actionsDisabled: true });
        render(<FavoritesSelectionBar {...props} />);

        expect(
            (
                screen.getByRole('button', {
                    name: 'view.favorite.select_all'
                }) as HTMLButtonElement
            ).disabled
        ).toBe(false);
        expect(
            (
                screen.getByRole('button', {
                    name: 'common.actions.clear'
                }) as HTMLButtonElement
            ).disabled
        ).toBe(false);
        for (const name of [
            'view.favorite.action.copy_ids',
            'view.favorite.action.copy_to',
            'view.favorite.action.move',
            'view.favorite.bulk_unfavorite'
        ]) {
            expect(
                (screen.getByRole('button', { name }) as HTMLButtonElement)
                    .disabled
            ).toBe(true);
        }

        fireEvent.click(
            screen.getByRole('button', { name: 'view.favorite.select_all' })
        );
        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.clear' })
        );
        expect(props.onSelectAll).toHaveBeenCalledOnce();
        expect(props.onClearSelection).toHaveBeenCalledOnce();
    });

    it('disables only over-capacity targets and preserves remote-first ordering', () => {
        const remoteFull: FavoriteGroupView = {
            key: 'remote-full',
            source: 'remote',
            label: 'Remote full',
            count: 99,
            capacity: 100
        };
        const localAvailable: FavoriteGroupView = {
            key: 'local-available',
            source: 'local',
            label: 'Local available',
            count: 3,
            capacity: 10
        };
        const props = createProps({
            moveTargets: [localAvailable, remoteFull],
            showCopyIdsButton: false
        });
        render(<FavoritesSelectionBar {...props} />);

        expect(
            screen.queryByRole('button', {
                name: 'view.favorite.action.copy_ids'
            })
        ).toBeNull();

        const targets = screen.getAllByRole('menuitem');
        expect(targets.map((target) => target.textContent)).toEqual([
            'Remote full (99/100)',
            'Local available (3/10)'
        ]);
        expect((targets[0] as HTMLButtonElement).disabled).toBe(true);
        expect((targets[1] as HTMLButtonElement).disabled).toBe(false);

        fireEvent.click(targets[1]);
        expect(props.onMoveSelection).toHaveBeenCalledWith(localAvailable);
    });
});
