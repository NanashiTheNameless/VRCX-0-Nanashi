import {
    displayDateParts,
    displayLocalToEpoch
} from '@/shared/utils/displayTimeZone';
export interface DateTimeRangeValue {
    from: Date | null;
    to: Date | null;
}

interface DraftDateRange {
    from?: Date | null;
    to?: Date | null;
}

function normalizeMinuteStep(step: number) {
    const value = Math.floor(step);
    return Number.isFinite(value) && value >= 1 && value <= 60 ? value : 1;
}

export function buildMinuteOptions(step: number) {
    const safeStep = normalizeMinuteStep(step);
    const options: string[] = [];
    for (let minute = 0; minute < 60; minute += safeStep) {
        options.push(String(minute).padStart(2, '0'));
    }
    return options;
}

export function snapMinuteDown(time: string, step: number) {
    const safeStep = normalizeMinuteStep(step);
    const [hours = '00', minutes = '00'] = time.split(':');
    const minute = Number.parseInt(minutes, 10) || 0;
    const snapped = Math.floor(minute / safeStep) * safeStep;
    return `${hours}:${String(snapped).padStart(2, '0')}`;
}

export function slotEndTime(time: string, step: number) {
    const safeStep = normalizeMinuteStep(step);
    const [hours = '00', minutes = '00'] = snapMinuteDown(time, safeStep).split(
        ':'
    );
    const minute = Number.parseInt(minutes, 10) || 0;
    const end = Math.min(59, minute + safeStep - 1);
    return `${hours}:${String(end).padStart(2, '0')}`;
}

export function toTimeValue(date: Date | null | undefined, fallback: string) {
    if (!date) {
        return fallback;
    }
    const parts = displayDateParts(date);
    const hours = String(parts.hour).padStart(2, '0');
    const minutes = String(parts.minute).padStart(2, '0');
    return `${hours}:${minutes}`;
}

export function stripTime(date: Date) {
    const parts = displayDateParts(date);
    return new Date(parts.year, parts.month - 1, parts.day);
}

export function combineDateTime(
    date: Date,
    time: string,
    endOfMinute: boolean
) {
    const [rawHours, rawMinutes] = time.split(':');
    const hours = Number.parseInt(rawHours, 10);
    const minutes = Number.parseInt(rawMinutes, 10);
    const pad = (value: number) => String(value).padStart(2, '0');
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const local = `${day}T${pad(Number.isFinite(hours) ? hours : 0)}:${pad(Number.isFinite(minutes) ? minutes : 0)}:${endOfMinute ? '59' : '00'}`;
    const seconds = displayLocalToEpoch(local);
    return new Date(
        seconds === null ? NaN : seconds * 1000 + (endOfMinute ? 999 : 0)
    );
}

export function buildDateTimeRange(
    draftRange: DraftDateRange | null | undefined,
    startTime: string,
    endTime: string
): DateTimeRangeValue {
    if (!draftRange?.from) {
        return { from: null, to: null };
    }
    return {
        from: combineDateTime(draftRange.from, startTime, false),
        to: combineDateTime(draftRange.to || draftRange.from, endTime, true)
    };
}
