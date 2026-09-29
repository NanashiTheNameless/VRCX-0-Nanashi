// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeedRow } from '@/components/feed/feedTypes';

import {
    USER_DIALOG_FEED_LIMIT,
    UserDialogFeedPanel
} from './UserDialogFeedTab';

const mocks = vi.hoisted(() => ({
    mergeFeedRowsWithLiveEntries: vi.fn(),
    prepareFeedRowsForCommit: vi.fn(),
    queryFeedLatest: vi.fn()
}));

vi.mock('@/repositories/feedRepository', () => ({
    default: {
        queryFeedLatest: mocks.queryFeedLatest
    }
}));

vi.mock('@/services/feedLiveMergeService', () => ({
    mergeFeedRowsWithLiveEntries: mocks.mergeFeedRowsWithLiveEntries,
    prepareFeedRowsForCommit: mocks.prepareFeedRowsForCommit
}));

vi.mock('@/components/feed/FeedDetailCell', () => ({
    FeedDetailCell: () => null
}));

vi.mock('@/components/feed/FeedTypeIndicator', () => ({
    FeedTypeIndicator: () => null
}));

beforeEach(() => {
    mocks.queryFeedLatest.mockReset();
    mocks.mergeFeedRowsWithLiveEntries.mockReset();
    mocks.prepareFeedRowsForCommit.mockReset();
    mocks.queryFeedLatest.mockResolvedValue({
        rows: [{ rowId: 1, type: 'Offline', userId: 'usr_friend' }],
        maxSequence: 7
    });
    mocks.mergeFeedRowsWithLiveEntries.mockImplementation(
        async ({
            minLiveSequence,
            rows
        }: {
            minLiveSequence: number;
            rows: FeedRow[];
        }) => ({ rows, maxSequence: minLiveSequence })
    );
    mocks.prepareFeedRowsForCommit.mockImplementation(
        async ({
            result
        }: {
            result: { rows: FeedRow[]; maxSequence: number };
        }) => result
    );
});

afterEach(cleanup);

describe('UserDialogFeedPanel', () => {
    it('loads the selected friend only after the hidden tab becomes active', async () => {
        const { rerender } = render(
            <UserDialogFeedPanel
                active={false}
                currentUserId="usr_owner"
                onOpenFullFeed={vi.fn()}
                targetUserId="usr_friend"
            />
        );

        expect(mocks.queryFeedLatest).not.toHaveBeenCalled();

        rerender(
            <UserDialogFeedPanel
                active
                currentUserId="usr_owner"
                onOpenFullFeed={vi.fn()}
                targetUserId="usr_friend"
            />
        );

        await waitFor(() => {
            expect(mocks.queryFeedLatest).toHaveBeenCalledWith({
                userId: 'usr_owner',
                scopedUserIds: ['usr_friend'],
                maxRows: USER_DIALOG_FEED_LIMIT
            });
        });
        expect(mocks.queryFeedLatest).toHaveBeenCalledTimes(1);
    });
});
