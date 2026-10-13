// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/platform/tauri/bindings';

vi.mock('@/platform/tauri/bindings', async () =>
    (await import('@/test/mockCommands')).mockBindingsModule()
);

import { SettingsHistorySyncSettingChoices } from './SettingsHistorySyncSettingChoices';

const groupsGet = vi.mocked(commands.appRemoteSyncSettingGroupsGet);
const choicesSet = vi.mocked(commands.appRemoteSyncSettingChoicesSet);

async function renderChoices() {
    await act(async () => {
        render(<SettingsHistorySyncSettingChoices disabled={false} />);
    });
}

beforeEach(() => {
    groupsGet.mockResolvedValue([
        {
            id: 'overlay',
            enabled: true,
            settings: [
                { key: 'config:vrcx_wristoverlayhand', synced: true },
                { key: 'config:vrcx_wristoverlaysize', synced: true }
            ]
        },
        {
            id: 'appearance',
            enabled: true,
            settings: [{ key: 'config:vrcx_thememode', synced: true }]
        }
    ]);
    choicesSet.mockResolvedValue(null);
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('choosing which settings sync', () => {
    it('turning a group off excludes the whole group', async () => {
        await renderChoices();

        fireEvent.click(
            screen.getByRole('switch', {
                name: 'view.settings.history_sync.setting_groups.overlay'
            })
        );

        expect(choicesSet).toHaveBeenCalledWith({
            excludedGroups: ['overlay'],
            keyOverrides: {}
        });
    });

    it('turning one setting off keeps the rest of its group syncing', async () => {
        await renderChoices();

        fireEvent.click(
            screen.getAllByRole('button', {
                name: 'view.settings.history_sync.setting_choices_show'
            })[0]
        );
        expect(screen.getByText('wristOverlayHand')).toBeTruthy();
        fireEvent.click(screen.getAllByRole('switch')[1]);

        expect(choicesSet).toHaveBeenCalledWith({
            excludedGroups: [],
            keyOverrides: { 'config:vrcx_wristoverlayhand': false }
        });
    });

    it('puts the switch back when saving fails', async () => {
        choicesSet.mockRejectedValue(new Error('disk full'));
        await renderChoices();
        const group = screen.getByRole('switch', {
            name: 'view.settings.history_sync.setting_groups.appearance'
        });

        await act(async () => {
            fireEvent.click(group);
        });

        expect(group.getAttribute('aria-checked')).toBe('true');
        expect(screen.getByText('disk full')).toBeTruthy();
    });
});
