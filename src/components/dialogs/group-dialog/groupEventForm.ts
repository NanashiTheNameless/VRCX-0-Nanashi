import type {
    GroupCalendarEventAccessType,
    GroupCalendarEventMutation,
    GroupCalendarRecurrence,
    GroupCalendarRecurrenceFrequency
} from '@/platform/tauri/bindings';
import type { GroupCalendarEventRecord } from '@/repositories/vrchatToolsRepository';
import { isRecord } from '@/shared/utils/record';

export const GROUP_EVENT_CATEGORIES = [
    'arts',
    'avatars',
    'dance',
    'education',
    'exploration',
    'film_media',
    'gaming',
    'hangout',
    'music',
    'other',
    'performance',
    'roleplaying',
    'wellness'
] as const;

export const GROUP_EVENT_PLATFORMS = [
    'standalonewindows',
    'android',
    'ios'
] as const;

export const GROUP_EVENT_WEEKDAYS = [
    'MO',
    'TU',
    'WE',
    'TH',
    'FR',
    'SA',
    'SU'
] as const;

export const GROUP_EVENT_TITLE_MAX = 64;
export const GROUP_EVENT_DESCRIPTION_MAX = 1024;
export const GROUP_EVENT_TAG_LIMIT = 5;
export const GROUP_EVENT_LANGUAGE_LIMIT = 3;
export const GROUP_EVENT_MINUTES_MAX = 60;

const WEEKDAYS: readonly string[] = ['MO', 'TU', 'WE', 'TH', 'FR'];
const WEEKEND: readonly string[] = ['SA', 'SU'];

export type GroupEventRepeat = 'none' | GroupCalendarRecurrenceFrequency;
export type GroupEventWeeklyPattern =
    | 'every_week'
    | 'weekdays'
    | 'weekend'
    | 'custom';
export type GroupEventRepeatEnd = 'never' | 'afterOccurrences' | 'afterDate';

export type GroupEventForm = {
    mode: 'create' | 'edit';
    eventId: string;
    isSeriesOccurrence: boolean;
    hadRecurrence: boolean;
    title: string;
    description: string;
    startsAt: string;
    endsAt: string;
    accessType: GroupCalendarEventAccessType;
    category: string;
    tags: string;
    languages: string[];
    platforms: string[];
    roleIds: string[];
    imageId: string;
    sendCreationNotification: boolean;
    hostEarlyJoinMinutes: number;
    guestEarlyJoinMinutes: number;
    closeInstanceAfterEndMinutes: number;
    repeat: GroupEventRepeat;
    interval: number;
    weeklyPattern: GroupEventWeeklyPattern;
    customDays: string[];
    repeatEnd: GroupEventRepeatEnd;
    occurrenceCount: number;
    repeatEndDate: string;
};

export type GroupEventFormError =
    | 'title'
    | 'description'
    | 'dates'
    | 'date_range'
    | 'start_in_past'
    | 'minutes';

function pad(value: number) {
    return String(value).padStart(2, '0');
}

export function toLocalDateTimeInput(value: string | number | Date) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localInputMs(value: string) {
    return value ? new Date(value).getTime() : NaN;
}

function stringList(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter(
              (item): item is string =>
                  typeof item === 'string' && Boolean(item.trim())
          )
        : [];
}

function minutes(value: unknown, fallback: number) {
    return typeof value === 'number' && Number.isFinite(value)
        ? value
        : fallback;
}

function weeklyPatternFor(days: string[]): GroupEventWeeklyPattern {
    const sorted = [...days].sort().join(',');
    if (!days.length) {
        return 'every_week';
    }
    if (sorted === [...WEEKDAYS].sort().join(',')) {
        return 'weekdays';
    }
    if (sorted === [...WEEKEND].sort().join(',')) {
        return 'weekend';
    }
    return 'custom';
}

function isFrequency(
    value: unknown
): value is GroupCalendarRecurrenceFrequency {
    return value === 'weekly' || value === 'monthly' || value === 'yearly';
}

export function createGroupEventForm(nowMs = Date.now()): GroupEventForm {
    const start = new Date(nowMs);
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() + 1);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    return {
        mode: 'create',
        eventId: '',
        isSeriesOccurrence: false,
        hadRecurrence: false,
        title: '',
        description: '',
        startsAt: toLocalDateTimeInput(start),
        endsAt: toLocalDateTimeInput(end),
        accessType: 'group',
        category: 'other',
        tags: '',
        languages: [],
        platforms: [],
        roleIds: [],
        imageId: '',
        sendCreationNotification: false,
        hostEarlyJoinMinutes: 60,
        guestEarlyJoinMinutes: 5,
        closeInstanceAfterEndMinutes: 5,
        repeat: 'none',
        interval: 1,
        weeklyPattern: 'every_week',
        customDays: ['SA'],
        repeatEnd: 'never',
        occurrenceCount: 1,
        repeatEndDate: ''
    };
}

export function groupEventFormFromEvent(
    event: GroupCalendarEventRecord
): GroupEventForm {
    const base = createGroupEventForm();
    const recurrence = isRecord(event.recurrence) ? event.recurrence : null;
    const frequency = isFrequency(recurrence?.frequency)
        ? recurrence.frequency
        : null;
    const end = isRecord(recurrence?.end) ? recurrence.end : null;
    const days = stringList(recurrence?.daysOfWeek);
    return {
        ...base,
        mode: 'edit',
        eventId: String(event.id || event.eventId || ''),
        isSeriesOccurrence: Boolean(event.seriesId),
        hadRecurrence: Boolean(frequency),
        title: event.title || '',
        description: event.description || '',
        startsAt: toLocalDateTimeInput(event.startsAt || ''),
        endsAt: toLocalDateTimeInput(event.endsAt || ''),
        accessType: event.accessType === 'public' ? 'public' : 'group',
        category: event.category || 'other',
        tags: stringList(event.tags).join(', '),
        languages: stringList(event.languages),
        platforms: stringList(event.platforms),
        roleIds: stringList(event.roleIds),
        imageId: event.imageId || '',
        hostEarlyJoinMinutes: minutes(
            event.hostEarlyJoinMinutes,
            base.hostEarlyJoinMinutes
        ),
        guestEarlyJoinMinutes: minutes(
            event.guestEarlyJoinMinutes,
            base.guestEarlyJoinMinutes
        ),
        closeInstanceAfterEndMinutes: minutes(
            event.closeInstanceAfterEndMinutes,
            base.closeInstanceAfterEndMinutes
        ),
        repeat: frequency ?? 'none',
        interval:
            typeof recurrence?.interval === 'number' && recurrence.interval > 0
                ? recurrence.interval
                : 1,
        weeklyPattern: weeklyPatternFor(days),
        customDays: days.length ? days : base.customDays,
        repeatEnd:
            end?.type === 'afterOccurrences' || end?.type === 'afterDate'
                ? end.type
                : 'never',
        occurrenceCount:
            typeof end?.count === 'number' && end.count > 0 ? end.count : 1,
        repeatEndDate:
            typeof end?.date === 'string' ? toLocalDateTimeInput(end.date) : ''
    };
}

export function groupEventFormErrors(
    form: GroupEventForm,
    nowMs = Date.now()
): GroupEventFormError[] {
    const errors: GroupEventFormError[] = [];
    if (!form.title.trim()) {
        errors.push('title');
    }
    if (!form.description.trim()) {
        errors.push('description');
    }
    const startMs = localInputMs(form.startsAt);
    const endMs = localInputMs(form.endsAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        errors.push('dates');
    } else {
        if (endMs <= startMs) {
            errors.push('date_range');
        }
        if (form.mode === 'create' && startMs <= nowMs) {
            errors.push('start_in_past');
        }
    }
    const minuteValues = [
        form.hostEarlyJoinMinutes,
        form.guestEarlyJoinMinutes,
        form.closeInstanceAfterEndMinutes
    ];
    if (
        minuteValues.some(
            (value) =>
                !Number.isInteger(value) ||
                value < 0 ||
                value > GROUP_EVENT_MINUTES_MAX
        )
    ) {
        errors.push('minutes');
    }
    return errors;
}

export function groupEventTags(value: string) {
    return value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, GROUP_EVENT_TAG_LIMIT);
}

function groupEventDays(form: GroupEventForm) {
    switch (form.weeklyPattern) {
        case 'weekdays':
            return [...WEEKDAYS];
        case 'weekend':
            return [...WEEKEND];
        case 'custom':
            return form.customDays;
        default:
            return [];
    }
}

function groupEventRecurrence(
    form: GroupEventForm,
    timezone: string
): GroupCalendarRecurrence | null {
    if (form.isSeriesOccurrence || form.repeat === 'none') {
        return null;
    }
    return {
        frequency: form.repeat,
        interval: Math.max(1, Math.trunc(form.interval) || 1),
        timezone,
        daysOfWeek: form.repeat === 'weekly' ? groupEventDays(form) : [],
        end:
            form.repeatEnd === 'afterOccurrences'
                ? {
                      type: 'afterOccurrences',
                      count: Math.max(1, Math.trunc(form.occurrenceCount) || 1)
                  }
                : form.repeatEnd === 'afterDate' && form.repeatEndDate
                  ? { type: 'afterDate', date: form.repeatEndDate }
                  : null
    };
}

export function groupEventMutation(
    form: GroupEventForm,
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
): GroupCalendarEventMutation {
    return {
        title: form.title.trim(),
        description: form.description.trim(),
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
        category: form.category,
        accessType: form.accessType,
        tags: groupEventTags(form.tags),
        languages: form.languages.slice(0, GROUP_EVENT_LANGUAGE_LIMIT),
        platforms: form.platforms,
        roleIds: form.roleIds,
        imageId: form.imageId || null,
        sendCreationNotification:
            form.mode === 'create' && form.sendCreationNotification,
        hostEarlyJoinMinutes: form.hostEarlyJoinMinutes,
        guestEarlyJoinMinutes: form.guestEarlyJoinMinutes,
        closeInstanceAfterEndMinutes: form.closeInstanceAfterEndMinutes,
        recurrence: groupEventRecurrence(form, timezone)
    };
}
