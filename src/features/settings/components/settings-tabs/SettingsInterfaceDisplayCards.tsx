import { useTranslation } from 'react-i18next';

import {
    DATE_FORMAT_PRESETS,
    type DateFormatPreset,
    formatDatePattern
} from '@/shared/utils/dateTime';
import type { PreferencesSnapshot } from '@/state/preferencesStore';
import { Button } from '@/ui/shadcn/button';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';

import type { SettingsPageStateSections } from '../../settingsPageStateSections';
import { SettingsCard } from '../SettingsCard';
import { Field, SegmentedPreference } from '../SettingsField';
import { SettingsInterfaceProfileAppearanceCard } from './SettingsInterfaceProfileAppearanceCard';
import { SettingsInterfaceUserDialogCard } from './SettingsInterfaceUserDialogCard';

type InterfaceState = SettingsPageStateSections['interface'];
type SettingsInterfaceDisplayPrefs = Pick<
    PreferencesSnapshot,
    | 'showInstanceIdInLocation'
    | 'isAgeGatedInstancesVisible'
    | 'showNewDashboardButton'
    | 'dtHour12'
    | 'dtIsoFormat'
    | 'dtDateFormat'
    | 'weekStartsOn'
    | 'feedTimeDisplayMode'
>;
type SettingsInterfaceDisplayCardsProps = {
    prefs: SettingsInterfaceDisplayPrefs;
} & Pick<
    InterfaceState,
    | 'onShowInstanceIdInLocationChange'
    | 'onAgeGatedInstancesVisibleChange'
    | 'onShowNewDashboardButtonChange'
    | 'onOpenTablePageSizes'
    | 'onOpenTableLimits'
    | 'onHour12Change'
    | 'onIsoFormatChange'
    | 'onDateFormatChange'
    | 'onWeekStartsOnChange'
    | 'onFeedTimeDisplayModeChange'
>;

const timeFormatOptions = [
    ['12', 'view.settings.appearance.timedate.time_format_12'],
    ['24', 'view.settings.appearance.timedate.time_format_24']
] as const;

const DATE_FORMAT_SAMPLE = new Date(2026, 11, 31, 21, 5, 9);

function dateFormatOptionLabel(
    preset: DateFormatPreset,
    hour12: boolean,
    localeLabel: string
) {
    if (preset === 'locale') {
        return localeLabel;
    }
    return formatDatePattern(DATE_FORMAT_SAMPLE, preset, hour12, {
        date: true,
        time: true,
        seconds: true
    });
}

const weekStartOptions = [
    ['1', 'common.days.monday'],
    ['0', 'common.days.sunday'],
    ['6', 'common.days.saturday']
] as const;

export function SettingsInterfaceDisplayCards({
    prefs,
    onShowInstanceIdInLocationChange,
    onAgeGatedInstancesVisibleChange,
    onShowNewDashboardButtonChange,
    onOpenTablePageSizes,
    onOpenTableLimits,
    onHour12Change,
    onIsoFormatChange,
    onDateFormatChange,
    onWeekStartsOnChange,
    onFeedTimeDisplayModeChange
}: SettingsInterfaceDisplayCardsProps) {
    const { t } = useTranslation();
    const dateFormatOptions = DATE_FORMAT_PRESETS.map((preset) => ({
        value: preset,
        label: dateFormatOptionLabel(
            preset,
            prefs.dtHour12,
            t('view.settings.appearance.timedate.date_format_locale')
        )
    }));

    return (
        <>
            <SettingsCard
                cardId="interface.display"
                title={t('view.settings.appearance.display.header')}
            >
                <Field
                    label={t(
                        'view.settings.appearance.appearance.show_instance_id'
                    )}
                >
                    <Switch
                        checked={prefs.showInstanceIdInLocation}
                        onCheckedChange={onShowInstanceIdInLocationChange}
                    />
                </Field>

                <Field
                    label={t(
                        'view.settings.appearance.appearance.age_gated_instances'
                    )}
                    description={t(
                        'view.settings.appearance.appearance.age_gated_instances_description'
                    )}
                >
                    <Switch
                        checked={prefs.isAgeGatedInstancesVisible}
                        onCheckedChange={onAgeGatedInstancesVisibleChange}
                    />
                </Field>
            </SettingsCard>

            <SettingsInterfaceProfileAppearanceCard />

            <SettingsInterfaceUserDialogCard />

            <SettingsCard
                cardId="interface.navigation"
                title={t('view.settings.interface.navigation.header')}
            >
                <Field
                    label={t(
                        'view.settings.interface.navigation.show_new_dashboard_button'
                    )}
                >
                    <Switch
                        checked={prefs.showNewDashboardButton}
                        onCheckedChange={onShowNewDashboardButtonChange}
                    />
                </Field>
            </SettingsCard>

            <SettingsCard
                cardId="interface.tables"
                title={t('view.settings.interface.lists_tables.header')}
            >
                <Field
                    label={t(
                        'view.settings.appearance.appearance.table_page_sizes'
                    )}
                >
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onOpenTablePageSizes}
                    >
                        {t('common.actions.configure')}
                    </Button>
                </Field>

                <Field
                    label={t(
                        'view.settings.appearance.appearance.table_entries_settings'
                    )}
                    description={t(
                        'view.settings.appearance.appearance.table_entries_settings_description'
                    )}
                >
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onOpenTableLimits}
                    >
                        {t('common.actions.configure')}
                    </Button>
                </Field>
            </SettingsCard>

            <SettingsCard
                cardId="interface.time-date"
                title={t('view.settings.appearance.timedate.header')}
            >
                <Field
                    label={t('view.settings.appearance.timedate.time_format')}
                    controlId="settings-time-format"
                >
                    <Select
                        value={prefs.dtHour12 ? '12' : '24'}
                        items={timeFormatOptions.map(([value, labelKey]) => ({
                            value,
                            label: t(labelKey)
                        }))}
                        onValueChange={(value) => {
                            if (value !== null) {
                                onHour12Change(value);
                            }
                        }}
                    >
                        <SelectTrigger
                            id="settings-time-format"
                            className="w-56"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {timeFormatOptions.map(([value, labelKey]) => (
                                    <SelectItem key={value} value={value}>
                                        {t(labelKey)}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </Field>

                <Field
                    label={t('view.settings.appearance.timedate.date_format')}
                    description={t(
                        'view.settings.appearance.timedate.date_format_description'
                    )}
                    controlId="settings-date-format"
                >
                    <Select
                        value={prefs.dtDateFormat}
                        items={dateFormatOptions}
                        onValueChange={(value) => {
                            if (value !== null) {
                                onDateFormatChange(value);
                            }
                        }}
                    >
                        <SelectTrigger
                            id="settings-date-format"
                            className="w-56"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {dateFormatOptions.map((option) => (
                                    <SelectItem
                                        key={option.value}
                                        value={option.value}
                                    >
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </Field>

                <Field
                    label={t(
                        'view.settings.appearance.timedate.force_iso_date_format'
                    )}
                >
                    <Switch
                        checked={prefs.dtIsoFormat}
                        onCheckedChange={onIsoFormatChange}
                    />
                </Field>

                <Field
                    label={t(
                        'view.settings.appearance.timedate.week_starts_on'
                    )}
                    description={t(
                        'view.settings.appearance.timedate.week_starts_on_description'
                    )}
                    controlId="settings-week-starts-on"
                >
                    <Select
                        value={String(prefs.weekStartsOn)}
                        items={weekStartOptions.map(([value, labelKey]) => ({
                            value,
                            label: t(labelKey)
                        }))}
                        onValueChange={(value) => {
                            if (value !== null) {
                                onWeekStartsOnChange(value);
                            }
                        }}
                    >
                        <SelectTrigger
                            id="settings-week-starts-on"
                            className="w-56"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {weekStartOptions.map(([value, labelKey]) => (
                                    <SelectItem key={value} value={value}>
                                        {t(labelKey)}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </Field>

                <Field
                    label={t(
                        'view.settings.appearance.timedate.feed_time_display'
                    )}
                >
                    <SegmentedPreference
                        value={prefs.feedTimeDisplayMode || 'relative'}
                        onChange={onFeedTimeDisplayModeChange}
                        options={[
                            {
                                value: 'exact',
                                label: t(
                                    'view.settings.appearance.timedate.feed_time_display_exact'
                                )
                            },
                            {
                                value: 'relative',
                                label: t(
                                    'view.settings.appearance.timedate.feed_time_display_relative'
                                )
                            }
                        ]}
                    />
                </Field>
            </SettingsCard>
        </>
    );
}
