import type { TFunction } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    setBool: vi.fn(async () => undefined),
    setStriped: vi.fn(async () => undefined),
    setString: vi.fn(async (..._args: unknown[]) => undefined),
    setInt: vi.fn(async (..._args: unknown[]) => undefined),
    setDensity: vi.fn(async (..._args: unknown[]) => undefined)
}));

vi.mock('@/platform/tauri/bindings', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    commands: { appAdoptionCensusLock: vi.fn(async () => null) }
}));

vi.mock('@/services/preferencesService', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    setBoolConfigPreference: mocks.setBool,
    setDataTableStripedPreference: mocks.setStriped,
    setStringConfigPreference: mocks.setString,
    setIntConfigPreference: mocks.setInt,
    setTableDensityPreference: mocks.setDensity
}));

import { getSettingsManifestEntry } from '@/shared/constants/settingsManifest';
import { usePreferencesStore } from '@/state/preferencesStore';

import {
    applySettingChange,
    canAssistantChangeSetting,
    describeAssistantSetting,
    findAssistantSettings,
    previewSettingChange,
    resolveSettingsTarget
} from './assistantSettings';

const t = ((key: string) => key) as unknown as TFunction;
const HIDE_UNFRIENDS = 'social.friend-log.hide-unfriends';
const STRIPED = 'interface.appearance.striped-tables';
const WRIST_HAND = 'vr.wrist.hand';
const HMD_TIMEOUT = 'vr.hmd.timeout';
const entry = (id: string) => {
    const found = getSettingsManifestEntry(id);
    if (!found) {
        throw new Error(`missing setting ${id}`);
    }
    return found;
};

describe('assistant settings', () => {
    let initial: ReturnType<typeof usePreferencesStore.getState>;
    beforeEach(() => {
        initial = usePreferencesStore.getState();
        vi.clearAllMocks();
    });
    afterEach(() => {
        usePreferencesStore.setState(initial, true);
    });

    it('finds settings by the words in their id, label and location', () => {
        const result = findAssistantSettings('unfriends', t);
        expect('settings' in result && result.settings[0]).toMatchObject({
            settingId: HIDE_UNFRIENDS,
            location:
                'nav_tooltip.settings > view.settings.category.social > view.settings.appearance.friend_log.header',
            valueKind: 'boolean',
            canRequestChange: true
        });
    });

    it('lists the tabs for an empty query', () => {
        const result = findAssistantSettings('  ', t);
        expect(result.tabs?.map((tab) => tab.tab)).toContain('social');
    });

    it('keeps permissions, credentials and destructive controls manual', () => {
        expect(
            canAssistantChangeSetting(getSettingsManifestEntry(HIDE_UNFRIENDS))
        ).toBe(true);
        for (const id of [
            'social.user-badges.list',
            'integrations.translation.api-key',
            'ai.assistant.disallow-edit-requests',
            'advanced.storage.avatar-cleanup',
            'media.prints.auto-delete',
            'media.prints.auto-delete-limit',
            'history-sync.backend.backend',
            'advanced.safety.enabled'
        ]) {
            expect(
                canAssistantChangeSetting(getSettingsManifestEntry(id))
            ).toBe(false);
        }
    });

    it('previews the old and new value and rejects bad requests', () => {
        usePreferencesStore.setState({ hideUnfriends: false });
        expect(
            previewSettingChange(
                { settingId: HIDE_UNFRIENDS, value: true, reason: ' Tidy ' },
                t
            )
        ).toMatchObject({
            ok: true,
            oldValue: { value: false, label: 'assistant.edit.off' },
            newValue: { value: true, label: 'assistant.edit.on' },
            reason: 'Tidy'
        });
        expect(
            previewSettingChange(
                { settingId: HIDE_UNFRIENDS, value: 'maybe' },
                t
            )
        ).toMatchObject({ ok: false });
        expect(
            previewSettingChange({ settingId: 'nope', value: true }, t)
        ).toMatchObject({ ok: false });
        expect(
            previewSettingChange(
                { settingId: 'integrations.translation.api-key', value: true },
                t
            )
        ).toMatchObject({ ok: false });
    });

    it('allows explicit safe controls in previously locked categories', () => {
        for (const id of [
            'system.startup.start-at-login',
            'system.startup.start-minimized',
            'system.updates.auto-install',
            'system.network.auto-login-delay-seconds',
            'system.network.proxy',
            'integrations.discord.show-images',
            'integrations.translation.enabled',
            'integrations.youtube.enabled',
            'notifications.webhook.format',
            'advanced.storage.feed-history',
            'advanced.safety.url-warnings',
            'social.profile-history.bio-sync',
            'history-sync.remotesync.pause-in-game'
        ])
            expect(canAssistantChangeSetting(entry(id)), id).toBe(true);
        expect(
            canAssistantChangeSetting({
                ...entry(HIDE_UNFRIENDS),
                id: 'social.new-toggle'
            })
        ).toBe(false);
    });

    it('shows and saves the switch state for inverted hide flags', async () => {
        usePreferencesStore.setState({ hideNicknames: true });
        expect(
            previewSettingChange(
                { settingId: 'interface.user-dialog.nicknames', value: true },
                t
            )
        ).toMatchObject({
            ok: true,
            oldValue: { value: false },
            newValue: { value: true }
        });
        await applySettingChange('interface.user-dialog.nicknames', true);
        expect(mocks.setBool).toHaveBeenCalledWith('hideNicknames', false);
    });

    it('rejects non-numeric values and non-primitive choices', () => {
        for (const value of [null, false, true, '', ' ', [], [5], {}]) {
            expect(
                previewSettingChange(
                    { settingId: 'notifications.tts.volume', value },
                    t
                )
            ).toMatchObject({ ok: false });
        }
        expect(
            previewSettingChange({ settingId: WRIST_HAND, value: ['left'] }, t)
        ).toMatchObject({ ok: false });
    });

    it('allows the census exception and explains locked settings', () => {
        usePreferencesStore.setState({ adoptionCensusEnabled: true });
        const census = describeAssistantSetting(
            entry('advanced.adoption-census.enabled'),
            t
        );
        expect(census).toMatchObject({
            canRequestChange: true,
            valueKind: 'boolean',
            currentValue: true
        });
        expect(
            previewSettingChange(
                { settingId: census.settingId, value: false },
                t
            )
        ).toMatchObject({
            ok: true,
            oldValue: { value: true },
            newValue: { value: false }
        });
        const locked = describeAssistantSetting(
            entry('integrations.translation.api-key'),
            t
        );
        expect(locked).toMatchObject({
            canRequestChange: false,
            changeBlockedReason: expect.stringContaining(
                'Connections, credentials, pairing'
            )
        });
    });

    it('offers choice and number settings with their options and range', () => {
        usePreferencesStore.setState({
            wristOverlayHand: 'left',
            hmdNotificationTimeout: 5000
        });
        expect(describeAssistantSetting(entry(WRIST_HAND), t)).toMatchObject({
            valueKind: 'choice',
            currentValue: 'left',
            canRequestChange: true,
            options: [
                {
                    value: 'left',
                    label: 'view.settings.vr.wrist_overlay.display_on_left'
                },
                {
                    value: 'right',
                    label: 'view.settings.vr.wrist_overlay.display_on_right'
                },
                {
                    value: 'both',
                    label: 'view.settings.vr.wrist_overlay.display_on_both'
                }
            ]
        });
        expect(describeAssistantSetting(entry(HMD_TIMEOUT), t)).toMatchObject({
            valueKind: 'number',
            currentValue: 5,
            range: { min: 1, max: 30, unit: 'seconds' }
        });
    });

    it('checks choices and ranges and shows values in the user units', () => {
        usePreferencesStore.setState({
            wristOverlayHand: 'left',
            hmdNotificationTimeout: 5000
        });
        expect(
            previewSettingChange({ settingId: WRIST_HAND, value: 'both' }, t)
        ).toMatchObject({
            ok: true,
            oldValue: {
                value: 'left',
                label: 'view.settings.vr.wrist_overlay.display_on_left'
            },
            newValue: {
                value: 'both',
                label: 'view.settings.vr.wrist_overlay.display_on_both'
            }
        });
        expect(
            previewSettingChange({ settingId: WRIST_HAND, value: 'middle' }, t)
        ).toMatchObject({ ok: false });
        expect(
            previewSettingChange({ settingId: HMD_TIMEOUT, value: 8 }, t)
        ).toMatchObject({
            ok: true,
            oldValue: { value: 5, label: '5 assistant.edit.units.seconds' },
            newValue: { value: 8, label: '8 assistant.edit.units.seconds' }
        });
        for (const value of [0, 31, 'soon']) {
            expect(
                previewSettingChange({ settingId: HMD_TIMEOUT, value }, t)
            ).toMatchObject({ ok: false });
        }
    });

    it('saves choices and numbers the way their Settings control does', async () => {
        await applySettingChange(WRIST_HAND, 'right');
        expect(mocks.setString).toHaveBeenCalledWith(
            'wristOverlayHand',
            'right'
        );
        await applySettingChange(HMD_TIMEOUT, 8);
        expect(mocks.setInt).toHaveBeenCalledWith(
            'hmdNotificationTimeout',
            8000,
            { min: 1000, max: 30000 }
        );
        await applySettingChange(
            'interface.appearance.table-density',
            'compact'
        );
        expect(mocks.setDensity).toHaveBeenCalledWith('compact');
        await expect(
            applySettingChange(WRIST_HAND, 'middle')
        ).rejects.toThrow();
    });

    it('saves through the setting own setter when it has one', async () => {
        await applySettingChange(HIDE_UNFRIENDS, true);
        expect(mocks.setBool).toHaveBeenCalledWith('hideUnfriends', true);
        await applySettingChange(STRIPED, false);
        expect(mocks.setStriped).toHaveBeenCalledWith(false);
        expect(mocks.setBool).toHaveBeenCalledTimes(1);
        await expect(
            applySettingChange('integrations.translation.api-key', true)
        ).rejects.toThrow();
    });

    it('resolves a card to its first setting', () => {
        expect(
            resolveSettingsTarget({ cardId: 'social.user-badges' })?.id
        ).toBe('social.user-badges.list');
        expect(resolveSettingsTarget({ settingId: HIDE_UNFRIENDS })?.id).toBe(
            HIDE_UNFRIENDS
        );
        expect(resolveSettingsTarget({})).toBeUndefined();
    });
});
