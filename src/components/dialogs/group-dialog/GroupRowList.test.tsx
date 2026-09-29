// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type QueryOptions = {
    enabled?: boolean;
    queryFn: () => Promise<unknown>;
};

const mocks = vi.hoisted(() => ({
    getUserProfile: vi.fn(() => Promise.resolve({})),
    knownUser: null as Record<string, unknown> | null,
    openUserDialog: vi.fn(),
    queryData: null as Record<string, unknown> | null
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('@tanstack/react-query')>();
    const { useEffect } = await import('react');
    return {
        ...actual,
        useQuery: (options: QueryOptions) => {
            const { enabled, queryFn } = options;
            useEffect(() => {
                if (enabled) {
                    void queryFn();
                }
            }, [enabled, queryFn]);
            return { data: mocks.queryData };
        }
    };
});

vi.mock('@/lib/useKnownUser', () => ({
    useKnownUserFact: () => mocks.knownUser
}));
vi.mock('@/repositories/userProfileRepository', () => ({
    default: { getUserProfile: mocks.getUserProfile }
}));
vi.mock('@/services/dialogService', () => ({
    openUserDialog: mocks.openUserDialog
}));
vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: (
        selector: (state: { auth: { currentUserEndpoint: string } }) => unknown
    ) =>
        selector({
            auth: { currentUserEndpoint: 'https://api.vrchat.cloud' }
        })
}));
vi.mock('@/ui/shadcn/button', () => ({
    Button: ({
        children,
        onClick
    }: {
        children: ReactNode;
        onClick?: () => void;
    }) => (
        <button type="button" onClick={onClick}>
            {children}
        </button>
    )
}));

import { RowList } from './GroupRowList';

describe('group post authors', () => {
    afterEach(cleanup);

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.knownUser = null;
        mocks.queryData = null;
    });

    it('resolves an id-only author and opens the user dialog', async () => {
        mocks.queryData = {
            id: 'usr_author',
            displayName: 'Resolved author'
        };

        render(
            <RowList
                kind="posts"
                rows={[
                    {
                        id: 'post_1',
                        title: 'Announcement',
                        authorId: 'usr_author'
                    }
                ]}
            />
        );

        await waitFor(() => {
            expect(mocks.getUserProfile).toHaveBeenCalledWith({
                userId: 'usr_author'
            });
        });
        expect(screen.getByText('Resolved author')).toBeTruthy();
        expect(screen.queryByText('usr_author')).toBeNull();

        fireEvent.click(
            screen.getByRole('button', { name: 'Resolved author' })
        );
        expect(mocks.openUserDialog).toHaveBeenCalledWith({
            userId: 'usr_author',
            title: 'Resolved author',
            seedData: mocks.queryData
        });
    });

    it('uses a known author name without requesting the profile again', () => {
        mocks.knownUser = {
            id: 'usr_author',
            displayName: 'Known author'
        };

        render(
            <RowList
                kind="posts"
                rows={[
                    {
                        id: 'post_1',
                        title: 'Announcement',
                        authorId: 'usr_author'
                    }
                ]}
            />
        );

        expect(screen.getByText('Known author')).toBeTruthy();
        expect(mocks.getUserProfile).not.toHaveBeenCalled();
    });

    it('does not render a raw user id while resolving the author', async () => {
        render(
            <RowList
                kind="posts"
                rows={[
                    {
                        id: 'post_1',
                        title: 'Announcement',
                        authorId: 'usr_author'
                    }
                ]}
            />
        );

        await waitFor(() => {
            expect(mocks.getUserProfile).toHaveBeenCalledWith({
                userId: 'usr_author'
            });
        });
        expect(screen.queryByText('usr_author')).toBeNull();
    });
});
