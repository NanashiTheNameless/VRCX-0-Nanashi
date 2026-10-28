// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@/localization/en.json';
import { commands } from '@/platform/tauri/bindings';

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>();
    return {
        ...actual,
        useTranslation: () => ({
            t: (key: string) => {
                const prefix = 'view.settings.history_sync.setting_names.';
                const names = en.view.settings.history_sync
                    .setting_names as Record<string, string>;
                return key.startsWith(prefix)
                    ? (names[key.slice(prefix.length)] ?? key)
                    : key;
            }
        })
    };
});

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

function openDialog() {
    fireEvent.click(
        screen.getByRole('button', { name: 'common.actions.configure' })
    );
}

function save() {
    return act(async () => {
        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.save' })
        );
    });
}

const groupSwitch = () =>
    screen.getByRole('switch', {
        name: 'view.settings.history_sync.setting_choices_group'
    });

describe('choosing which settings sync', () => {
    it('turning a group off excludes the whole group once saved', async () => {
        await renderChoices();
        openDialog();

        fireEvent.click(groupSwitch());
        expect(choicesSet).not.toHaveBeenCalled();
        await save();

        expect(choicesSet).toHaveBeenCalledWith({
            excludedGroups: ['overlay'],
            keyOverrides: {}
        });
    });

    it('turning one setting off keeps the rest of its group syncing', async () => {
        await renderChoices();
        openDialog();

        fireEvent.click(
            screen.getByRole('switch', {
                name: 'view.settings.vr.wrist_overlay.display_on'
            })
        );
        await save();

        expect(choicesSet).toHaveBeenCalledWith({
            excludedGroups: [],
            keyOverrides: { 'config:vrcx_wristoverlayhand': false }
        });
    });

    it('picking another group shows and changes that group', async () => {
        await renderChoices();
        openDialog();

        fireEvent.click(
            screen.getByRole('tab', {
                name: /view\.settings\.history_sync\.setting_groups\.appearance/
            })
        );
        fireEvent.click(
            screen.getByRole('switch', {
                name: 'view.settings.appearance.appearance.theme_mode'
            })
        );
        await save();

        expect(choicesSet).toHaveBeenCalledWith({
            excludedGroups: [],
            keyOverrides: { 'config:vrcx_thememode': false }
        });
    });

    it('names a setting by its label in the app, and by its key when it has none', async () => {
        groupsGet.mockResolvedValue([
            {
                id: 'feed',
                enabled: true,
                settings: [
                    { key: 'config:vrcx_feedtablefilters', synced: true },
                    { key: 'config:vrcx_searchlimit', synced: true }
                ]
            }
        ]);
        await renderChoices();
        openDialog();

        expect(
            screen.getByRole('switch', {
                name: 'prompt.table_entries_settings.search_limit_returns'
            })
        ).toBeTruthy();
        expect(
            screen.getByText('prompt.table_entries_settings.header')
        ).toBeTruthy();
        expect(
            screen.getByRole('switch', { name: 'Feed table filters' })
        ).toBeTruthy();
    });

    it.each([
        ['config:vrcx_instancedialogdisplayname', 'New instance display name'],
        [
            'config:vrcx_instancedialogminimumavatarperformance',
            'New instance minimum avatar performance'
        ],
        ['config:vrcx_assistant.lastselection', 'Social AI model selection'],
        ['config:vrcx_0_rightsidebarwidth', 'Side panel width'],
        ['config:vrcx_0_screenshotgridsort', 'Screenshot sort order'],
        ['config:vrcx_gameisolationenabled', 'Game isolation']
    ])('labels %s and saves its original key', async (key, label) => {
        groupsGet.mockResolvedValue([
            { id: 'other', enabled: true, settings: [{ key, synced: true }] }
        ]);
        await renderChoices();
        openDialog();

        fireEvent.click(screen.getByRole('switch', { name: label }));
        await save();

        expect(choicesSet).toHaveBeenCalledWith({
            excludedGroups: [],
            keyOverrides: { [key]: false }
        });
    });

    it('labels per-account friend log state separately from the account id', async () => {
        const key = 'config:vrcx_friendloginit_usr_example';
        groupsGet.mockResolvedValue([
            { id: 'feed', enabled: true, settings: [{ key, synced: true }] }
        ]);
        await renderChoices();
        openDialog();

        expect(screen.getByText('usr_example')).toBeTruthy();
        fireEvent.click(
            screen.getByRole('switch', {
                name: 'Friend log initialized for account'
            })
        );
        await save();
        expect(choicesSet).toHaveBeenCalledWith({
            excludedGroups: [],
            keyOverrides: { [key]: false }
        });
    });

    it('hides empty groups while preserving their saved exclusions', async () => {
        groupsGet.mockResolvedValue([
            { id: 'automation', enabled: false, settings: [] },
            { id: 'social', enabled: true, settings: [] },
            {
                id: 'appearance',
                enabled: true,
                settings: [{ key: 'config:vrcx_thememode', synced: true }]
            },
            { id: 'other', enabled: false, settings: [] }
        ]);
        await renderChoices();
        openDialog();

        expect(screen.getAllByRole('tab')).toHaveLength(1);
        expect(screen.getByRole('tab').textContent).toContain(
            'setting_groups.appearance'
        );
        await save();
        expect(choicesSet).toHaveBeenCalledWith({
            excludedGroups: ['automation', 'other'],
            keyOverrides: {}
        });
    });

    it('cancelling throws the changes away', async () => {
        await renderChoices();
        openDialog();
        fireEvent.click(groupSwitch());

        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.cancel' })
        );
        openDialog();

        expect(choicesSet).not.toHaveBeenCalled();
        expect(groupSwitch().getAttribute('aria-checked')).toBe('true');
    });

    it('gives the fork avatar-provider preference a readable label and preserves its key', async () => {
        const key = 'config:vrcx_0_nanashi_avatarsearchdisabledproviders';
        groupsGet.mockResolvedValue([
            {
                id: 'other',
                enabled: true,
                settings: [{ key, synced: true }]
            }
        ]);
        await renderChoices();
        openDialog();

        fireEvent.click(
            screen.getByRole('switch', {
                name: 'Disabled avatar search providers'
            })
        );
        await save();

        expect(choicesSet).toHaveBeenCalledWith({
            excludedGroups: [],
            keyOverrides: { [key]: false }
        });
    });

    it('reset turns everything back on', async () => {
        groupsGet.mockResolvedValue([
            {
                id: 'overlay',
                enabled: false,
                settings: [
                    { key: 'config:vrcx_wristoverlayhand', synced: false },
                    { key: 'config:vrcx_wristoverlaysize', synced: true }
                ]
            }
        ]);
        await renderChoices();
        openDialog();

        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.reset' })
        );
        await save();

        expect(choicesSet).toHaveBeenCalledWith({
            excludedGroups: [],
            keyOverrides: {}
        });
    });

    it('saving regrouped settings preserves exclusions inherited from their old categories', async () => {
        groupsGet.mockResolvedValue([
            {
                id: 'media',
                enabled: true,
                settings: [
                    { key: 'config:vrcx_saveinstanceprints', synced: false },
                    { key: 'config:vrcx_cropinstanceprints', synced: true }
                ]
            },
            { id: 'other', enabled: false, settings: [] }
        ]);
        await renderChoices();
        openDialog();

        expect(
            screen
                .getByRole('switch', {
                    name: 'view.settings.advanced.advanced.save_instance_prints_to_file.header'
                })
                .getAttribute('aria-checked')
        ).toBe('false');
        expect(
            screen
                .getByRole('switch', {
                    name: 'view.settings.advanced.advanced.save_instance_prints_to_file.crop'
                })
                .getAttribute('aria-checked')
        ).toBe('true');
        await save();

        expect(choicesSet).toHaveBeenCalledWith({
            excludedGroups: ['other'],
            keyOverrides: { 'config:vrcx_saveinstanceprints': false }
        });
    });

    it('keeps the dialog and the changes when saving fails', async () => {
        choicesSet.mockRejectedValue(new Error('disk full'));
        await renderChoices();
        openDialog();
        fireEvent.click(groupSwitch());

        await save();

        expect(screen.getByText('disk full')).toBeTruthy();
        expect(groupSwitch().getAttribute('aria-checked')).toBe('false');
    });
});
