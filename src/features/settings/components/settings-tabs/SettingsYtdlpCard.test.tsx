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
    status: vi.fn(),
    configure: vi.fn(),
    refresh: vi.fn(),
    importCookies: vi.fn(),
    pick: vi.fn(),
    confirm: vi.fn(),
    update: vi.fn(),
    test: vi.fn(),
    clear: vi.fn()
}));
vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appYtdlpStatus: mocks.status,
        appYtdlpConfigure: mocks.configure,
        appYtdlpRefreshCookies: mocks.refresh,
        appYtdlpImportCookies: mocks.importCookies,
        appOpenFileSelectorDialog: mocks.pick,
        appYtdlpUpdate: mocks.update,
        appYtdlpTest: mocks.test,
        appYtdlpClearCookies: mocks.clear
    }
}));
vi.mock('@/state/modalStore', () => ({
    useModalStore: { getState: () => ({ confirm: mocks.confirm }) }
}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, values?: Record<string, unknown>) =>
            key.split('.').at(-1) + (values ? JSON.stringify(values) : '')
    })
}));
vi.mock('../SettingsCard', () => ({
    SettingsCard: ({ children }: { children: React.ReactNode }) => (
        <div>{children}</div>
    )
}));
import { SettingsYtdlpCard } from './SettingsYtdlpCard';
const base = {
    settings: {
        enabled: false,
        useCookies: false,
        browser: '',
        profile: '',
        toolsPath: '/VRChat/Tools'
    },
    supported: true,
    installed: false,
    version: '',
    checkedAt: '',
    cookiesRefreshedAt: '',
    cookieCount: 0,
    cookieExpiry: 0,
    cookieValidatedAt: '',
    cookieValidation: '',
    providerRunning: false,
    busy: false,
    message: '',
    toolsPath: '/VRChat/Tools'
};
beforeEach(() => {
    vi.resetAllMocks();
    mocks.status.mockResolvedValue(base);
    mocks.confirm.mockResolvedValue({ ok: true });
    mocks.configure.mockImplementation(async (settings) => ({
        ...base,
        settings
    }));
});
afterEach(cleanup);
it('does nothing automatically and requires explicit confirmation to enable', async () => {
    render(<SettingsYtdlpCard />);
    await screen.findByRole('switch', { name: 'enable' });
    expect(mocks.configure).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.importCookies).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('switch', { name: 'enable' }));
    fireEvent.click(screen.getByText('save'));
    await waitFor(() =>
        expect(mocks.configure).toHaveBeenCalledWith(
            expect.objectContaining({ enabled: true, useCookies: false })
        )
    );
    expect(mocks.confirm.mock.calls[0][0].description).toContain(
        '/VRChat/Tools'
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
});
it('does not enable when installation confirmation is cancelled', async () => {
    mocks.confirm.mockResolvedValue({ ok: false });
    render(<SettingsYtdlpCard />);
    await screen.findByRole('switch', { name: 'enable' });
    fireEvent.click(screen.getByRole('switch', { name: 'enable' }));
    fireEvent.click(screen.getByText('save'));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect(mocks.configure).not.toHaveBeenCalled();
});
it('cookie opt-in requires saving and does not itself access a browser', async () => {
    mocks.status.mockResolvedValue({
        ...base,
        settings: { ...base.settings, enabled: true }
    });
    render(<SettingsYtdlpCard />);
    await screen.findByRole('switch', { name: 'cookies' });
    fireEvent.click(screen.getByRole('switch', { name: 'cookies' }));
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.importCookies).not.toHaveBeenCalled();
    expect(
        (
            screen
                .getByRole('combobox', { name: 'browser' })
                .closest('fieldset') as HTMLFieldSetElement
        ).disabled
    ).toBe(true);
    fireEvent.click(screen.getByText('save'));
    await waitFor(() =>
        expect(mocks.configure).toHaveBeenCalledWith(
            expect.objectContaining({ useCookies: true })
        )
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
});
it('requires selecting a browser and confirmation for every cookie refresh', async () => {
    const status = {
        ...base,
        settings: {
            ...base.settings,
            enabled: true,
            useCookies: true,
            browser: 'firefox'
        }
    };
    mocks.status.mockResolvedValue(status);
    mocks.refresh.mockResolvedValue(status);
    render(<SettingsYtdlpCard />);
    await screen.findByRole('combobox', { name: 'browser' });
    expect((screen.getByText('refresh') as HTMLButtonElement).disabled).toBe(
        true
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'browser' }), {
        target: { value: 'firefox' }
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'profile' }), {
        target: { value: 'Separate profile' }
    });
    fireEvent.click(screen.getByText('refresh'));
    await waitFor(() =>
        expect(mocks.refresh).toHaveBeenCalledWith(
            'firefox',
            'Separate profile'
        )
    );
    expect(mocks.confirm.mock.calls[0][0].description).toContain(
        'Separate profile'
    );
});
it('imports only a file explicitly selected by the user', async () => {
    const status = {
        ...base,
        settings: { ...base.settings, enabled: true, useCookies: true }
    };
    mocks.status.mockResolvedValue(status);
    mocks.pick.mockResolvedValue('/selected/cookies.txt');
    mocks.importCookies.mockResolvedValue(status);
    render(<SettingsYtdlpCard />);
    await screen.findByText('import');
    fireEvent.click(screen.getByText('import'));
    await waitFor(() =>
        expect(mocks.importCookies).toHaveBeenCalledWith(
            '/selected/cookies.txt'
        )
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
});
it('does not import when the picker is cancelled', async () => {
    mocks.status.mockResolvedValue({
        ...base,
        settings: { ...base.settings, enabled: true, useCookies: true }
    });
    mocks.pick.mockResolvedValue(null);
    render(<SettingsYtdlpCard />);
    await screen.findByText('import');
    fireEvent.click(screen.getByText('import'));
    await waitFor(() => expect(mocks.pick).toHaveBeenCalled());
    expect(mocks.importCookies).not.toHaveBeenCalled();
});
