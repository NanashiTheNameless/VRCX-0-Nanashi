// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getGroupMembers: vi.fn(),
    getGroupMembersSearch: vi.fn()
}));

vi.mock('@/repositories/groupProfileRepository', async (importOriginal) => {
    const actual =
        await importOriginal<
            typeof import('@/repositories/groupProfileRepository')
        >();
    return {
        ...actual,
        default: {
            ...actual.default,
            getGroupMembers: mocks.getGroupMembers,
            getGroupMembersSearch: mocks.getGroupMembersSearch
        }
    };
});

import {
    useGroupMembersPagination,
    type UseGroupMembersPaginationParams
} from './useGroupMembersPagination';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((complete) => {
        resolve = complete;
    });
    return { promise, resolve };
}

const baseProps: UseGroupMembersPaginationParams = {
    groupId: 'grp_target',
    endpoint: 'endpoint-a',
    enabled: true,
    query: '',
    sort: 'joinedAt:desc',
    roleId: '',
    reloadToken: 0
};

describe('useGroupMembersPagination', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getGroupMembers.mockResolvedValue([]);
        mocks.getGroupMembersSearch.mockResolvedValue([]);
    });

    it('does not search until the trimmed query has at least three characters', async () => {
        const { result } = renderHook(() =>
            useGroupMembersPagination({ ...baseProps, query: ' ab ' })
        );

        await waitFor(() => expect(result.current.status).toBe('ready'));

        expect(mocks.getGroupMembersSearch).not.toHaveBeenCalled();
        expect(mocks.getGroupMembers).not.toHaveBeenCalled();
        expect(result.current.rows).toEqual([]);
        expect(result.current.hasMore).toBe(false);
    });

    it('invalidates pending requests and clears rows when disabled', async () => {
        const request = deferred<Array<{ userId: string }>>();
        mocks.getGroupMembers.mockReturnValue(request.promise);
        const { result, rerender } = renderHook(
            (props: typeof baseProps) => useGroupMembersPagination(props),
            { initialProps: baseProps }
        );

        await waitFor(() => expect(result.current.status).toBe('running'));
        rerender({ ...baseProps, enabled: false });

        expect(result.current.status).toBe('');
        expect(result.current.rows).toEqual([]);

        await act(async () => {
            request.resolve([{ userId: 'usr_stale' }]);
            await request.promise;
        });

        expect(result.current.status).toBe('');
        expect(result.current.rows).toEqual([]);
    });

    it('starts at most one load-more request synchronously', async () => {
        const firstPage = Array.from({ length: 100 }, (_, index) => ({
            userId: `usr_${index}`
        }));
        const nextPage = deferred<Array<{ userId: string }>>();
        mocks.getGroupMembers
            .mockResolvedValueOnce(firstPage)
            .mockReturnValueOnce(nextPage.promise);
        const { result } = renderHook(() =>
            useGroupMembersPagination(baseProps)
        );

        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(result.current.hasMore).toBe(true);

        act(() => {
            result.current.loadMore();
            result.current.loadMore();
        });

        expect(mocks.getGroupMembers).toHaveBeenCalledTimes(2);
        expect(mocks.getGroupMembers).toHaveBeenLastCalledWith(
            expect.objectContaining({ offset: 100 })
        );

        await act(async () => {
            nextPage.resolve([]);
            await nextPage.promise;
        });
    });
});
