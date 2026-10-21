import { Trash2Icon } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { GroupProfileRecord } from '@/domain/entities/group';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    Field,
    FieldDescription,
    FieldError,
    FieldGroup,
    FieldLabel
} from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { ScrollArea } from '@/ui/shadcn/scroll-area';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Textarea } from '@/ui/shadcn/textarea';
import {
    ToggleGroup,
    ToggleGroupItem,
    ToggleGroupSeparator
} from '@/ui/shadcn/toggle-group';

import { ProfileLanguagesField } from '../ProfileDetailsFields';
import { useSpokenLanguageSelection } from '../useSpokenLanguageSelection';
import {
    GROUP_EVENT_CATEGORIES,
    GROUP_EVENT_DESCRIPTION_MAX,
    GROUP_EVENT_MINUTES_MAX,
    GROUP_EVENT_PLATFORMS,
    GROUP_EVENT_TITLE_MAX,
    GROUP_EVENT_WEEKDAYS,
    groupEventFormErrors,
    type GroupEventForm,
    type GroupEventRepeat,
    type GroupEventRepeatEnd,
    type GroupEventWeeklyPattern
} from './groupEventForm';
import { GroupGalleryImageField } from './GroupGalleryImageField';

const I18N = 'dialog.group_event_edit';

const WEEKDAY_LABEL_KEYS: Record<string, string> = {
    MO: 'common.days.monday',
    TU: 'common.days.tuesday',
    WE: 'common.days.wednesday',
    TH: 'common.days.thursday',
    FR: 'common.days.friday',
    SA: 'common.days.saturday',
    SU: 'common.days.sunday'
};

const REPEAT_OPTIONS: GroupEventRepeat[] = [
    'none',
    'weekly',
    'monthly',
    'yearly'
];
const WEEKLY_PATTERNS: GroupEventWeeklyPattern[] = [
    'every_week',
    'weekdays',
    'weekend',
    'custom'
];
const REPEAT_ENDS: GroupEventRepeatEnd[] = [
    'never',
    'afterOccurrences',
    'afterDate'
];

function toggleValue(values: string[], value: string, checked: boolean) {
    return checked
        ? Array.from(new Set([...values, value]))
        : values.filter((item) => item !== value);
}

function minuteValue(value: string) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
}

export function GroupEventEditorDialog({
    open,
    initialForm,
    group,
    saving,
    onOpenChange,
    onSubmit,
    onDelete
}: {
    open: boolean;
    initialForm: GroupEventForm | null;
    group: GroupProfileRecord;
    saving: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (form: GroupEventForm) => void;
    onDelete: () => void;
}) {
    const { t } = useTranslation();
    const [form, setForm] = useState<GroupEventForm | null>(initialForm);
    const languageSelection = useSpokenLanguageSelection(form?.languages ?? []);

    useEffect(() => {
        if (open) {
            setForm(initialForm);
        }
    }, [initialForm, open]);

    if (!form) {
        return null;
    }

    const isEdit = form.mode === 'edit';
    const errors = new Set(groupEventFormErrors(form));
    const roles = Array.isArray(group.roles) ? group.roles : [];
    const isPrivateGroup = group.privacy === 'private';
    const showRepeat = !form.isSeriesOccurrence;

    function update(patch: Partial<GroupEventForm>) {
        setForm((current) => (current ? { ...current, ...patch } : current));
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal>
            <DialogContent className="grid max-h-[calc(100vh-4rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>
                        {t(
                            isEdit
                                ? `${I18N}.edit_header`
                                : `${I18N}.create_header`
                        )}
                    </DialogTitle>
                    <DialogDescription>{group.name}</DialogDescription>
                </DialogHeader>
                <ScrollArea className="-mx-1 min-h-0">
                    <FieldGroup className="gap-4 px-1 pb-3">
                        <Field>
                            <div className="flex items-center justify-between gap-2">
                                <FieldLabel htmlFor="group-event-title">
                                    {t(`${I18N}.title`)}
                                </FieldLabel>
                                <span className="text-muted-foreground text-xs tabular-nums">
                                    {form.title.length}/{GROUP_EVENT_TITLE_MAX}
                                </span>
                            </div>
                            <Input
                                id="group-event-title"
                                value={form.title}
                                maxLength={GROUP_EVENT_TITLE_MAX}
                                disabled={saving}
                                onChange={(event) =>
                                    update({ title: event.target.value })
                                }
                            />
                        </Field>
                        <Field>
                            <div className="flex items-center justify-between gap-2">
                                <FieldLabel htmlFor="group-event-description">
                                    {t(`${I18N}.description`)}
                                </FieldLabel>
                                <span className="text-muted-foreground text-xs tabular-nums">
                                    {form.description.length}/
                                    {GROUP_EVENT_DESCRIPTION_MAX}
                                </span>
                            </div>
                            <Textarea
                                id="group-event-description"
                                rows={4}
                                value={form.description}
                                maxLength={GROUP_EVENT_DESCRIPTION_MAX}
                                disabled={saving}
                                className="resize-none"
                                onChange={(event) =>
                                    update({ description: event.target.value })
                                }
                            />
                        </Field>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Field
                                data-invalid={
                                    errors.has('start_in_past') || undefined
                                }
                            >
                                <FieldLabel htmlFor="group-event-starts-at">
                                    {t(`${I18N}.starts_at`)}
                                </FieldLabel>
                                <Input
                                    id="group-event-starts-at"
                                    type="datetime-local"
                                    value={form.startsAt}
                                    disabled={saving}
                                    onChange={(event) =>
                                        update({ startsAt: event.target.value })
                                    }
                                />
                                {errors.has('start_in_past') ? (
                                    <FieldError>
                                        {t(`${I18N}.start_in_past`)}
                                    </FieldError>
                                ) : null}
                            </Field>
                            <Field
                                data-invalid={
                                    errors.has('date_range') || undefined
                                }
                            >
                                <FieldLabel htmlFor="group-event-ends-at">
                                    {t(`${I18N}.ends_at`)}
                                </FieldLabel>
                                <Input
                                    id="group-event-ends-at"
                                    type="datetime-local"
                                    value={form.endsAt}
                                    disabled={saving}
                                    onChange={(event) =>
                                        update({ endsAt: event.target.value })
                                    }
                                />
                                {errors.has('date_range') ? (
                                    <FieldError>
                                        {t(`${I18N}.invalid_date_range`)}
                                    </FieldError>
                                ) : null}
                            </Field>
                        </div>
                        {showRepeat ? (
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field>
                                    <FieldLabel>
                                        {t(`${I18N}.repeat`)}
                                    </FieldLabel>
                                    <Select
                                        value={form.repeat}
                                        disabled={saving}
                                        items={REPEAT_OPTIONS.map((value) => ({
                                            value,
                                            label: t(
                                                `${I18N}.repeat_values.${value}`
                                            )
                                        }))}
                                        onValueChange={(value) => {
                                            if (value) {
                                                update({ repeat: value });
                                            }
                                        }}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectGroup>
                                                {REPEAT_OPTIONS.map((value) => (
                                                    <SelectItem
                                                        key={value}
                                                        value={value}
                                                        disabled={
                                                            value === 'none' &&
                                                            form.hadRecurrence
                                                        }
                                                    >
                                                        {t(
                                                            `${I18N}.repeat_values.${value}`
                                                        )}
                                                    </SelectItem>
                                                ))}
                                            </SelectGroup>
                                        </SelectContent>
                                    </Select>
                                </Field>
                                {form.repeat !== 'none' ? (
                                    <Field>
                                        <FieldLabel htmlFor="group-event-interval">
                                            {t(`${I18N}.repeat_every`)}
                                        </FieldLabel>
                                        <Input
                                            id="group-event-interval"
                                            type="number"
                                            min={1}
                                            value={form.interval}
                                            disabled={saving}
                                            onChange={(event) =>
                                                update({
                                                    interval: minuteValue(
                                                        event.target.value
                                                    )
                                                })
                                            }
                                        />
                                    </Field>
                                ) : null}
                                {form.repeat === 'weekly' ? (
                                    <Field className="sm:col-span-2">
                                        <FieldLabel>
                                            {t(`${I18N}.weekly_pattern`)}
                                        </FieldLabel>
                                        <Select
                                            value={form.weeklyPattern}
                                            disabled={saving}
                                            items={WEEKLY_PATTERNS.map(
                                                (value) => ({
                                                    value,
                                                    label: t(
                                                        `${I18N}.weekly_pattern_values.${value}`
                                                    )
                                                })
                                            )}
                                            onValueChange={(value) => {
                                                if (value) {
                                                    update({
                                                        weeklyPattern: value
                                                    });
                                                }
                                            }}
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectGroup>
                                                    {WEEKLY_PATTERNS.map(
                                                        (value) => (
                                                            <SelectItem
                                                                key={value}
                                                                value={value}
                                                            >
                                                                {t(
                                                                    `${I18N}.weekly_pattern_values.${value}`
                                                                )}
                                                            </SelectItem>
                                                        )
                                                    )}
                                                </SelectGroup>
                                            </SelectContent>
                                        </Select>
                                        {form.weeklyPattern === 'custom' ? (
                                            <ToggleGroup
                                                multiple
                                                variant="outline"
                                                size="sm"
                                                disabled={saving}
                                                value={form.customDays}
                                                className="flex overflow-x-auto"
                                                onValueChange={(values) =>
                                                    update({
                                                        customDays: values
                                                    })
                                                }
                                            >
                                                {GROUP_EVENT_WEEKDAYS.map(
                                                    (day, index) => (
                                                        <Fragment key={day}>
                                                            {index > 0 ? (
                                                                <ToggleGroupSeparator />
                                                            ) : null}
                                                            <ToggleGroupItem
                                                                value={day}
                                                            >
                                                                {t(
                                                                    WEEKDAY_LABEL_KEYS[
                                                                        day
                                                                    ] ?? day
                                                                )}
                                                            </ToggleGroupItem>
                                                        </Fragment>
                                                    )
                                                )}
                                            </ToggleGroup>
                                        ) : null}
                                    </Field>
                                ) : null}
                                {form.repeat !== 'none' ? (
                                    <Field>
                                        <FieldLabel>
                                            {t(`${I18N}.ends`)}
                                        </FieldLabel>
                                        <Select
                                            value={form.repeatEnd}
                                            disabled={saving}
                                            items={REPEAT_ENDS.map((value) => ({
                                                value,
                                                label: t(
                                                    `${I18N}.ends_values.${value}`
                                                )
                                            }))}
                                            onValueChange={(value) => {
                                                if (value) {
                                                    update({
                                                        repeatEnd: value
                                                    });
                                                }
                                            }}
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectGroup>
                                                    {REPEAT_ENDS.map(
                                                        (value) => (
                                                            <SelectItem
                                                                key={value}
                                                                value={value}
                                                            >
                                                                {t(
                                                                    `${I18N}.ends_values.${value}`
                                                                )}
                                                            </SelectItem>
                                                        )
                                                    )}
                                                </SelectGroup>
                                            </SelectContent>
                                        </Select>
                                    </Field>
                                ) : null}
                                {form.repeat !== 'none' &&
                                form.repeatEnd === 'afterOccurrences' ? (
                                    <Field>
                                        <FieldLabel htmlFor="group-event-occurrences">
                                            {t(`${I18N}.occurrence_count`)}
                                        </FieldLabel>
                                        <Input
                                            id="group-event-occurrences"
                                            type="number"
                                            min={1}
                                            value={form.occurrenceCount}
                                            disabled={saving}
                                            onChange={(event) =>
                                                update({
                                                    occurrenceCount:
                                                        minuteValue(
                                                            event.target.value
                                                        )
                                                })
                                            }
                                        />
                                    </Field>
                                ) : null}
                                {form.repeat !== 'none' &&
                                form.repeatEnd === 'afterDate' ? (
                                    <Field>
                                        <FieldLabel htmlFor="group-event-repeat-end">
                                            {t(`${I18N}.end_date`)}
                                        </FieldLabel>
                                        <Input
                                            id="group-event-repeat-end"
                                            type="datetime-local"
                                            value={form.repeatEndDate}
                                            disabled={saving}
                                            onChange={(event) =>
                                                update({
                                                    repeatEndDate:
                                                        event.target.value
                                                })
                                            }
                                        />
                                    </Field>
                                ) : null}
                            </div>
                        ) : null}
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Field>
                                <FieldLabel>
                                    {t(`${I18N}.access_type`)}
                                </FieldLabel>
                                <ToggleGroup
                                    variant="outline"
                                    size="sm"
                                    value={[form.accessType]}
                                    disabled={saving || isPrivateGroup}
                                    onValueChange={(value) => {
                                        const accessType = value[0];
                                        if (
                                            accessType === 'group' ||
                                            accessType === 'public'
                                        ) {
                                            update({ accessType });
                                        }
                                    }}
                                >
                                    <ToggleGroupItem value="group">
                                        {t(`${I18N}.access_group`)}
                                    </ToggleGroupItem>
                                    <ToggleGroupSeparator />
                                    <ToggleGroupItem value="public">
                                        {t(`${I18N}.access_public`)}
                                    </ToggleGroupItem>
                                </ToggleGroup>
                            </Field>
                            <Field>
                                <FieldLabel>{t(`${I18N}.category`)}</FieldLabel>
                                <Select
                                    value={form.category}
                                    disabled={saving}
                                    items={GROUP_EVENT_CATEGORIES.map(
                                        (value) => ({
                                            value,
                                            label: t(
                                                `${I18N}.categories.${value}`
                                            )
                                        })
                                    )}
                                    onValueChange={(value) => {
                                        if (value) {
                                            update({ category: value });
                                        }
                                    }}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {GROUP_EVENT_CATEGORIES.map(
                                                (value) => (
                                                    <SelectItem
                                                        key={value}
                                                        value={value}
                                                    >
                                                        {t(
                                                            `${I18N}.categories.${value}`
                                                        )}
                                                    </SelectItem>
                                                )
                                            )}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </Field>
                        </div>
                        <Field>
                            <FieldLabel htmlFor="group-event-tags">
                                {t(`${I18N}.tags`)}
                            </FieldLabel>
                            <Input
                                id="group-event-tags"
                                value={form.tags}
                                disabled={saving}
                                onChange={(event) =>
                                    update({ tags: event.target.value })
                                }
                            />
                            <FieldDescription>
                                {t(`${I18N}.tags_help`)}
                            </FieldDescription>
                        </Field>
                        <ProfileLanguagesField
                            languageRows={languageSelection.languageRows}
                            availableLanguageOptions={
                                languageSelection.availableLanguageOptions
                            }
                            languageOptionsStatus={
                                languageSelection.languageOptionsStatus
                            }
                            busy={saving}
                            onChange={(languages) => update({ languages })}
                        />
                        <Field>
                            <FieldLabel>{t(`${I18N}.platforms`)}</FieldLabel>
                            <div className="flex flex-wrap gap-4">
                                {GROUP_EVENT_PLATFORMS.map((platform) => (
                                    <Field
                                        key={platform}
                                        orientation="horizontal"
                                        className="w-auto"
                                        data-disabled={saving}
                                    >
                                        <Checkbox
                                            id={`group-event-platform-${platform}`}
                                            checked={form.platforms.includes(
                                                platform
                                            )}
                                            disabled={saving}
                                            onCheckedChange={(checked) =>
                                                update({
                                                    platforms: toggleValue(
                                                        form.platforms,
                                                        platform,
                                                        checked === true
                                                    )
                                                })
                                            }
                                        />
                                        <FieldLabel
                                            htmlFor={`group-event-platform-${platform}`}
                                        >
                                            {t(
                                                `${I18N}.platform_values.${platform}`
                                            )}
                                        </FieldLabel>
                                    </Field>
                                ))}
                            </div>
                        </Field>
                        {roles.length ? (
                            <Field>
                                <FieldLabel>{t(`${I18N}.roles`)}</FieldLabel>
                                <FieldDescription>
                                    {t(`${I18N}.roles_help`)}
                                </FieldDescription>
                                <FieldGroup
                                    data-slot="checkbox-group"
                                    className="grid max-h-48 gap-2 overflow-auto rounded-md border p-2 sm:grid-cols-2"
                                >
                                    {roles.map((role) =>
                                        role.id ? (
                                            <Field
                                                key={role.id}
                                                orientation="horizontal"
                                                data-disabled={saving}
                                            >
                                                <Checkbox
                                                    id={`group-event-role-${role.id}`}
                                                    checked={form.roleIds.includes(
                                                        role.id
                                                    )}
                                                    disabled={saving}
                                                    onCheckedChange={(
                                                        checked
                                                    ) =>
                                                        update({
                                                            roleIds:
                                                                toggleValue(
                                                                    form.roleIds,
                                                                    role.id ??
                                                                        '',
                                                                    checked ===
                                                                        true
                                                                )
                                                        })
                                                    }
                                                />
                                                <FieldLabel
                                                    htmlFor={`group-event-role-${role.id}`}
                                                    className="min-w-0 truncate"
                                                >
                                                    {role.name || role.id}
                                                </FieldLabel>
                                            </Field>
                                        ) : null
                                    )}
                                </FieldGroup>
                            </Field>
                        ) : null}
                        <GroupGalleryImageField
                            id="group-event-image-id"
                            open={open}
                            imageId={form.imageId}
                            disabled={saving}
                            onChange={(imageId) => update({ imageId })}
                        />
                        <div className="grid gap-4 sm:grid-cols-3">
                            {(
                                [
                                    ['hostEarlyJoinMinutes', 'host_early_join'],
                                    [
                                        'guestEarlyJoinMinutes',
                                        'guest_early_join'
                                    ],
                                    [
                                        'closeInstanceAfterEndMinutes',
                                        'close_after_end'
                                    ]
                                ] as const
                            ).map(([key, labelKey]) => (
                                <Field
                                    key={key}
                                    data-invalid={
                                        errors.has('minutes') || undefined
                                    }
                                >
                                    <FieldLabel htmlFor={`group-event-${key}`}>
                                        {t(`${I18N}.${labelKey}`)}
                                    </FieldLabel>
                                    <Input
                                        id={`group-event-${key}`}
                                        type="number"
                                        min={0}
                                        max={GROUP_EVENT_MINUTES_MAX}
                                        step={1}
                                        value={form[key]}
                                        disabled={saving || isEdit}
                                        onChange={(event) =>
                                            update({
                                                [key]: minuteValue(
                                                    event.target.value
                                                )
                                            })
                                        }
                                    />
                                </Field>
                            ))}
                        </div>
                        {!isEdit ? (
                            <Field
                                orientation="horizontal"
                                data-disabled={saving}
                            >
                                <Checkbox
                                    id="group-event-send-notification"
                                    checked={form.sendCreationNotification}
                                    disabled={saving}
                                    onCheckedChange={(checked) =>
                                        update({
                                            sendCreationNotification:
                                                checked === true
                                        })
                                    }
                                />
                                <FieldLabel htmlFor="group-event-send-notification">
                                    {t(`${I18N}.send_notification`)}
                                </FieldLabel>
                            </Field>
                        ) : null}
                    </FieldGroup>
                </ScrollArea>
                <DialogFooter>
                    {isEdit ? (
                        <Button
                            type="button"
                            variant="destructive"
                            className="sm:mr-auto"
                            disabled={saving}
                            onClick={onDelete}
                        >
                            <Trash2Icon data-icon="inline-start" />
                            {t(`${I18N}.delete`)}
                        </Button>
                    ) : null}
                    <Button
                        type="button"
                        variant="outline"
                        disabled={saving}
                        onClick={() => onOpenChange(false)}
                    >
                        {t('common.actions.cancel')}
                    </Button>
                    <Button
                        type="button"
                        disabled={saving || errors.size > 0}
                        onClick={() => onSubmit(form)}
                    >
                        {t(isEdit ? `${I18N}.save` : `${I18N}.create`)}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
