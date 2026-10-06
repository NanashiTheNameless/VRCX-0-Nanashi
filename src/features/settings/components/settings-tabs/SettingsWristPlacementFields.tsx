import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import configRepository from '@/repositories/configRepository';
import { Button } from '@/ui/shadcn/button';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Slider } from '@/ui/shadcn/slider';

import { Field } from '../SettingsField';

const P = 'view.settings.vr.wrist_overlay.placement';
const SIZE_KEY = 'wristOverlaySize';
const ANCHOR_KEY = 'wristOverlayAnchor';
const ANCHORS = ['bottom', 'center', 'top'] as const;
type WristAnchor = (typeof ANCHORS)[number];

type SettingId =
    | 'width'
    | 'height'
    | 'header_text'
    | 'footer_text'
    | 'content_text'
    | 'side'
    | 'up'
    | 'out'
    | 'tilt';

export type NumberSetting = {
    id: SettingId;
    key: string;
    min: number;
    max: number;
    unit: 'cm' | 'deg' | 'percent';
};

const TEXT_PERCENT = { min: 50, max: 200, unit: 'percent' } as const;
const OFFSET_CM = { min: -50, max: 50, unit: 'cm' } as const;

// Mirrors load_runtime_config in crates/overlay-runtime/src/config.rs.
const NUMBER_SETTINGS: NumberSetting[] = [
    { id: 'width', key: 'wristOverlayWidthCm', min: 10, max: 80, unit: 'cm' },
    {
        id: 'height',
        key: 'wristOverlayMaxHeightCm',
        min: 10,
        max: 160,
        unit: 'cm'
    },
    {
        id: 'header_text',
        key: 'wristOverlayHeaderTextPercent',
        ...TEXT_PERCENT
    },
    {
        id: 'footer_text',
        key: 'wristOverlayFooterTextPercent',
        ...TEXT_PERCENT
    },
    {
        id: 'content_text',
        key: 'wristOverlayContentTextPercent',
        ...TEXT_PERCENT
    },
    { id: 'side', key: 'wristOverlayOffsetSideCm', ...OFFSET_CM },
    { id: 'up', key: 'wristOverlayOffsetUpCm', ...OFFSET_CM },
    { id: 'out', key: 'wristOverlayOffsetOutCm', ...OFFSET_CM },
    {
        id: 'tilt',
        key: 'wristOverlayTiltDegrees',
        min: -90,
        max: 90,
        unit: 'deg'
    }
];

const HMD_TEXT_SETTING: NumberSetting = {
    id: 'content_text',
    key: 'hmdNotificationTextPercent',
    ...TEXT_PERCENT
};

type NumberValues = Record<SettingId, number>;

/** Width the old size presets had, used until a width is saved. */
export function presetWidthCm(size: string): number {
    switch (size) {
        case 'compact':
            return 32;
        case 'large':
            return 48;
        default:
            return 40;
    }
}

/** Value used until one is saved; the height follows the width. */
export function defaultSettingValue(id: SettingId, widthCm: number): number {
    switch (id) {
        case 'width':
            return widthCm;
        case 'height':
            return widthCm * 2;
        case 'header_text':
        case 'footer_text':
        case 'content_text':
            return 100;
        default:
            return 0;
    }
}

export function clampSetting(
    setting: NumberSetting,
    value: number,
    fallback = defaultSettingValue(setting.id, 40)
): number {
    if (!Number.isFinite(value)) {
        return fallback;
    }
    return Math.min(setting.max, Math.max(setting.min, Math.round(value)));
}

function defaultValues(widthCm: number): NumberValues {
    const values = {} as NumberValues;
    for (const setting of NUMBER_SETTINGS) {
        values[setting.id] = defaultSettingValue(setting.id, widthCm);
    }
    return values;
}

function sliderValue(next: number | readonly number[]): number {
    return Array.isArray(next) ? next[0] : (next as number);
}

function NumberSliderField({
    setting,
    label,
    description,
    value,
    disabled,
    onDraft,
    onCommit
}: {
    setting: NumberSetting;
    label: string;
    description?: string;
    value: number;
    disabled: boolean;
    onDraft: (value: number) => void;
    onCommit: (value: number) => void;
}) {
    const { t } = useTranslation();
    return (
        <Field label={label} description={description} disabled={disabled}>
            <div className="flex w-56 max-w-full items-center justify-end gap-3">
                <Slider
                    value={[value]}
                    min={setting.min}
                    max={setting.max}
                    step={1}
                    disabled={disabled}
                    aria-label={label}
                    onValueChange={(next) => onDraft(sliderValue(next))}
                    onValueCommitted={(next) => onCommit(sliderValue(next))}
                />
                <span className="text-muted-foreground w-14 text-right text-sm">
                    {t(`${P}.unit_${setting.unit}`, { value })}
                </span>
            </div>
        </Field>
    );
}

// Fork: wrist menu width and maximum height, text size per area, which edge
// stays fixed as it grows, offsets from the default spot on the wrist, and tilt.
export function SettingsWristPlacementFields({
    disabled
}: {
    disabled: boolean;
}) {
    const { t } = useTranslation();
    const [presetWidth, setPresetWidth] = useState(40);
    const [values, setValues] = useState<NumberValues>(() => defaultValues(40));
    const [drafts, setDrafts] = useState<Partial<NumberValues>>({});
    const [anchor, setAnchor] = useState<WristAnchor>('bottom');

    useEffect(() => {
        let active = true;
        void (async () => {
            const preset = presetWidthCm(
                await configRepository.getString(SIZE_KEY, 'normal')
            );
            const width = clampSetting(
                NUMBER_SETTINGS[0],
                await configRepository.getInt(NUMBER_SETTINGS[0].key, preset),
                preset
            );
            const [anchorValue, ...numbers] = await Promise.all([
                configRepository.getString(ANCHOR_KEY, 'bottom'),
                ...NUMBER_SETTINGS.map((setting) =>
                    configRepository.getInt(
                        setting.key,
                        defaultSettingValue(setting.id, width)
                    )
                )
            ]);
            if (!active) return;
            setPresetWidth(preset);
            setAnchor(
                ANCHORS.includes(anchorValue as WristAnchor)
                    ? (anchorValue as WristAnchor)
                    : 'bottom'
            );
            const next = defaultValues(width);
            NUMBER_SETTINGS.forEach((setting, index) => {
                next[setting.id] = clampSetting(
                    setting,
                    numbers[index],
                    defaultSettingValue(setting.id, width)
                );
            });
            setValues(next);
        })().catch(() => {});
        return () => {
            active = false;
        };
    }, []);

    function commit(setting: NumberSetting, raw: number) {
        const value = clampSetting(setting, raw);
        setDrafts((current) => ({ ...current, [setting.id]: undefined }));
        setValues((current) => ({ ...current, [setting.id]: value }));
        void configRepository.setInt(setting.key, value);
    }

    function changeAnchor(value: WristAnchor) {
        setAnchor(value);
        void configRepository.setString(ANCHOR_KEY, value);
    }

    function reset() {
        const next = defaultValues(presetWidth);
        setValues(next);
        setDrafts({});
        for (const setting of NUMBER_SETTINGS) {
            void configRepository.setInt(setting.key, next[setting.id]);
        }
        changeAnchor('bottom');
    }

    return (
        <>
            {NUMBER_SETTINGS.map((setting) => (
                <NumberSliderField
                    key={setting.id}
                    setting={setting}
                    label={t(`${P}.${setting.id}`)}
                    description={t(`${P}.${setting.id}_description`)}
                    value={drafts[setting.id] ?? values[setting.id]}
                    disabled={disabled}
                    onDraft={(value) =>
                        setDrafts((current) => ({
                            ...current,
                            [setting.id]: value
                        }))
                    }
                    onCommit={(value) => commit(setting, value)}
                />
            ))}

            <Field
                label={t(`${P}.anchor`)}
                description={t(`${P}.anchor_description`)}
                controlId="settings-wrist-overlay-anchor"
                disabled={disabled}
            >
                <Select<WristAnchor>
                    value={anchor}
                    items={ANCHORS.map((value) => ({
                        value,
                        label: t(`${P}.anchors.${value}`)
                    }))}
                    disabled={disabled}
                    onValueChange={(value) => {
                        if (value) {
                            changeAnchor(value);
                        }
                    }}
                >
                    <SelectTrigger
                        id="settings-wrist-overlay-anchor"
                        className="w-56"
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {ANCHORS.map((value) => (
                                <SelectItem key={value} value={value}>
                                    {t(`${P}.anchors.${value}`)}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </Field>

            <Field label={t(`${P}.reset`)} disabled={disabled}>
                <Button
                    type="button"
                    variant="outline"
                    disabled={disabled}
                    onClick={reset}
                >
                    {t(`${P}.reset_action`)}
                </Button>
            </Field>
        </>
    );
}

// Fork: HMD notification text size; cards grow and shrink with it.
export function SettingsHmdTextSizeField({ disabled }: { disabled: boolean }) {
    const { t } = useTranslation();
    const [value, setValue] = useState(100);
    const [draft, setDraft] = useState<number | null>(null);

    useEffect(() => {
        let active = true;
        void configRepository
            .getInt(HMD_TEXT_SETTING.key, 100)
            .then((saved) => {
                if (active)
                    setValue(clampSetting(HMD_TEXT_SETTING, saved, 100));
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, []);

    return (
        <NumberSliderField
            setting={HMD_TEXT_SETTING}
            label={t('view.settings.vr.hmd_notifications.text_size')}
            description={t(
                'view.settings.vr.hmd_notifications.text_size_description'
            )}
            value={draft ?? value}
            disabled={disabled}
            onDraft={setDraft}
            onCommit={(raw) => {
                const next = clampSetting(HMD_TEXT_SETTING, raw, 100);
                setDraft(null);
                setValue(next);
                void configRepository.setInt(HMD_TEXT_SETTING.key, next);
            }}
        />
    );
}
