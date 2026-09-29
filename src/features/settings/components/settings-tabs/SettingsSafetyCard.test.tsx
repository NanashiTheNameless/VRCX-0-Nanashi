// @vitest-environment jsdom
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { createInstance } from 'i18next';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@/localization/en.json';
import type { SafetySettings } from '@/platform/tauri/bindings';

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    save: vi.fn(),
    status: vi.fn(),
    refresh: vi.fn(),
    translate: vi.fn(),
    confirm: vi.fn()
}));
vi.mock('./SettingsGlobalHide', () => ({
    SettingsGlobalHide: () => null
}));
vi.mock('./SettingsInstanceAvatarCheck', () => ({
    SettingsInstanceAvatarCheck: () => null
}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: mocks.translate })
}));
vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appSafetySettingsGet: mocks.get,
        appSafetySettingsSave: mocks.save,
        appSafetyStatus: mocks.status,
        appSafetySourcesRefresh: mocks.refresh
    }
}));
vi.mock('@/state/modalStore', () => ({
    useModalStore: { getState: () => ({ confirm: mocks.confirm }) }
}));
vi.mock('../SettingsCard', () => ({
    SettingsCard: ({ children }: PropsWithChildren) => (
        <section>{children}</section>
    )
}));
import { useNavigationCacheStore } from '@/state/navigationCacheStore';

import { SettingsSafetyCard } from './SettingsSafetyCard';
const initial: SafetySettings = {
    enabled: true,
    groups: [],
    avatars: [],
    urlWarnings: true,
    warnShorteners: true,
    blockedDomains: ['grabify.link'],
    allowedDomains: [],
    sources: [
        {
            id: 'users',
            name: 'Test list',
            url: 'https://example.test/list',
            enabled: false,
            format: 'userIds',
            warn: true,
            blockUsers: false,
            banGroupIds: [],
            globalHide: false
        }
    ]
};
beforeEach(() => {
    vi.resetAllMocks();
    mocks.translate.mockImplementation((key: string) => key.split('.').at(-1));
    mocks.get.mockResolvedValue(structuredClone(initial));
    mocks.save.mockImplementation(async (settings) => settings);
    mocks.status.mockResolvedValue({
        sources: [],
        audit: [],
        droppedEvents: 0
    });
    mocks.refresh.mockResolvedValue({
        sources: [],
        audit: [],
        droppedEvents: 0
    });
    mocks.confirm.mockResolvedValue({ ok: false });
});
afterEach(cleanup);
describe('safety settings', () => {
    it('adds a watch and normalizes domain lines on explicit save', async () => {
        render(<SettingsSafetyCard />);
        await screen.findByDisplayValue('grabify.link');
        fireEvent.change(screen.getByLabelText('groups_id'), {
            target: { value: 'grp_11111111-1111-1111-1111-111111111111' }
        });
        fireEvent.change(screen.getByLabelText('groups_label'), {
            target: { value: 'Watched group' }
        });
        fireEvent.click(screen.getAllByText('add')[0]);
        fireEvent.change(screen.getByLabelText('allowed_domains'), {
            target: { value: 'safe.example\n\n' }
        });
        expect(
            (screen.getByText('refresh_sources') as HTMLButtonElement).disabled
        ).toBe(true);
        fireEvent.click(screen.getByText('save'));
        await waitFor(() =>
            expect(mocks.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    groups: [
                        {
                            id: 'grp_11111111-1111-1111-1111-111111111111',
                            label: 'Watched group',
                            enabled: true
                        }
                    ],
                    allowedDomains: ['safe.example']
                })
            )
        );
        expect(mocks.confirm).not.toHaveBeenCalled();
        await waitFor(() => expect(screen.queryByText('unsaved')).toBeNull());
    });
    it('requires confirmation for automatic actions and cancellation does not save', async () => {
        render(<SettingsSafetyCard />);
        await screen.findByDisplayValue('Test list');
        fireEvent.click(screen.getByRole('switch', { name: 'source_enabled' }));
        fireEvent.click(screen.getByRole('switch', { name: 'block' }));
        fireEvent.click(screen.getByText('save'));
        await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
        expect(mocks.save).not.toHaveBeenCalled();
        await waitFor(() =>
            expect(
                (
                    screen
                        .getByText('save')
                        .closest('fieldset') as HTMLFieldSetElement
                ).disabled
            ).toBe(false)
        );
        mocks.confirm.mockResolvedValue({ ok: true });
        fireEvent.click(screen.getByText('save'));
        await waitFor(() =>
            expect(mocks.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    sources: [
                        expect.objectContaining({
                            enabled: true,
                            warn: true,
                            blockUsers: true
                        })
                    ]
                })
            )
        );
    });
    it('retains edits after save failure and displays the error', async () => {
        mocks.save.mockRejectedValue(new Error('Invalid domain'));
        render(<SettingsSafetyCard />);
        await screen.findByDisplayValue('grabify.link');
        fireEvent.change(screen.getByLabelText('blocked_domains'), {
            target: { value: 'bad/domain' }
        });
        fireEvent.click(screen.getByText('save'));
        await screen.findByRole('alert');
        expect(screen.getByDisplayValue('bad/domain')).toBeTruthy();
        expect(screen.getByText('unsaved')).toBeTruthy();
    });
    it('shows initial load failure without replacing saved settings', async () => {
        mocks.get.mockRejectedValue(new Error('Could not load'));
        render(<SettingsSafetyCard />);
        await screen.findByRole('alert');
        expect(mocks.save).not.toHaveBeenCalled();
        expect(screen.queryByText('save')).toBeNull();
    });
    it('refreshes saved lists and renders per-source errors and history', async () => {
        mocks.refresh.mockResolvedValue({
            sources: [
                {
                    id: 'users',
                    count: 10,
                    updatedAt: 'today',
                    error: 'HTTP 503'
                }
            ],
            audit: [
                {
                    createdAt: 'today',
                    eventType: 'SafetyUrl',
                    userId: '',
                    source: 'grabify.link',
                    message: 'URL was not opened',
                    action: 'warn',
                    outcome: 'shown'
                }
            ],
            droppedEvents: 0
        });
        useNavigationCacheStore.setState({ hydrated: true, settingsCards: {} });
        render(<SettingsSafetyCard />);
        await screen.findByDisplayValue('Test list');
        fireEvent.click(screen.getByText('refresh_sources'));
        await screen.findByText('HTTP 503');
        // The history starts collapsed.
        expect(screen.queryByText('URL was not opened')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'history' }));
        expect(await screen.findByText('URL was not opened')).toBeTruthy();
        expect(mocks.refresh).toHaveBeenCalledOnce();
    });
});

it('shows the concrete source and actions in the localized confirmation', async () => {
    const i18n = createInstance();
    await i18n.init({
        lng: 'en',
        resources: { en: { translation: en } },
        interpolation: { prefix: '{', suffix: '}', escapeValue: false }
    });
    mocks.translate.mockImplementation(
        (key: string, options: Record<string, unknown>) => i18n.t(key, options)
    );
    render(<SettingsSafetyCard />);
    await screen.findByDisplayValue('Test list');
    fireEvent.click(screen.getByRole('switch', { name: 'Enable this source' }));
    fireEvent.click(
        screen.getByRole('switch', {
            name: 'Automatically block matching users'
        })
    );
    fireEvent.click(screen.getByText('Save safety settings'));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    const description = mocks.confirm.mock.calls[0][0].description as string;
    expect(description).toContain(
        'Test list: Automatically block matching users'
    );
    expect(description).not.toContain('{sources}');
});
