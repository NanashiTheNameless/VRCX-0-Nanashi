import type { TFunction } from 'i18next';

import {
    findDisabledAncestor,
    getSettingPreferenceKey
} from '@/features/settings/settingsFieldState';
import { commands } from '@/platform/tauri/bindings';
import { ConfigKeys } from '@/repositories/configKeys';
import {
    setAccessibleStatusIndicatorsPreference,
    setBoolConfigPreference,
    setCloseToTrayPreference,
    setCropInstancePrintsPreference,
    setDataTableStripedPreference,
    setDiscordBoolPreference,
    setFeedPersistenceDisabledPreference,
    setGameLogPersistenceDisabledPreference,
    setProxyEnabledPreference,
    setStartAtWindowsStartupPreference,
    setTranslationApiEnabledPreference,
    setYoutubeApiEnabledPreference,
    setRecentActionCooldownEnabledPreference,
    setSaveInstanceEmojiPreference,
    setSaveInstancePrintsPreference,
    setSaveInstanceStickersPreference,
    setScreenshotHelperCopyToClipboardPreference,
    setScreenshotHelperModifyFilenamePreference,
    setScreenshotHelperPreference,
    setShowNewDashboardButtonPreference,
    setStartAsMinimizedPreference,
    setSystemWindowFramePreference,
    setWristOverlayEnabledPreference
} from '@/services/preferencesService';
import { isUpdateCheckDisabledBuild } from '@/shared/buildLabel';
import {
    getSettingsCard,
    getSettingsManifestEntry,
    getSettingsTabLabelKey,
    SETTINGS_MANIFEST,
    SETTINGS_TABS,
    type SettingsManifestEntry
} from '@/shared/constants/settingsManifest';
import {
    usePreferencesStore,
    type PreferencesSnapshot
} from '@/state/preferencesStore';
import { markRestartPending } from '@/state/restartPendingStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import {
    nativeSettingAction,
    saveAssistantNativeSetting,
    useAssistantNativeSettings
} from './assistantNativeSettings';
import {
    ASSISTANT_EDITABLE_SETTINGS,
    INVERTED_SETTING_SWITCHES
} from './assistantSettingPolicy';
import {
    displayValue,
    parseSettingValue,
    saveSpecValue,
    SETTING_VALUE_SPECS
} from './assistantSettingSpecs';
import { asciiAssistantPunctuation } from './assistantText';

const RESULT_LIMIT = 12;
export const ADOPTION_CENSUS_SETTING = 'advanced.adoption-census.enabled';

// Boolean settings saved through their own setter because changing them does
// more than store the value.
const DEDICATED_BOOL_SETTERS: Partial<
    Record<keyof PreferencesSnapshot, (value: boolean) => Promise<unknown>>
> = {
    accessibleStatusIndicators: setAccessibleStatusIndicatorsPreference,
    isStartAtWindowsStartup: setStartAtWindowsStartupPreference,
    proxyEnabled: async (value) => {
        await setProxyEnabledPreference(value);
        markRestartPending();
    },
    gameLogDisabled: setGameLogPersistenceDisabledPreference,
    feedPersistenceDisabled: setFeedPersistenceDisabledPreference,
    translationAPI: setTranslationApiEnabledPreference,
    youtubeAPI: setYoutubeApiEnabledPreference,
    discordActive: (value) => setDiscordBoolPreference('discordActive', value),
    discordWorldIntegration: (value) =>
        setDiscordBoolPreference('discordWorldIntegration', value),
    discordInstance: (value) =>
        setDiscordBoolPreference('discordInstance', value),
    discordShowPlatform: (value) =>
        setDiscordBoolPreference('discordShowPlatform', value),
    discordHideInvite: (value) =>
        setDiscordBoolPreference('discordHideInvite', value),
    discordJoinButton: (value) =>
        setDiscordBoolPreference('discordJoinButton', value),
    discordHideImage: (value) =>
        setDiscordBoolPreference('discordHideImage', value),
    discordWorldNameAsDiscordStatus: (value) =>
        setDiscordBoolPreference('discordWorldNameAsDiscordStatus', value),
    isCloseToTray: setCloseToTrayPreference,
    cropInstancePrints: setCropInstancePrintsPreference,
    dataTableStriped: setDataTableStripedPreference,
    recentActionCooldownEnabled: setRecentActionCooldownEnabledPreference,
    saveInstanceEmoji: setSaveInstanceEmojiPreference,
    saveInstancePrints: setSaveInstancePrintsPreference,
    saveInstanceStickers: setSaveInstanceStickersPreference,
    screenshotHelper: setScreenshotHelperPreference,
    screenshotHelperCopyToClipboard:
        setScreenshotHelperCopyToClipboardPreference,
    screenshotHelperModifyFilename: setScreenshotHelperModifyFilenamePreference,
    showNewDashboardButton: setShowNewDashboardButtonPreference,
    isStartAsMinimizedState: setStartAsMinimizedPreference,
    systemWindowFrame: async (value) => {
        await setSystemWindowFramePreference(value);
        markRestartPending();
    },
    wristOverlayEnabled: setWristOverlayEnabledPreference
};

export type AssistantSettingValueKind =
    | 'boolean'
    | 'number'
    | 'choice'
    | 'other';

export type AssistantSettingInfo = {
    settingId: string;
    cardId: string;
    label: string;
    description: string;
    location: string;
    valueKind: AssistantSettingValueKind;
    currentValue: unknown;
    options?: { value: string | number; label: string }[];
    range?: {
        min: number;
        max: number;
        unit: string;
        choices?: readonly number[];
    };
    canRequestChange: boolean;
    blocked: boolean;
    note?: string;
    changeBlockedReason?: string;
};

/** A value as the user sees it on an approval card. */
export type SettingValueDisplay = { value: unknown; label: string };

function assistantPreferenceKey(
    entry: SettingsManifestEntry | undefined
): keyof PreferencesSnapshot | undefined {
    return entry?.id === ADOPTION_CENSUS_SETTING
        ? 'adoptionCensusEnabled'
        : getSettingPreferenceKey(entry);
}

function isLocked(entry: SettingsManifestEntry): boolean {
    return !ASSISTANT_EDITABLE_SETTINGS.has(entry.id);
}

function lockedSettingReason(entry: SettingsManifestEntry): string {
    switch (entry.id) {
        case 'ai.assistant.enabled':
        case 'ai.assistant.disallow-edit-requests':
        case 'ai.mcp.enabled':
        case 'ai.mcp.allow-lan':
        case 'ai.mcp.allow-vrchat-writes':
        case 'integrations.api.enabled':
        case 'integrations.api.information-types':
        case 'integrations.api.allow-lan':
            return 'Assistant permissions and access to app data must be changed manually. The assistant cannot grant or remove its own access.';
        case 'ai.assistant.default-model':
        case 'ai.assistant.playbook-mode':
        case 'ai.endpoints.follow-custom-proxy':
        case 'ai.mcp.connect':
        case 'ai.mcp.port':
        case 'ai.mcp.token':
        case 'ai.mcp.rotate-token':
        case 'integrations.translation.api-key':
        case 'integrations.youtube.api-key':
        case 'integrations.api.port':
        case 'integrations.api.token':
        case 'integrations.remote-database.enabled':
        case 'integrations.remote-database.providers':
        case 'notifications.webhook.url':
        case 'history-sync.backend.backend':
        case 'history-sync.remotesync.api-url':
        case 'history-sync.remotesync.website-url':
        case 'history-sync.remotesync.dedupe-device':
        case 'history-sync.remotesync.setting-choices':
        case 'history-sync.recorder.status':
            return 'Connections, credentials, pairing, and data-access choices must be configured manually. The assistant cannot edit these through chat.';
        case 'media.prints.auto-delete':
        case 'media.prints.auto-delete-limit':
        case 'advanced.storage.auto-sweep-cache':
        case 'advanced.storage.avatar-cleanup':
        case 'advanced.storage.browse-history-retention':
        case 'advanced.storage.data-location':
        case 'advanced.danger.purge-avatar-history':
        case 'advanced.data-export.import':
        case 'advanced.import-recovery.gamelog-import':
            return 'Data deletion, cleanup, migration, and replacement must be reviewed and performed manually.';
        case 'advanced.safety.enabled':
            return 'The safety master switch must be changed manually because enabling it can reactivate saved blocking, hiding, or banning rules.';
        case 'advanced.safety.global-hide':
            return 'Automatic hiding and other safety actions must be configured and reviewed manually.';
        case 'social.interaction.auto-decline-friend-requests':
            return 'Automatic friend-request rejection affects other users and must be configured manually.';
        case 'system.updates.update-check-disabled':
        case 'ai.mcp.status':
        case 'integrations.api.status':
        case 'notifications.webhook.delivery-status':
            return 'This is a read-only status display, not an editable setting.';
        default:
            return 'This control has no explicitly approved assistant save action or value specification. Change it on its Settings card.';
    }
}

export async function runtimeSettingBlock(
    settingId: string
): Promise<{ reason: string; forcedOff?: boolean } | null> {
    if (settingId === 'advanced.storage.gamelog') {
        const runtime = useRuntimeStore.getState();
        if (!runtime.hostCapabilities.runtimeGameLogIngest.supported) {
            return {
                reason: 'Game Log recording is unavailable on this platform.'
            };
        }
        if (runtime.gameState.isGameRunning !== false) {
            return {
                reason: 'VRChat must be closed before changing Game Log recording. The assistant cannot override this requirement.'
            };
        }
    }
    if (
        settingId === 'system.updates.auto-install' &&
        isUpdateCheckDisabledBuild()
    ) {
        return {
            reason: 'Update checks are disabled in this build. The assistant cannot enable automatic updates.'
        };
    }
    if (settingId !== ADOPTION_CENSUS_SETTING) return null;
    try {
        const lock = await commands.appAdoptionCensusLock();
        if (!lock) return null;
        const reasons = {
            policy: 'Anonymous adoption count is forced off by Windows policy. The assistant cannot override that policy.',
            environment:
                'Anonymous adoption count is forced off by an environment opt-out. The assistant cannot override that opt-out.',
            file: 'Anonymous adoption count is forced off by an opt-out flag file next to the executable. The assistant cannot override that file.'
        };
        return { reason: reasons[lock], forcedOff: true };
    } catch {
        return {
            reason: 'The app could not verify the adoption-count policy, so the assistant cannot request or apply a change right now.'
        };
    }
}

export function settingLocation(
    entry: Pick<SettingsManifestEntry, 'tab' | 'cardId'>,
    t: TFunction
): string {
    const tabKey = getSettingsTabLabelKey(entry.tab);
    const card = getSettingsCard(entry.cardId);
    return [
        t('nav_tooltip.settings'),
        tabKey ? t(tabKey) : entry.tab,
        card ? t(card.titleKey) : ''
    ]
        .filter(Boolean)
        .join(' > ');
}

function isBoolSetting(
    key: keyof PreferencesSnapshot,
    prefs: PreferencesSnapshot
): boolean {
    if (typeof prefs[key] !== 'boolean') {
        return false;
    }
    const config = (ConfigKeys as Record<string, { type: string } | undefined>)[
        key
    ];
    return Boolean(DEDICATED_BOOL_SETTERS[key]) || config?.type === 'bool';
}

/**
 * On/off settings with a known save path, and the number and choice settings
 * in SETTING_VALUE_SPECS or the native adapters, on the explicit allowlist.
 */
export function canAssistantChangeSetting(
    entry: SettingsManifestEntry | undefined,
    prefs: PreferencesSnapshot = usePreferencesStore.getState()
): boolean {
    const key = assistantPreferenceKey(entry);
    if (!entry || isLocked(entry)) {
        return false;
    }
    if (nativeSettingAction(entry.id)) return true;
    return Boolean(
        key && (isBoolSetting(key, prefs) || SETTING_VALUE_SPECS[key])
    );
}

function unitLabel(unit: string, t: TFunction): string {
    return t(`assistant.edit.units.${unit}`);
}

/** How a value of this setting reads for the user. */
export function displaySettingValue(
    entry: SettingsManifestEntry,
    shown: unknown,
    t: TFunction
): SettingValueDisplay {
    const key = assistantPreferenceKey(entry);
    const spec =
        nativeSettingAction(entry.id)?.spec ??
        (key ? SETTING_VALUE_SPECS[key] : undefined);
    if (typeof shown === 'boolean') {
        return {
            value: shown,
            label: t(shown ? 'assistant.edit.on' : 'assistant.edit.off')
        };
    }
    if (spec?.kind === 'choice') {
        const option = spec.options.find(
            (entry) => String(entry.value) === String(shown)
        );
        return {
            value: shown,
            label: option ? t(option.labelKey) : String(shown ?? '')
        };
    }
    if (spec?.kind === 'number') {
        return {
            value: shown,
            label: `${String(shown)} ${unitLabel(spec.unit, t)}`
        };
    }
    return { value: shown, label: String(shown ?? '') };
}

export function describeAssistantSetting(
    entry: SettingsManifestEntry,
    t: TFunction,
    prefs: PreferencesSnapshot = usePreferencesStore.getState()
): AssistantSettingInfo {
    const key = assistantPreferenceKey(entry);
    const spec =
        nativeSettingAction(entry.id)?.spec ??
        (key ? SETTING_VALUE_SPECS[key] : undefined);
    const native = nativeSettingAction(entry.id);
    const raw = native
        ? useAssistantNativeSettings.getState().values[entry.id]
        : key
          ? prefs[key]
          : undefined;
    const stored =
        INVERTED_SETTING_SWITCHES.has(entry.id) && typeof raw === 'boolean'
            ? !raw
            : raw;
    const blockedBy = findDisabledAncestor(entry, prefs);
    const canRequestChange = canAssistantChangeSetting(entry, prefs);
    const changeBlockedReason = canRequestChange
        ? null
        : isLocked(entry)
          ? lockedSettingReason(entry)
          : 'This setting has no supported assistant save action or value specification. Change it on its Settings card.';
    const notes = [
        blockedBy
            ? `Has no effect until "${t(blockedBy.labelKey)}" is turned on.`
            : '',
        canRequestChange
            ? ''
            : isLocked(entry)
              ? `${changeBlockedReason} Use show_in_settings.`
              : 'This setting is changed on its Settings card; use show_in_settings.'
    ].filter(Boolean);
    const shape: Pick<
        AssistantSettingInfo,
        'valueKind' | 'currentValue' | 'options' | 'range'
    > =
        typeof stored === 'boolean'
            ? { valueKind: 'boolean', currentValue: stored }
            : spec?.kind === 'choice'
              ? {
                    valueKind: 'choice',
                    currentValue: stored ?? null,
                    options: spec.options.map((option) => ({
                        value: option.value,
                        label: t(option.labelKey)
                    }))
                }
              : spec?.kind === 'number'
                ? {
                      valueKind: 'number',
                      currentValue: displayValue(spec, stored),
                      range: {
                          min: spec.min,
                          max: spec.max,
                          unit: spec.unit,
                          ...(spec.choices ? { choices: spec.choices } : {})
                      }
                  }
                : { valueKind: 'other', currentValue: stored ?? null };
    return {
        settingId: entry.id,
        cardId: entry.cardId,
        label: t(entry.labelKey),
        description: entry.descriptionKey ? t(entry.descriptionKey) : '',
        location: settingLocation(entry, t),
        ...shape,
        canRequestChange,
        ...(changeBlockedReason ? { changeBlockedReason } : {}),
        blocked: Boolean(blockedBy),
        ...(notes.length ? { note: notes.join(' ') } : {})
    };
}

function words(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 1);
}

export function findAssistantSettings(
    query: string,
    t: TFunction,
    prefs: PreferencesSnapshot = usePreferencesStore.getState()
) {
    const terms = words(query);
    if (!terms.length) {
        return {
            tabs: SETTINGS_TABS.map(([tab, labelKey]) => ({
                tab,
                label: t(labelKey)
            }))
        };
    }
    const scored = SETTINGS_MANIFEST.map((entry) => {
        const haystack = words(
            [
                t(entry.labelKey),
                entry.descriptionKey ? t(entry.descriptionKey) : '',
                settingLocation(entry, t),
                entry.id
            ].join(' ')
        );
        const score = terms.filter((term) =>
            haystack.some((word) => word.startsWith(term))
        ).length;
        return { entry, score };
    })
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score);
    return {
        settings: scored
            .slice(0, RESULT_LIMIT)
            .map(({ entry }) => describeAssistantSetting(entry, t, prefs)),
        ...(scored.length > RESULT_LIMIT
            ? { truncated: true, totalMatches: scored.length }
            : {})
    };
}

export type SettingChangePreview =
    | {
          ok: true;
          info: AssistantSettingInfo;
          oldValue: SettingValueDisplay;
          newValue: SettingValueDisplay;
          reason: string;
      }
    | { ok: false; error: string };

function readBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') {
        return value;
    }
    if (value === 'true' || value === 'on') {
        return true;
    }
    if (value === 'false' || value === 'off') {
        return false;
    }
    return null;
}

type ParsedChange =
    | {
          ok: true;
          entry: SettingsManifestEntry;
          key?: keyof PreferencesSnapshot;
          shown: string | number | boolean;
          stored: string | number | boolean;
      }
    | { ok: false; error: string };

function parseChange(
    settingId: unknown,
    value: unknown,
    prefs: PreferencesSnapshot
): ParsedChange {
    const entry = getSettingsManifestEntry(
        typeof settingId === 'string' ? settingId : ''
    );
    const key = assistantPreferenceKey(entry);
    if (!entry) {
        return {
            ok: false,
            error: 'Unknown settingId. Look it up with find_settings.'
        };
    }
    if (!canAssistantChangeSetting(entry, prefs)) {
        return {
            ok: false,
            error: `This setting is blocked for assistant changes. ${isLocked(entry) ? lockedSettingReason(entry) : 'No supported assistant save action or value specification is available.'} Use show_in_settings so the user can review it.`
        };
    }
    const native = nativeSettingAction(entry.id);
    if (
        native &&
        useAssistantNativeSettings.getState().values[entry.id] === undefined
    ) {
        return {
            ok: false,
            error: 'Read the current setting before requesting a change.'
        };
    }
    if ((native && !native.spec) || (key && isBoolSetting(key, prefs))) {
        const next = readBoolean(value);
        return next === null
            ? { ok: false, error: 'This setting takes true or false.' }
            : {
                  ok: true,
                  entry,
                  key,
                  shown: next,
                  stored: INVERTED_SETTING_SWITCHES.has(entry.id) ? !next : next
              };
    }
    const spec = native?.spec ?? (key ? SETTING_VALUE_SPECS[key] : undefined);
    if (!spec) {
        return { ok: false, error: 'This setting cannot be changed.' };
    }
    const parsed = parseSettingValue(spec, value);
    return parsed.ok
        ? { ok: true, entry, key, shown: parsed.shown, stored: parsed.stored }
        : parsed;
}

export function previewSettingChange(
    args: unknown,
    t: TFunction,
    prefs: PreferencesSnapshot = usePreferencesStore.getState()
): SettingChangePreview {
    const record =
        args && typeof args === 'object'
            ? (args as Record<string, unknown>)
            : {};
    const parsed = parseChange(record.settingId, record.value, prefs);
    if (!parsed.ok) {
        return parsed;
    }
    const info = describeAssistantSetting(parsed.entry, t, prefs);
    if (
        parsed.shown === false &&
        parsed.entry.id === 'advanced.storage.feed-history'
    ) {
        info.description = t('confirm.disable_feed_persistence');
    }
    return {
        ok: true,
        info,
        oldValue: displaySettingValue(parsed.entry, info.currentValue, t),
        newValue: displaySettingValue(parsed.entry, parsed.shown, t),
        reason:
            typeof record.reason === 'string'
                ? asciiAssistantPunctuation(record.reason.trim())
                : ''
    };
}

export async function applySettingChange(
    settingId: string,
    value: unknown
): Promise<void> {
    const parsed = parseChange(
        settingId,
        value,
        usePreferencesStore.getState()
    );
    if (!parsed.ok) {
        throw new Error(parsed.error);
    }
    const block = await runtimeSettingBlock(settingId);
    if (block) throw new Error(block.reason);
    const native = nativeSettingAction(settingId);
    if (native) {
        await saveAssistantNativeSetting(settingId, parsed.stored);
        useAssistantNativeSettings.setState((state) => ({
            values: {
                ...state.values,
                [settingId]: parsed.shown as boolean | number
            }
        }));
        return;
    }
    if (!parsed.key)
        throw new Error('This setting has no supported save action.');
    if (typeof parsed.stored === 'boolean') {
        const dedicated = DEDICATED_BOOL_SETTERS[parsed.key];
        if (dedicated) {
            await dedicated(parsed.stored);
        } else {
            await setBoolConfigPreference(
                parsed.key as Parameters<typeof setBoolConfigPreference>[0],
                parsed.stored
            );
        }
        return;
    }
    const spec = SETTING_VALUE_SPECS[parsed.key];
    if (spec) {
        await saveSpecValue(parsed.key, spec, parsed.stored);
    }
}

/** The setting to open for a show_in_settings request. */
export function resolveSettingsTarget(
    args: unknown
): SettingsManifestEntry | undefined {
    const record =
        args && typeof args === 'object'
            ? (args as Record<string, unknown>)
            : {};
    const bySetting = getSettingsManifestEntry(
        typeof record.settingId === 'string' ? record.settingId : ''
    );
    if (bySetting) {
        return bySetting;
    }
    const cardId = typeof record.cardId === 'string' ? record.cardId : '';
    return cardId
        ? SETTINGS_MANIFEST.find((entry) => entry.cardId === cardId)
        : undefined;
}
