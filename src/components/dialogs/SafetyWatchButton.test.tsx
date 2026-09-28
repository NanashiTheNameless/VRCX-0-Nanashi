// @vitest-environment jsdom
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    set: vi.fn(),
    sources: vi.fn(),
    toast: vi.fn()
}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, args?: { sources?: string }) =>
            args?.sources || key.split('.').at(-1)
    })
}));
vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appSafetySettingsGet: mocks.get,
        appSafetyWatchSet: mocks.set,
        appSafetyEntrySources: mocks.sources
    }
}));
vi.mock('@/services/toastService', () => ({ toast: { add: mocks.toast } }));
import { SafetyWatchButton, SafetySourceBadge } from './SafetyWatchButton';
beforeEach(() => {
    vi.resetAllMocks();
    mocks.get.mockResolvedValue({ groups: [], avatars: [] });
    mocks.set.mockResolvedValue({});
    mocks.sources.mockResolvedValue([]);
});
afterEach(cleanup);
it('flags and unflags an avatar with its exact ID and name', async () => {
    render(<SafetyWatchButton kind="avatar" id="avtr_test" label="Avatar" />);
    await waitFor(() =>
        expect((screen.getByText('watch') as HTMLButtonElement).disabled).toBe(
            false
        )
    );
    fireEvent.click(screen.getByText('watch'));
    await screen.findByText('unwatch');
    expect(mocks.set).toHaveBeenLastCalledWith(
        'avatar',
        'avtr_test',
        'Avatar',
        true
    );
    fireEvent.click(screen.getByText('unwatch'));
    await screen.findByText('watch');
    expect(mocks.set).toHaveBeenLastCalledWith(
        'avatar',
        'avtr_test',
        'Avatar',
        false
    );
});
it('shows exact ID community flags on user profiles', async () => {
    mocks.sources.mockResolvedValue(['Source A']);
    render(<SafetySourceBadge kind="user" id="usr_test" />);
    await screen.findByText('Source A');
    expect(mocks.sources).toHaveBeenCalledWith('user', 'usr_test');
});
it('keeps the original watch state after a failed write', async () => {
    mocks.set.mockRejectedValue(new Error('Disk error'));
    render(<SafetyWatchButton kind="group" id="grp_test" label="Group" />);
    await waitFor(() =>
        expect((screen.getByText('watch') as HTMLButtonElement).disabled).toBe(
            false
        )
    );
    fireEvent.click(screen.getByText('watch'));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(screen.queryByText('unwatch')).toBeNull();
});
