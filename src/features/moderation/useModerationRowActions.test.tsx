// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mocks, runtimeState } = vi.hoisted(() => ({
    mocks: {
        confirm: vi.fn(),
        refreshModerationSync: vi.fn(),
        updateModerationSync: vi.fn()
    },
    runtimeState: {
        auth: {
            currentUserId: 'usr_self',
            currentUserEndpoint: 'https://api.example.test/api/1'
        }
    }
}));

vi.mock('@/services/dialogService', () => ({
    openUserDialog: vi.fn()
}));

vi.mock('@/services/moderationSyncService', () => ({
    refreshModerationSync: mocks.refreshModerationSync,
    updateModerationSync: mocks.updateModerationSync
}));

vi.mock('@/state/modalStore', () => ({
    useModalStore: <T,>(
        selector: (state: { confirm: typeof mocks.confirm }) => T
    ): T => selector({ confirm: mocks.confirm })
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: Object.assign(
        <T,>(selector: (state: typeof runtimeState) => T): T =>
            selector(runtimeState),
        { getState: () => runtimeState }
    )
}));

import { useModerationRowActions } from './useModerationRowActions';

describe('useModerationRowActions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        runtimeState.auth.currentUserId = 'usr_self';
        runtimeState.auth.currentUserEndpoint =
            'https://api.example.test/api/1';
    });

    afterEach(() => {
        cleanup();
    });

    it('does not apply an old row after the endpoint changes during confirmation', async () => {
        let resolveConfirmation!: (result: { ok: boolean }) => void;
        mocks.confirm.mockReturnValueOnce(
            new Promise<{ ok: boolean }>((resolve) => {
                resolveConfirmation = resolve;
            })
        );
        const { result } = renderHook(() =>
            useModerationRowActions({
                setDetail: vi.fn(),
                setRows: vi.fn()
            })
        );

        await act(async () => {
            const action = result.current.handleDeleteModeration({
                id: 'pmod_block',
                sourceUserId: 'usr_self',
                sourceDisplayName: 'Current User',
                targetUserId: 'usr_target',
                targetDisplayName: 'Target User',
                type: 'block',
                created: '2026-07-08T02:07:00.000Z'
            });
            runtimeState.auth.currentUserEndpoint =
                'https://api.other.test/api/1';
            resolveConfirmation({ ok: true });
            await action;
        });

        expect(mocks.updateModerationSync).not.toHaveBeenCalled();
        expect(mocks.refreshModerationSync).not.toHaveBeenCalled();
    });
});
