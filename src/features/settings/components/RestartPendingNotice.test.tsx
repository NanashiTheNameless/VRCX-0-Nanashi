// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    restart: vi.fn<() => Promise<void>>()
}));

vi.mock('@/services/shellIntegrationService', () => ({
    restartApplication: mocks.restart
}));

import {
    markRestartPending,
    useRestartPendingStore
} from '@/state/restartPendingStore';

import { RestartPendingNotice } from './RestartPendingNotice';

afterEach(() => {
    cleanup();
    useRestartPendingStore.setState({ pending: false });
    vi.clearAllMocks();
});

describe('RestartPendingNotice', () => {
    it('stays visible after a restart-required change and restarts on demand', () => {
        mocks.restart.mockResolvedValue(undefined);
        render(<RestartPendingNotice />);

        expect(
            screen.queryByText('view.settings.restart_pending.description')
        ).toBeNull();

        act(() => {
            markRestartPending();
        });
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.settings.restart_pending.restart_now'
            })
        );

        expect(
            screen.getByText('view.settings.restart_pending.description')
        ).toBeTruthy();
        expect(mocks.restart).toHaveBeenCalledOnce();
    });
});
