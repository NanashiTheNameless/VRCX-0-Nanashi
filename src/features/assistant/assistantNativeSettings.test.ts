import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    profileGet: vi.fn(),
    profileSet: vi.fn(),
    syncGet: vi.fn(),
    syncSet: vi.fn(),
    safetyGet: vi.fn(),
    safetySet: vi.fn(),
    ipcStatus: vi.fn(),
    ipcSet: vi.fn(),
    worldDataStatus: vi.fn(),
    worldDataSet: vi.fn()
}));
vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appProfileHistorySettingsGet: mocks.profileGet,
        appProfileHistorySettingsSet: mocks.profileSet,
        appRemoteSyncSettingsGet: mocks.syncGet,
        appRemoteSyncSettingsSet: mocks.syncSet,
        appSafetySettingsGet: mocks.safetyGet,
        appSafetySettingsSave: mocks.safetySet,
        appVrcxIpcStatus: mocks.ipcStatus,
        appVrcxIpcSetSettings: mocks.ipcSet,
        appVrcxWorldDataStatus: mocks.worldDataStatus,
        appVrcxWorldDataSetSettings: mocks.worldDataSet
    }
}));

import {
    loadAssistantNativeSettings,
    nativeSettingAction,
    saveAssistantNativeSetting,
    useAssistantNativeSettings
} from './assistantNativeSettings';
import { parseSettingValue } from './assistantSettingSpecs';

describe('native assistant setting adapters', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        useAssistantNativeSettings.setState({ values: {} });
    });

    it('uses only the sync intervals offered by Settings and preserves connections', async () => {
        mocks.syncGet.mockResolvedValue({
            backend: 'off',
            apiOrigin: 'https://api.example.com',
            websiteOrigin: 'https://example.com',
            paired: false,
            syncIntervalMinutes: 10,
            syncSettingsEnabled: false,
            pauseWhileGameRunning: true
        });
        const spec = nativeSettingAction(
            'history-sync.remotesync.sync-interval'
        )!.spec!;
        expect(parseSettingValue(spec, 3)).toMatchObject({ ok: false });
        expect(parseSettingValue(spec, 15)).toMatchObject({
            ok: true,
            stored: 15
        });
        await saveAssistantNativeSetting(
            'history-sync.remotesync.sync-interval',
            15
        );
        expect(mocks.syncSet).toHaveBeenCalledWith(
            'off',
            'https://api.example.com',
            'https://example.com',
            15,
            false,
            true
        );
    });

    it('serializes approved profile edits and reads fresh settings inside each save', async () => {
        let stored = {
            status: { recording: false, sync: true },
            bio: { recording: false, sync: false },
            pronouns: { recording: false, sync: true }
        };
        mocks.profileGet.mockImplementation(async () =>
            structuredClone(stored)
        );
        mocks.profileSet.mockImplementation(async (next: typeof stored) => {
            await Promise.resolve();
            stored = next;
        });
        await Promise.all([
            saveAssistantNativeSetting(
                'social.profile-history.status-recording',
                true
            ),
            saveAssistantNativeSetting(
                'social.profile-history.bio-recording',
                true
            )
        ]);
        expect(stored).toEqual({
            status: { recording: true, sync: true },
            bio: { recording: true, sync: false },
            pronouns: { recording: false, sync: true }
        });
    });

    it('does not enable safety or change account actions when changing a warning', async () => {
        const settings = {
            enabled: false,
            urlWarnings: true,
            warnShorteners: true,
            sources: [
                {
                    id: 'source',
                    enabled: true,
                    blockUsers: true,
                    globalHide: true,
                    banGroupIds: ['grp_example']
                }
            ]
        };
        mocks.safetyGet.mockResolvedValue(settings);
        await saveAssistantNativeSetting('advanced.safety.url-warnings', false);
        expect(mocks.safetySet).toHaveBeenCalledWith({
            ...settings,
            urlWarnings: false
        });
    });

    it('changes one VRCX IPC field and keeps the others', async () => {
        mocks.ipcStatus.mockResolvedValue({
            enabled: false,
            pipeName: 'custom-pipe',
            socketPath: '/run/user/1000/vrcx.sock'
        });
        mocks.ipcSet.mockResolvedValue({ error: null });
        await saveAssistantNativeSetting('integrations.vrcx-ipc.enabled', true);
        expect(mocks.ipcSet).toHaveBeenCalledWith({
            enabled: true,
            pipeName: 'custom-pipe',
            socketPath: '/run/user/1000/vrcx.sock'
        });

        const pipeSpec = nativeSettingAction(
            'integrations.vrcx-ipc.pipe-name'
        )!.spec!;
        expect(parseSettingValue(pipeSpec, 'a/b')).toMatchObject({
            ok: false
        });
        expect(parseSettingValue(pipeSpec, ' my-pipe ')).toEqual({
            ok: true,
            shown: 'my-pipe',
            stored: 'my-pipe'
        });
        expect(parseSettingValue(pipeSpec, '')).toEqual({
            ok: true,
            shown: '',
            stored: ''
        });
        expect(parseSettingValue(pipeSpec, 5)).toMatchObject({ ok: false });
    });

    it('reports a world data port that could not be opened', async () => {
        mocks.worldDataStatus.mockResolvedValue({ enabled: true, port: 22500 });
        mocks.worldDataSet.mockResolvedValue({
            error: 'Port 23000 is already in use.'
        });
        const spec = nativeSettingAction('integrations.world-data.port')!.spec!;
        expect(parseSettingValue(spec, 80)).toMatchObject({ ok: false });
        await expect(
            saveAssistantNativeSetting('integrations.world-data.port', 23000)
        ).rejects.toThrow('Port 23000 is already in use.');
        expect(mocks.worldDataSet).toHaveBeenCalledWith({
            enabled: true,
            port: 23000
        });
    });

    it('does not invent a current value when native reads fail', async () => {
        mocks.profileGet.mockRejectedValue(new Error('unavailable'));
        await expect(
            loadAssistantNativeSettings(['social.profile-history.bio-sync'])
        ).rejects.toThrow('unavailable');
        expect(useAssistantNativeSettings.getState().values).toEqual({});
        expect(mocks.profileSet).not.toHaveBeenCalled();
    });
});
