import {
    desktopToastOptions,
    notificationLayoutOptions,
    notificationTtsNameModeOptions,
    notificationTtsOptions,
    overlayToastOptions
} from '@/features/settings/settingsOptions';
import {
    setIntConfigPreference,
    setNotificationLayoutPreference,
    setStringConfigPreference,
    setTableDensityPreference
} from '@/services/preferencesService';
import type { PreferencesSnapshot } from '@/state/preferencesStore';

type PreferenceKey = keyof PreferencesSnapshot;

export type ChoiceOption = { value: string | number; labelKey: string };

export type ChoiceSettingSpec = {
    kind: 'choice';
    options: readonly ChoiceOption[];
    save?: (value: string | number) => Promise<unknown>;
};

/**
 * A number the user sees in `unit`. `scale` converts it to the stored value
 * (seconds shown, milliseconds stored: scale 1000).
 */
export type NumberSettingSpec = {
    kind: 'number';
    min: number;
    max: number;
    unit: 'seconds' | 'minutes' | 'percent';
    scale?: number;
};

export type SettingValueSpec = ChoiceSettingSpec | NumberSettingSpec;

const pairs = (
    options: readonly (readonly [string, string])[]
): ChoiceOption[] => options.map(([value, labelKey]) => ({ value, labelKey }));

const VR = 'view.settings.vr';

/**
 * Settings other than on/off ones the assistant may ask to change, with the
 * values the Settings page offers for them. Each is saved the same way its
 * Settings control saves it; ones without `save` use the generic setters.
 */
export const SETTING_VALUE_SPECS: Partial<
    Record<PreferenceKey, SettingValueSpec>
> = {
    backgroundModeDelayMinutes: {
        kind: 'number',
        min: 10,
        max: 600,
        unit: 'minutes'
    },
    tableDensity: {
        kind: 'choice',
        options: [
            {
                value: 'standard',
                labelKey:
                    'view.settings.appearance.appearance.table_density_standard'
            },
            {
                value: 'compact',
                labelKey:
                    'view.settings.appearance.appearance.table_density_compact'
            }
        ],
        save: (value) =>
            setTableDensityPreference(
                value === 'compact' ? 'compact' : 'standard'
            )
    },
    weekStartsOn: {
        kind: 'choice',
        options: [
            { value: 1, labelKey: 'common.days.monday' },
            { value: 0, labelKey: 'common.days.sunday' },
            { value: 6, labelKey: 'common.days.saturday' }
        ]
    },
    feedTimeDisplayMode: {
        kind: 'choice',
        options: [
            {
                value: 'relative',
                labelKey:
                    'view.settings.appearance.timedate.feed_time_display_relative'
            },
            {
                value: 'exact',
                labelKey:
                    'view.settings.appearance.timedate.feed_time_display_exact'
            }
        ]
    },
    randomUserColourStyle: {
        kind: 'choice',
        options: ['classic', 'pastel', 'warm', 'cool'].map((value) => ({
            value,
            labelKey: `view.settings.appearance.user_colors.random_color_styles.${value}`
        }))
    },
    notificationLayout: {
        kind: 'choice',
        options: pairs(notificationLayoutOptions),
        save: (value) =>
            setNotificationLayoutPreference(
                value === 'table' ? 'table' : 'notification-center'
            )
    },
    desktopToast: { kind: 'choice', options: pairs(desktopToastOptions) },
    desktopWidgetOpacity: {
        kind: 'number',
        min: 0,
        max: 100,
        unit: 'percent'
    },
    notificationTTS: {
        kind: 'choice',
        options: pairs(notificationTtsOptions)
    },
    notificationTTSVolume: {
        kind: 'number',
        min: 0,
        max: 100,
        unit: 'percent'
    },
    notificationTTSNameMode: {
        kind: 'choice',
        options: pairs(notificationTtsNameModeOptions)
    },
    overlayToast: { kind: 'choice', options: pairs(overlayToastOptions) },
    notificationTimeout: {
        kind: 'number',
        min: 0,
        max: 600,
        unit: 'seconds',
        scale: 1000
    },
    notificationOpacity: {
        kind: 'number',
        min: 0,
        max: 100,
        unit: 'percent'
    },
    hmdNotificationStartMode: {
        kind: 'choice',
        options: [
            {
                value: 'vrchatVrMode',
                labelKey: `${VR}.hmd_notifications.start_when_vrchat_vr_mode`
            },
            {
                value: 'steamvr',
                labelKey: `${VR}.hmd_notifications.start_when_steamvr`
            }
        ]
    },
    hmdNotificationPosition: {
        kind: 'choice',
        options: ['top', 'center', 'bottom'].map((value) => ({
            value,
            labelKey: `${VR}.hmd_notifications.position_${value}`
        }))
    },
    hmdNotificationStyle: {
        kind: 'choice',
        options: ['standard', 'compact'].map((value) => ({
            value,
            labelKey: `${VR}.hmd_notifications.style_${value}`
        }))
    },
    hmdNotificationTimeout: {
        kind: 'number',
        min: 1,
        max: 30,
        unit: 'seconds',
        scale: 1000
    },
    hmdNotificationOpacity: {
        kind: 'number',
        min: 0,
        max: 100,
        unit: 'percent'
    },
    wristOverlayStartMode: {
        kind: 'choice',
        options: [
            {
                value: 'vrchatVrMode',
                labelKey: `${VR}.wrist_overlay.start_when_vrchat_vr_mode`
            },
            {
                value: 'steamvr',
                labelKey: `${VR}.wrist_overlay.start_when_steamvr`
            }
        ]
    },
    wristOverlayButton: {
        kind: 'choice',
        options: ['grip', 'menu'].map((value) => ({
            value,
            labelKey: `${VR}.wrist_overlay.overlay_button_${value}`
        }))
    },
    wristOverlayHand: {
        kind: 'choice',
        options: ['left', 'right', 'both'].map((value) => ({
            value,
            labelKey: `${VR}.wrist_overlay.display_on_${value}`
        }))
    }
};

/** The value the user sees for a stored value. */
export function displayValue(spec: SettingValueSpec, stored: unknown): unknown {
    if (spec.kind === 'number' && typeof stored === 'number') {
        return stored / (spec.scale ?? 1);
    }
    return stored;
}

export type ParsedSettingValue =
    | { ok: true; shown: string | number; stored: string | number }
    | { ok: false; error: string };

/** Checks a value the assistant asked for, in the units the user sees. */
export function parseSettingValue(
    spec: SettingValueSpec,
    value: unknown
): ParsedSettingValue {
    if (spec.kind === 'choice') {
        const option = spec.options.find(
            (entry) => String(entry.value) === String(value)
        );
        return option
            ? { ok: true, shown: option.value, stored: option.value }
            : {
                  ok: false,
                  error: `Choose one of: ${spec.options
                      .map((entry) => JSON.stringify(entry.value))
                      .join(', ')}.`
              };
    }
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(number) || number < spec.min || number > spec.max) {
        return {
            ok: false,
            error: `Use a number from ${spec.min} to ${spec.max} ${spec.unit}.`
        };
    }
    const shown = spec.scale ? number : Math.round(number);
    return {
        ok: true,
        shown,
        stored: Math.round(shown * (spec.scale ?? 1))
    };
}

export async function saveSpecValue(
    key: PreferenceKey,
    spec: SettingValueSpec,
    stored: string | number
): Promise<void> {
    if (spec.kind === 'choice' && spec.save) {
        await spec.save(stored);
        return;
    }
    if (typeof stored === 'number') {
        await setIntConfigPreference(
            key as Parameters<typeof setIntConfigPreference>[0],
            stored,
            spec.kind === 'number'
                ? {
                      min: spec.min * (spec.scale ?? 1),
                      max: spec.max * (spec.scale ?? 1)
                  }
                : {}
        );
        return;
    }
    await setStringConfigPreference(
        key as Parameters<typeof setStringConfigPreference>[0],
        stored
    );
}
