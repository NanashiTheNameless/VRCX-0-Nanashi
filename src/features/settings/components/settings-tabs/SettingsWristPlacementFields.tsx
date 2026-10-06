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

type NumberSetting = {
    id: 'width' | 'side' | 'up' | 'out' | 'tilt';
    key: string;
    min: number;
    max: number;
    unit: 'cm' | 'deg';
};

// Mirrors WristPlacement in crates/overlay-runtime/src/surfaces/wrist.rs.
const NUMBER_SETTINGS: NumberSetting[] = [
    { id: 'width', key: 'wristOverlayWidthCm', min: 10, max: 80, unit: 'cm' },
    {
        id: 'side',
        key: 'wristOverlayOffsetSideCm',
        min: -50,
        max: 50,
        unit: 'cm'
    },
    { id: 'up', key: 'wristOverlayOffsetUpCm', min: -50, max: 50, unit: 'cm' },
    {
        id: 'out',
        key: 'wristOverlayOffsetOutCm',
        min: -50,
        max: 50,
        unit: 'cm'
    },
    {
        id: 'tilt',
        key: 'wristOverlayTiltDegrees',
        min: -90,
        max: 90,
        unit: 'deg'
    }
];

type NumberValues = Record<NumberSetting['id'], number>;

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

export function clampSetting(setting: NumberSetting, value: number): number {
    if (!Number.isFinite(value)) {
        return setting.id === 'width' ? 40 : 0;
    }
    return Math.min(setting.max, Math.max(setting.min, Math.round(value)));
}

function defaultValues(widthCm: number): NumberValues {
    return { width: widthCm, side: 0, up: 0, out: 0, tilt: 0 };
}

// Fork: wrist menu size, which edge stays fixed as it grows, offsets from the
// default spot on the wrist, and tilt.
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
        void configRepository
            .getString(SIZE_KEY, 'normal')
            .then(async (size) => {
                const width = presetWidthCm(size);
                const [anchorValue, ...numbers] = await Promise.all([
                    configRepository.getString(ANCHOR_KEY, 'bottom'),
                    ...NUMBER_SETTINGS.map((setting) =>
                        configRepository.getInt(
                            setting.key,
                            setting.id === 'width' ? width : 0
                        )
                    )
                ]);
                if (!active) return;
                setPresetWidth(width);
                setAnchor(
                    ANCHORS.includes(anchorValue as WristAnchor)
                        ? (anchorValue as WristAnchor)
                        : 'bottom'
                );
                const next = defaultValues(width);
                NUMBER_SETTINGS.forEach((setting, index) => {
                    next[setting.id] = clampSetting(setting, numbers[index]);
                });
                setValues(next);
            })
            .catch(() => {});
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
            {NUMBER_SETTINGS.map((setting) => {
                const value = drafts[setting.id] ?? values[setting.id];
                return (
                    <Field
                        key={setting.id}
                        label={t(`${P}.${setting.id}`)}
                        description={t(`${P}.${setting.id}_description`)}
                        disabled={disabled}
                    >
                        <div className="flex w-56 max-w-full items-center justify-end gap-3">
                            <Slider
                                value={[value]}
                                min={setting.min}
                                max={setting.max}
                                step={1}
                                disabled={disabled}
                                aria-label={t(`${P}.${setting.id}`)}
                                onValueChange={(next) =>
                                    setDrafts((current) => ({
                                        ...current,
                                        [setting.id]: Array.isArray(next)
                                            ? next[0]
                                            : next
                                    }))
                                }
                                onValueCommitted={(next) =>
                                    commit(
                                        setting,
                                        Array.isArray(next) ? next[0] : next
                                    )
                                }
                            />
                            <span className="text-muted-foreground w-14 text-right text-sm">
                                {t(`${P}.unit_${setting.unit}`, { value })}
                            </span>
                        </div>
                    </Field>
                );
            })}

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
