// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppDataDirState } from '@/platform/tauri/bindings';
import { Tabs } from '@/ui/shadcn/tabs';
import { TooltipProvider } from '@/ui/shadcn/tooltip';

import { SettingsAdvancedTabContent as SettingsAdvancedTab } from './SettingsAdvancedTab';
import type { SettingsAdvancedModel } from './settingsAdvancedTypes';

const labels: Record<string, string> = {
    'view.settings.advanced.advanced_ui.storage.change_folder':
        'Change folder...',
    'view.settings.advanced.advanced_ui.storage.more':
        'More data location actions',
    'view.settings.advanced.advanced.data_directory.source_cli':
        'Command-line override',
    'view.settings.advanced.advanced.data_directory.source_default':
        'default directory',
    'view.settings.advanced.advanced.data_directory.source_persisted':
        'custom directory'
};

const commandMocks = vi.hoisted(() => ({
    appBrowseHistoryRetentionDaysGet: vi.fn()
}));

vi.mock('../ProfileMergeFields', () => ({
    ProfileMergeFields: () => null
}));
vi.mock('@/platform/tauri/bindings', () => ({
    commands: commandMocks
}));

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({
        t: (key: string) => labels[key] ?? key
    })
}));

vi.mock('./AdvancedTroubleshootingGroup', () => ({
    AdvancedTroubleshootingGroup: () => <div>troubleshooting</div>
}));
// Tested on their own; here only their placement matters.
vi.mock('./SettingsSafetyCard', () => ({
    SettingsSafetyCard: () => <div>safety-card</div>
}));
vi.mock('./SettingsYtdlpCard', () => ({
    SettingsYtdlpCard: () => <div>ytdlp-card</div>
}));

function appDataDirState(
    overrides: Partial<AppDataDirState> = {}
): AppDataDirState {
    return {
        cliDir: null,
        cliOverride: false,
        currentDir: 'C:\\VRCX-0',
        defaultDir: 'C:\\VRCX-0',
        persistedDir: null,
        pendingMigration: false,
        cleanupPending: null,
        migrationStatus: { revision: 0, state: 'idle' },
        source: 'default',
        ...overrides
    };
}

function createModel(
    overrides: Partial<SettingsAdvancedModel> = {}
): SettingsAdvancedModel {
    return {
        appDataDirState: appDataDirState(),
        avatarAutoCleanupOptions: ['Off'],
        configTreeData: {},
        onAutoSweepVRChatCacheChange: vi.fn(),
        onAvatarAutoCleanupChange: vi.fn(),
        onClearConfigTreeData: vi.fn(),
        onGameLogDisabledChange: vi.fn(),
        onFeedPersistenceDisabledChange: vi.fn(),
        onLogResourceLoadChange: vi.fn(),
        onOpenAppDataDirSelector: vi.fn(),
        onCleanupAppDataDir: vi.fn(),
        onDismissAppDataDirCleanup: vi.fn(),
        onOpenPurgeDialog: vi.fn(),
        onRefreshConfigTreeData: vi.fn(),
        onRefreshOnlineVisits: vi.fn(),
        onRefreshSqliteTableSizes: vi.fn(),
        onResetAppDataDir: vi.fn(),
        onUdonExceptionLoggingChange: vi.fn(),
        onlineVisitCount: null,
        prefs: {
            autoSweepVRChatCache: false,
            avatarAutoCleanup: 'Off',
            gameLogDisabled: false,
            feedPersistenceDisabled: false,
            logResourceLoad: false,
            udonExceptionLogging: false
        },
        sqliteTableSizeRows: [],
        sqliteTableSizes: {},
        ...overrides
    };
}

function renderTab(model: SettingsAdvancedModel) {
    return render(
        <TooltipProvider>
            <Tabs value="advanced">
                <SettingsAdvancedTab advanced={model} />
            </Tabs>
        </TooltipProvider>
    );
}

describe('SettingsAdvancedTab data directory states', () => {
    afterEach(cleanup);

    beforeEach(() => {
        commandMocks.appBrowseHistoryRetentionDaysGet
            .mockReset()
            .mockResolvedValue(30);
        vi.stubGlobal(
            'ResizeObserver',
            class {
                observe() {}
                unobserve() {}
                disconnect() {}
            }
        );
    });

    it('shows only Change folder for the default directory', () => {
        renderTab(createModel());

        expect(
            (
                screen.getByRole('button', {
                    name: 'Change folder...'
                }) as HTMLButtonElement
            ).disabled
        ).toBe(false);
        expect(
            screen.queryByRole('button', {
                name: 'More data location actions'
            })
        ).toBeNull();
    });

    it.each([
        ['\\\\?\\C:\\VRCX-0', 'C:\\VRCX-0'],
        ['\\\\?\\UNC\\server\\share\\VRCX-0', '\\\\server\\share\\VRCX-0']
    ])('displays the extended path %s as %s', (currentDir, displayedPath) => {
        renderTab(
            createModel({
                appDataDirState: appDataDirState({ currentDir })
            })
        );

        expect(screen.getByText(displayedPath)).toBeTruthy();
        expect(screen.queryByText(currentDir)).toBeNull();
    });

    it('shows the More menu for a custom directory', () => {
        renderTab(
            createModel({
                appDataDirState: appDataDirState({
                    persistedDir: 'D:\\VRCX-0',
                    source: 'persisted'
                })
            })
        );

        expect(
            screen.getByRole('button', {
                name: 'More data location actions'
            })
        ).toBeTruthy();
    });

    it('disables directory actions for a CLI override', () => {
        renderTab(
            createModel({
                appDataDirState: appDataDirState({
                    cliDir: 'E:\\Portable',
                    cliOverride: true,
                    currentDir: 'E:\\Portable',
                    source: 'cli'
                })
            })
        );

        expect(
            (
                screen.getByRole('button', {
                    name: 'Change folder...'
                }) as HTMLButtonElement
            ).disabled
        ).toBe(true);
        expect(screen.getByText('Command-line override')).toBeTruthy();
        expect(
            screen.queryByRole('button', {
                name: 'More data location actions'
            })
        ).toBeNull();
    });
});
