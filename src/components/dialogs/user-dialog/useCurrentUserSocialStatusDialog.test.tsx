// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getArray: vi.fn().mockResolvedValue([]),
        setArray: vi.fn().mockResolvedValue(undefined)
    }
}));

import { useCurrentUserSocialStatusDialog } from './useCurrentUserSocialStatusDialog';

describe('useCurrentUserSocialStatusDialog', () => {
    it('opens with the current profile and saves through the shared owner', async () => {
        const onSave = vi.fn().mockResolvedValue(true);
        const { result } = renderHook(() =>
            useCurrentUserSocialStatusDialog({
                profile: {
                    id: 'usr_self',
                    status: 'busy',
                    statusDescription: 'Focusing'
                },
                onSave
            })
        );

        act(() => {
            result.current.openDialog();
        });
        expect(result.current.dialog.draft).toEqual({
            status: 'busy',
            statusDescription: 'Focusing'
        });
        expect(result.current.dialog.open).toBe(true);

        await act(async () => {
            await result.current.dialog.onSave();
        });

        expect(onSave).toHaveBeenCalledWith({
            status: 'busy',
            statusDescription: 'Focusing'
        });
        expect(result.current.dialog.open).toBe(false);
    });
});

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn(), close: vi.fn() }
}));
