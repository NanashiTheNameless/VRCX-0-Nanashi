import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    profileGet: vi.fn(),
    profileSet: vi.fn(),
    syncGet: vi.fn(),
    syncSet: vi.fn(),
    safetyGet: vi.fn(),
    safetySet: vi.fn()
}));
vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appProfileHistorySettingsGet: mocks.profileGet,
        appProfileHistorySettingsSet: mocks.profileSet,
        appRemoteSyncSettingsGet: mocks.syncGet,
        appRemoteSyncSettingsSet: mocks.syncSet,
        appSafetySettingsGet: mocks.safetyGet,
        appSafetySettingsSave: mocks.safetySet
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

    it('does not invent a current value when native reads fail', async () => {
        mocks.profileGet.mockRejectedValue(new Error('unavailable'));
        await expect(
            loadAssistantNativeSettings(['social.profile-history.bio-sync'])
        ).rejects.toThrow('unavailable');
        expect(useAssistantNativeSettings.getState().values).toEqual({});
        expect(mocks.profileSet).not.toHaveBeenCalled();
    });
});
