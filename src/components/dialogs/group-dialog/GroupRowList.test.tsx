// @vitest-environment jsdom

import {
    act,
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
    queryData: null as Record<string, unknown> | null,
    translateTextDetailed: vi.fn()
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
vi.mock('@/services/translationService', () => ({
    getTranslationConfig: () =>
        Promise.resolve({ enabled: true, bioLanguage: 'en', type: 'google' }),
    translateTextDetailed: mocks.translateTextDetailed
}));
vi.mock('@/ui/shadcn/button', () => ({
    Button: ({
        children,
        onClick,
        'aria-label': ariaLabel
    }: {
        children: ReactNode;
        onClick?: () => void;
        'aria-label'?: string;
    }) => (
        <button type="button" aria-label={ariaLabel} onClick={onClick}>
            {children}
        </button>
    )
}));

import { setDisplayTimeZone } from '@/shared/utils/displayTimeZone';
import { usePreferencesStore } from '@/state/preferencesStore';

import { RowList } from './GroupRowList';

describe('group post authors', () => {
    afterEach(() => {
        cleanup();
        setDisplayTimeZone('');
        usePreferencesStore.setState({ dtTimeZone: '' });
    });

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

describe('group post cards', () => {
    afterEach(() => {
        cleanup();
        setDisplayTimeZone('');
        usePreferencesStore.setState({ dtTimeZone: '' });
    });

    it('marks a post as edited only when it changed after creation', () => {
        render(
            <RowList
                kind="posts"
                rows={[
                    {
                        id: 'post_edited',
                        title: 'Revised',
                        createdAt: '2026-10-08T12:00:00.000Z',
                        updatedAt: '2026-10-08T14:00:00.000Z'
                    },
                    {
                        id: 'post_fresh',
                        title: 'Untouched',
                        createdAt: '2026-10-08T10:00:00.000Z',
                        updatedAt: '2026-10-08T10:00:00.500Z'
                    }
                ]}
            />
        );

        expect(
            screen.getByText('Revised').closest('article')?.textContent
        ).toContain('dialog.group.posts.edited');
        expect(
            screen.getByText('Untouched').closest('article')?.textContent
        ).not.toContain('dialog.group.posts.edited');
    });

    it('marks posts with canonical epoch-second timestamps as edited', () => {
        render(
            <RowList
                kind="posts"
                rows={[
                    {
                        id: 'seconds',
                        title: 'Revised seconds',
                        createdAt: 1700000000,
                        updatedAt: 1700000120
                    }
                ]}
            />
        );
        expect(
            screen.getByText('Revised seconds').closest('article')?.textContent
        ).toContain('dialog.group.posts.edited');
    });

    it('separates posts from different days', () => {
        const { container } = render(
            <RowList
                kind="posts"
                rows={[
                    {
                        id: 'post_1',
                        title: 'Late post',
                        createdAt: '2026-10-24T12:30:00.000Z'
                    },
                    {
                        id: 'post_2',
                        title: 'Same day post',
                        createdAt: '2026-10-24T12:00:00.000Z'
                    },
                    {
                        id: 'post_3',
                        title: 'Older post',
                        createdAt: '2026-10-08T12:00:00.000Z'
                    }
                ]}
            />
        );

        expect(container.querySelectorAll('article')).toHaveLength(3);
        expect(
            container.querySelectorAll('[data-slot="separator"]')
        ).toHaveLength(2);
    });

    it('regroups day headings when the display timezone changes across DST', () => {
        setDisplayTimeZone('America/Chicago');
        usePreferencesStore.setState({ dtTimeZone: 'America/Chicago' });
        const { container } = render(
            <RowList
                kind="posts"
                rows={[
                    {
                        id: 'a',
                        title: 'After midnight',
                        createdAt: Date.parse('2026-03-09T05:30:00Z') / 1000
                    },
                    {
                        id: 'b',
                        title: 'Before midnight',
                        createdAt: '2026-03-09T04:30:00Z'
                    }
                ]}
            />
        );
        expect(
            container.querySelectorAll('[data-slot="separator"]')
        ).toHaveLength(2);
        act(() => {
            setDisplayTimeZone('UTC+00:00');
            usePreferencesStore.setState({ dtTimeZone: 'UTC+00:00' });
        });
        expect(
            container.querySelectorAll('[data-slot="separator"]')
        ).toHaveLength(1);
    });

    it('routes edit and delete actions to the clicked post', () => {
        const onEditPost = vi.fn();
        const onDeletePost = vi.fn();
        const post = { id: 'post_1', title: 'Managed post' };

        render(
            <RowList
                kind="posts"
                rows={[post]}
                canManagePosts
                onEditPost={onEditPost}
                onDeletePost={onDeletePost}
            />
        );

        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.edit' })
        );
        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.delete' })
        );
        expect(onEditPost).toHaveBeenCalledWith(post);
        expect(onDeletePost).toHaveBeenCalledWith(post);
    });

    it('replaces the body with its translation and shows it expanded', async () => {
        mocks.translateTextDetailed.mockResolvedValue({
            text: 'The instance is open!',
            detectedSourceLang: 'ja'
        });

        render(
            <RowList
                kind="posts"
                rows={[
                    {
                        id: 'post_1',
                        title: 'Notice',
                        text: 'インスタンス開きました！'
                    }
                ]}
            />
        );

        fireEvent.click(
            screen.getByRole('button', { name: 'translation.translate' })
        );

        const translated = await screen.findByText('The instance is open!');
        expect(mocks.translateTextDetailed).toHaveBeenCalledWith(
            'インスタンス開きました！',
            'en'
        );
        expect(screen.queryByText('インスタンス開きました！')).toBeNull();
        expect(translated.className).not.toContain('line-clamp-4');
    });
});
