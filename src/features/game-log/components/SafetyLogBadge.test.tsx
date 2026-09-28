// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ inspect: vi.fn() }));
vi.mock('@/platform/tauri/bindings', () => ({
    commands: { appSafetyRowsInspect: mocks.inspect }
}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key.split('.').at(-1) })
}));
import {
    SafetyLogBadge,
    SafetyLogLocationContext,
    SafetyLogProvider
} from './SafetyLogBadge';
beforeEach(() => {
    vi.resetAllMocks();
    mocks.inspect.mockImplementation(async (rows) =>
        rows.map((row: { url: string }) =>
            row.url.includes('grabify.link')
                ? ['Potential IP-logger host grabify.link; URL not opened.']
                : []
        )
    );
});
afterEach(cleanup);
it('batches mounted rows and renders URL warnings without opening any URLs', async () => {
    const open = vi.spyOn(window, 'open');
    render(
        <SafetyLogProvider accountUserId="usr_self">
            <SafetyLogBadge
                row={{
                    type: 'VideoPlay',
                    created_at: 'time',
                    videoUrl: 'https://grabify.link/secret'
                }}
            />
            <SafetyLogBadge
                row={{
                    type: 'VideoPlay',
                    created_at: 'later',
                    videoUrl: 'https://safe.example/video'
                }}
            />
        </SafetyLogProvider>
    );
    await screen.findByRole('img', { name: /Potential IP-logger/ });
    expect(mocks.inspect).toHaveBeenCalledOnce();
    expect(mocks.inspect.mock.calls[0][0]).toHaveLength(2);
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
});
it('includes the account and inherited session location for accurate history matching', async () => {
    render(
        <SafetyLogProvider accountUserId="usr_self">
            <SafetyLogLocationContext value="wrld_world:instance">
                <SafetyLogBadge
                    row={{
                        type: 'OnPlayerJoined',
                        created_at: 'time',
                        userId: 'usr_player'
                    }}
                />
            </SafetyLogLocationContext>
        </SafetyLogProvider>
    );
    await waitFor(() =>
        expect(mocks.inspect).toHaveBeenCalledWith([
            expect.objectContaining({
                accountUserId: 'usr_self',
                location: 'wrld_world:instance',
                userId: 'usr_player',
                createdAt: 'time',
                kind: 'OnPlayerJoined'
            })
        ])
    );
});
it('discards a delayed result when the account or row changes', async () => {
    let finish!: (value: string[][]) => void;
    mocks.inspect.mockReturnValueOnce(
        new Promise((resolve) => {
            finish = resolve;
        })
    );
    const view = render(
        <SafetyLogProvider accountUserId="usr_old">
            <SafetyLogBadge
                row={{
                    type: 'VideoPlay',
                    videoUrl: 'https://grabify.link/secret'
                }}
            />
        </SafetyLogProvider>
    );
    await waitFor(() => expect(mocks.inspect).toHaveBeenCalledOnce());
    view.rerender(
        <SafetyLogProvider accountUserId="usr_new">
            <SafetyLogBadge
                row={{
                    type: 'VideoPlay',
                    videoUrl: 'https://safe.example/video'
                }}
            />
        </SafetyLogProvider>
    );
    finish([['Old warning']]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('img')).toBeNull();
});
it('reports failed inspection without showing stale safety information', async () => {
    mocks.inspect.mockRejectedValue(new Error('Backend unavailable'));
    render(
        <SafetyLogProvider accountUserId="usr_self">
            <SafetyLogBadge
                row={{
                    type: 'VideoPlay',
                    videoUrl: 'https://grabify.link/secret'
                }}
            />
        </SafetyLogProvider>
    );
    await screen.findByText('log_badges_unavailable');
    expect(screen.queryByRole('img')).toBeNull();
});
