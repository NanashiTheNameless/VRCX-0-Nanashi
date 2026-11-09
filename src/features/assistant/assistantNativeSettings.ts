import { create } from 'zustand';

import {
    PROFILE_HISTORY_FIELDS,
    profileHistorySettingId
} from '@/lib/profileHistoryFields';
import { commands, type ProfileHistoryField } from '@/platform/tauri/bindings';

import type { SettingValueSpec } from './assistantSettingSpecs';

type NativeSettingAction = {
    spec?: SettingValueSpec;
    read: () => Promise<boolean | number>;
    save: (value: boolean | number | string) => Promise<void>;
};

function profileField(
    field: ProfileHistoryField,
    property: 'recording' | 'sync'
): NativeSettingAction {
    return {
        read: async () => {
            const value = (await commands.appProfileHistorySettingsGet())[
                field
            ]?.[property];
            if (value === undefined) return property === 'sync';
            if (typeof value !== 'boolean')
                throw new Error(
                    'The app returned an incomplete profile history setting.'
                );
            return value;
        },
        save: async (value) => {
            const settings = await commands.appProfileHistorySettingsGet();
            await commands.appProfileHistorySettingsSet({
                ...settings,
                [field]: {
                    recording: false,
                    sync: true,
                    ...settings[field],
                    [property]: value
                }
            });
        }
    };
}

function safetyWarning(
    property: 'urlWarnings' | 'warnShorteners'
): NativeSettingAction {
    return {
        read: async () =>
            (await commands.appSafetySettingsGet())[property] ?? true,
        save: async (value) => {
            // Preserve sources, account actions, lists, and the master switch.
            const settings = await commands.appSafetySettingsGet();
            await commands.appSafetySettingsSave({
                ...settings,
                [property]: value
            });
        }
    };
}

function syncPreference(
    property:
        | 'syncIntervalMinutes'
        | 'pauseWhileGameRunning'
        | 'syncSettingsEnabled',
    spec?: SettingValueSpec
): NativeSettingAction {
    return {
        spec,
        read: async () => (await commands.appRemoteSyncSettingsGet())[property],
        save: async (value) => {
            // Read again at approval time. Never switch backend, server, or pairing.
            const settings = await commands.appRemoteSyncSettingsGet();
            const next = { ...settings, [property]: value };
            await commands.appRemoteSyncSettingsSet(
                settings.backend,
                settings.apiOrigin,
                settings.websiteOrigin,
                next.syncIntervalMinutes,
                next.syncSettingsEnabled,
                next.pauseWhileGameRunning
            );
        }
    };
}

const PROFILE_HISTORY_ACTIONS = Object.fromEntries(
    PROFILE_HISTORY_FIELDS.flatMap((info) =>
        (['recording', 'sync'] as const).map((property) => [
            profileHistorySettingId(info, property),
            profileField(info.field, property)
        ])
    )
);

const NATIVE_SETTING_ACTIONS: Readonly<Record<string, NativeSettingAction>> = {
    ...PROFILE_HISTORY_ACTIONS,
    'advanced.safety.url-warnings': safetyWarning('urlWarnings'),
    'advanced.safety.shorteners': safetyWarning('warnShorteners'),
    'history-sync.remotesync.sync-interval': syncPreference(
        'syncIntervalMinutes',
        {
            kind: 'number',
            min: 1,
            max: 60,
            unit: 'minutes',
            choices: [1, 5, 10, 15, 30, 60]
        }
    ),
    'history-sync.remotesync.pause-in-game': syncPreference(
        'pauseWhileGameRunning'
    ),
    'history-sync.remotesync.sync-settings': syncPreference(
        'syncSettingsEnabled'
    )
};

export function nativeSettingAction(
    id: string
): NativeSettingAction | undefined {
    return Object.hasOwn(NATIVE_SETTING_ACTIONS, id)
        ? NATIVE_SETTING_ACTIONS[id]
        : undefined;
}

let nativeSaveQueue = Promise.resolve();

/** Serialize approved native edits so two cards cannot overwrite each other's fields. */
export async function saveAssistantNativeSetting(
    id: string,
    value: boolean | number | string
): Promise<void> {
    const action = nativeSettingAction(id);
    if (!action)
        throw new Error('This setting has no supported native save action.');
    const saved = nativeSaveQueue.then(() => action.save(value));
    nativeSaveQueue = saved.catch(() => undefined);
    await saved;
}

// Native preferences are not part of the config preference store. Read them before
// a lookup/card and again before approval; never invent a default current value.
export const useAssistantNativeSettings = create<{
    values: Record<string, boolean | number>;
}>(() => ({ values: {} }));

export async function loadAssistantNativeSettings(
    ids: readonly string[]
): Promise<void> {
    const values: Record<string, boolean | number> = {};
    for (const id of new Set(ids)) {
        const action = nativeSettingAction(id);
        if (action) values[id] = await action.read();
    }
    if (Object.keys(values).length) {
        useAssistantNativeSettings.setState((state) => ({
            values: { ...state.values, ...values }
        }));
    }
}
