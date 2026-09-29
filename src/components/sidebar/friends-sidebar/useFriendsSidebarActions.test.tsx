// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/dialogService', () => ({
    openUserDialog: vi.fn()
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getArray: vi.fn().mockResolvedValue([]),
        setArray: vi.fn().mockResolvedValue(undefined)
    }
}));

import { useFriendsSidebarActions } from './useFriendsSidebarActions';

describe('useFriendsSidebarActions', () => {
    it('opens the shared social-status editor for the current user', () => {
        const currentUser = {
            id: 'usr_self',
            displayName: 'Current User',
            status: 'busy',
            statusDescription: 'Focusing'
        };
        const { result } = renderHook(() =>
            useFriendsSidebarActions({
                confirm: vi.fn(async () => ({
                    ok: false,
                    reason: 'cancelled'
                })),
                currentUser,
                currentUserId: currentUser.id
            })
        );

        act(() => {
            result.current.editCurrentUserSocialStatus();
        });

        expect(result.current.socialStatusDialog.open).toBe(true);
        expect(result.current.socialStatusDialog.draft).toEqual({
            status: 'busy',
            statusDescription: 'Focusing'
        });
    });
});
