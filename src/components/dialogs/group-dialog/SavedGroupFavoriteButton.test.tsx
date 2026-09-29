// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { createContext, useContext } from 'react';
import type { PropsWithChildren, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    addFavorite: vi.fn(),
    createCollection: vi.fn(),
    getFavorites: vi.fn(),
    prompt: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appSavedGroupCollectionCreate: mocks.createCollection,
        appSavedGroupFavoriteAdd: mocks.addFavorite,
        appSavedGroupFavoriteRemove: vi.fn(),
        appSavedGroupFavoritesGet: mocks.getFavorites
    }
}));

vi.mock('@/state/modalStore', () => ({
    useModalStore: <T,>(
        selector: (state: { prompt: typeof mocks.prompt }) => T
    ) => selector({ prompt: mocks.prompt })
}));

vi.mock('@/ui/shadcn/button', () => ({
    Button: ({
        children,
        size: _size,
        variant: _variant,
        ...props
    }: PropsWithChildren<{ size?: unknown; variant?: unknown }>) => (
        <button {...props}>{children}</button>
    )
}));

vi.mock('@/ui/shadcn/dropdown-menu', () => {
    const Container = ({ children }: PropsWithChildren) => (
        <div>{children}</div>
    );
    const GroupContext = createContext(false);
    const Group = ({ children }: PropsWithChildren) => (
        <GroupContext.Provider value>{children}</GroupContext.Provider>
    );
    const Label = ({ children }: PropsWithChildren) => {
        if (!useContext(GroupContext)) {
            throw new Error('MenuGroupContext is missing');
        }
        return <div>{children}</div>;
    };

    return {
        DropdownMenu: Container,
        DropdownMenuContent: Container,
        DropdownMenuGroup: Group,
        DropdownMenuItem: ({
            children,
            variant: _variant,
            ...props
        }: PropsWithChildren<{ variant?: unknown }>) => (
            <button {...props}>{children}</button>
        ),
        DropdownMenuLabel: Label,
        DropdownMenuSeparator: () => <hr />,
        DropdownMenuTrigger: ({ render }: { render?: ReactNode }) => render
    };
});

import { SavedGroupFavoriteButton } from './SavedGroupFavoriteButton';

describe('SavedGroupFavoriteButton', () => {
    beforeEach(() => {
        mocks.addFavorite.mockReset().mockResolvedValue(1);
        mocks.createCollection.mockReset().mockResolvedValue(1);
        mocks.getFavorites.mockReset();
        mocks.prompt.mockReset().mockResolvedValue({
            ok: true,
            value: 'Raid groups'
        });
    });

    afterEach(() => {
        cleanup();
    });

    it('creates the first collection from a modal prompt and adds the group to it', async () => {
        const createdSnapshot = {
            collections: [
                {
                    id: 'collection-1',
                    name: 'Raid groups',
                    groupIds: [],
                    createdAt: '2026-08-26T00:00:00Z'
                }
            ]
        };
        mocks.getFavorites
            .mockResolvedValueOnce({ collections: [] })
            .mockResolvedValue(createdSnapshot);

        render(<SavedGroupFavoriteButton groupId="grp_test" />);

        await waitFor(() => expect(mocks.getFavorites).toHaveBeenCalledOnce());

        fireEvent.click(
            screen.getByRole('button', {
                name: 'saved_group_favorites.new_collection'
            })
        );

        expect(mocks.prompt).toHaveBeenCalledWith(
            expect.objectContaining({
                confirmText: 'common.actions.confirm'
            })
        );
        await waitFor(() =>
            expect(mocks.addFavorite).toHaveBeenCalledWith({
                collectionId: 'collection-1',
                groupId: 'grp_test'
            })
        );
        expect(mocks.createCollection).toHaveBeenCalledWith({
            name: 'Raid groups'
        });
    });
});

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn(), close: vi.fn() }
}));
