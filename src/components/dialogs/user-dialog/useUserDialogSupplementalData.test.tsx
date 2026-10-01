// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getFriendLogHistory: vi.fn(),
    getRepresentedGroup: vi.fn(),
    getUserStats: vi.fn()
}));

vi.mock('@/repositories/friendLogHistoryRepository', () => ({
    default: { getFriendLogHistory: mocks.getFriendLogHistory }
}));
vi.mock('@/repositories/gameLogRepository', () => ({
    default: { getUserStats: mocks.getUserStats }
}));
vi.mock('@/repositories/userProfileRepository', () => ({
    default: {
        getRepresentedGroup: mocks.getRepresentedGroup
    }
}));

import { clearUserDialogCaches } from '@/services/userDialogSessionCacheService';
import { onlinePresence } from '@/test/presenceFixtures';

import { useUserDialogSupplementalData } from './useUserDialogSupplementalData';

function input(profile: Record<string, unknown>, inCurrentWorld = false) {
    return {
        activeUserTargetRef: {
            current: {
                endpoint: 'https://api.example.test',
                userId: 'usr_target'
            }
        },
        currentEndpoint: 'https://api.example.test',
        inCurrentWorld,
        currentUserId: 'usr_self',
        currentUserSnapshot: {
            id: 'usr_self',
            hasSharedConnectionsOptOut: false
        },
        isTargetCurrentUser: false,
        normalizedUserId: 'usr_target',
        openNonce: 1,
        profile,
        reloadToken: 0,
        targetKey: 'https://api.example.test::usr_target'
    };
}

afterEach(cleanup);

describe('useUserDialogSupplementalData', () => {
    beforeEach(() => {
        clearUserDialogCaches();
        for (const mock of Object.values(mocks)) {
            mock.mockReset();
            mock.mockResolvedValue([]);
        }
        mocks.getUserStats.mockResolvedValue({});
        mocks.getRepresentedGroup.mockResolvedValue(null);
    });

    it('preserves add/remove/re-add history when game stats finish later', async () => {
        const history = [
            { rowId: 4, type: 'Friend', created_at: '2026-09-01T00:00:00Z' },
            { rowId: 3, type: 'Unfriend', created_at: '2026-09-01T00:00:00Z' },
            { rowId: 1, type: 'Friend', created_at: '2025-01-01T00:00:00Z' }
        ];
        mocks.getFriendLogHistory.mockResolvedValue([
            ...history.slice(0, 2),
            {
                rowId: 2,
                type: 'DisplayName',
                previousDisplayName: 'Old Name',
                created_at: '2026-01-01T00:00:00Z'
            },
            history[2]
        ]);
        let finishStats: (stats: { timeSpent: number }) => void = () => {};
        mocks.getUserStats.mockReturnValue(
            new Promise<{ timeSpent: number }>((resolve) => {
                finishStats = resolve;
            })
        );
        const { result } = renderHook(() =>
            useUserDialogSupplementalData(input({ id: 'usr_target' }))
        );
        await waitFor(() =>
            expect(result.current.userStats.relationshipHistory).toEqual(
                history
            )
        );
        expect(result.current.userStats.friendedAt).toBe(history[0].created_at);
        await act(async () => {
            finishStats({ timeSpent: 60 });
        });
        expect(result.current.userStats.relationshipHistory).toEqual(history);
        expect(result.current.userStats.timeSpent).toBe(60);
    });

    it('retains the latest removal event and ignores an old target response', async () => {
        let finishOld: (rows: unknown[]) => void = () => {};
        mocks.getFriendLogHistory.mockReturnValueOnce(
            new Promise<unknown[]>((resolve) => {
                finishOld = resolve;
            })
        );
        const removal = {
            rowId: 2,
            type: 'Unfriend',
            created_at: '2026-09-01T00:00:00Z'
        };
        mocks.getFriendLogHistory.mockResolvedValueOnce([removal]);
        const first = input({ id: 'usr_target' });
        const { result, rerender } = renderHook(
            (props) => useUserDialogSupplementalData(props),
            { initialProps: first }
        );
        rerender({
            ...first,
            profile: { id: 'usr_other' },
            normalizedUserId: 'usr_other',
            targetKey: 'https://api.example.test::usr_other'
        });
        await waitFor(() =>
            expect(result.current.userStats.relationshipHistory).toEqual([
                removal
            ])
        );
        await act(async () => {
            finishOld([
                { rowId: 1, type: 'Friend', created_at: '2025-01-01T00:00:00Z' }
            ]);
        });
        expect(result.current.userStats.relationshipHistory).toEqual([removal]);
        expect(result.current.userStats.friendedAt).toBe('');
    });

    it('does not refetch id-based supplemental rows for a display-only profile merge', async () => {
        mocks.getUserStats.mockResolvedValue({
            previousDisplayNames: [
                {
                    displayName: 'Merged Name',
                    updated_at: '2026-08-10T00:00:00.000Z'
                },
                {
                    displayName: 'Older Name',
                    updated_at: '2026-08-09T00:00:00.000Z'
                }
            ]
        });
        const baseProfile: Record<string, unknown> = {
            id: 'usr_target',
            displayName: 'Initial Name',
            $presence: onlinePresence('wrld_other:2')
        };
        const { rerender, result } = renderHook(
            ({ profile, inCurrentWorld = false }) =>
                useUserDialogSupplementalData(input(profile, inCurrentWorld)),
            {
                initialProps: {
                    profile: baseProfile,
                    inCurrentWorld: false
                }
            }
        );

        await waitFor(() => {
            expect(mocks.getUserStats).toHaveBeenCalledTimes(1);
            expect(mocks.getFriendLogHistory).toHaveBeenCalledTimes(1);
            expect(result.current.userStats.previousDisplayNames).toEqual([
                {
                    displayName: 'Merged Name',
                    updated_at: '2026-08-10T00:00:00.000Z'
                },
                {
                    displayName: 'Older Name',
                    updated_at: '2026-08-09T00:00:00.000Z'
                }
            ]);
        });

        rerender({
            profile: {
                ...baseProfile,
                displayName: 'Merged Name',
                currentAvatarImageUrl: 'https://example.test/avatar.png'
            },
            inCurrentWorld: false
        });

        await waitFor(() => {
            expect(result.current.userStats.previousDisplayNames).toEqual([
                {
                    displayName: 'Older Name',
                    updated_at: '2026-08-09T00:00:00.000Z'
                }
            ]);
        });
        expect(mocks.getUserStats).toHaveBeenCalledTimes(1);
        expect(mocks.getFriendLogHistory).toHaveBeenCalledTimes(1);

        rerender({
            profile: {
                ...baseProfile,
                displayName: 'Merged Name'
            },
            inCurrentWorld: true
        });

        await waitFor(() => {
            expect(mocks.getUserStats).toHaveBeenCalledTimes(2);
        });
        expect(mocks.getFriendLogHistory).toHaveBeenCalledTimes(1);
    });
});
