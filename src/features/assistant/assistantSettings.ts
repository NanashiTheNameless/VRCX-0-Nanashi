import type { TFunction } from 'i18next';

import {
    findDisabledAncestor,
    getSettingPreferenceKey
} from '@/features/settings/settingsFieldState';
import { ConfigKeys } from '@/repositories/configKeys';
import {
    setAccessibleStatusIndicatorsPreference,
    setBoolConfigPreference,
    setCloseToTrayPreference,
    setCropInstancePrintsPreference,
    setDataTableStripedPreference,
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

import {
    displayValue,
    parseSettingValue,
    saveSpecValue,
    SETTING_VALUE_SPECS
} from './assistantSettingSpecs';

const RESULT_LIMIT = 12;

// Settings the assistant may show but never ask to change: turning the
// assistant itself on or off, anything that sends data to other services or
// changes what the app reports, sync, updates, network, storage that deletes
// history, deleting VRChat prints, safety actions, and starting with the OS.
const LOCKED_TABS: ReadonlySet<string> = new Set([
    'ai',
    'integrations',
    'history-sync'
]);
const LOCKED_CARDS: ReadonlySet<string> = new Set([
    'system.updates',
    'system.network',
    'system.startup',
    'advanced.storage',
    'notifications.webhook'
]);
const LOCKED_SETTINGS: ReadonlySet<string> = new Set([
    'media.prints.auto-delete',
    'media.prints.auto-delete-limit'
]);
const LOCKED_WORDS = /safety|census|telemetry|proxy|update|sync/i;

// Boolean settings saved through their own setter because changing them does
// more than store the value.
const DEDICATED_BOOL_SETTERS: Partial<
    Record<keyof PreferencesSnapshot, (value: boolean) => Promise<unknown>>
> = {
    accessibleStatusIndicators: setAccessibleStatusIndicatorsPreference,
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
    systemWindowFrame: setSystemWindowFramePreference,
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
    range?: { min: number; max: number; unit: string };
    canRequestChange: boolean;
    blocked: boolean;
    note?: string;
};

/** A value as the user sees it on an approval card. */
export type SettingValueDisplay = { value: unknown; label: string };

function isLocked(entry: SettingsManifestEntry): boolean {
    return (
        LOCKED_TABS.has(entry.tab) ||
        LOCKED_CARDS.has(entry.cardId) ||
        LOCKED_SETTINGS.has(entry.id) ||
        LOCKED_WORDS.test(entry.id) ||
        LOCKED_WORDS.test(entry.prefKey ?? '')
    );
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
 * in SETTING_VALUE_SPECS, outside the locked areas.
 */
export function canAssistantChangeSetting(
    entry: SettingsManifestEntry | undefined,
    prefs: PreferencesSnapshot = usePreferencesStore.getState()
): boolean {
    const key = getSettingPreferenceKey(entry);
    if (!entry || !key || isLocked(entry)) {
        return false;
    }
    return isBoolSetting(key, prefs) || Boolean(SETTING_VALUE_SPECS[key]);
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
    const key = getSettingPreferenceKey(entry);
    const spec = key ? SETTING_VALUE_SPECS[key] : undefined;
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
    const key = getSettingPreferenceKey(entry);
    const spec = key ? SETTING_VALUE_SPECS[key] : undefined;
    const stored = key ? prefs[key] : undefined;
    const blockedBy = findDisabledAncestor(entry, prefs);
    const canRequestChange = canAssistantChangeSetting(entry, prefs);
    const notes = [
        blockedBy
            ? `Has no effect until "${t(blockedBy.labelKey)}" is turned on.`
            : '',
        canRequestChange
            ? ''
            : isLocked(entry)
              ? 'Only the user can change this one; use show_in_settings.'
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
                          unit: spec.unit
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
          key: keyof PreferencesSnapshot;
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
    const key = getSettingPreferenceKey(entry);
    if (!entry || !key) {
        return {
            ok: false,
            error: 'Unknown settingId. Look it up with find_settings.'
        };
    }
    if (!canAssistantChangeSetting(entry, prefs)) {
        return {
            ok: false,
            error: 'This setting cannot be changed by the assistant. Use show_in_settings so the user can change it.'
        };
    }
    if (isBoolSetting(key, prefs)) {
        const next = readBoolean(value);
        return next === null
            ? { ok: false, error: 'This setting takes true or false.' }
            : { ok: true, entry, key, shown: next, stored: next };
    }
    const spec = SETTING_VALUE_SPECS[key];
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
    return {
        ok: true,
        info,
        oldValue: displaySettingValue(parsed.entry, info.currentValue, t),
        newValue: displaySettingValue(parsed.entry, parsed.shown, t),
        reason: typeof record.reason === 'string' ? record.reason.trim() : ''
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
