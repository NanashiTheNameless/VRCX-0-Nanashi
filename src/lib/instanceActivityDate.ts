import { formatDateTime } from '@/lib/dateTime';
import {
    absoluteDateFromValue,
    displayDateParts,
    displayLocalToEpoch
} from '@/shared/utils/displayTimeZone';

export function toLocalDayKey(value: Date | string | number) {
    const date = absoluteDateFromValue(value);
    if (!date) return '';
    const time = date.getTime();
    if (!Number.isFinite(time)) {
        return '';
    }
    const parts = displayDateParts(date);
    const year = parts.year;
    const month = String(parts.month).padStart(2, '0');
    const day = String(parts.day).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function parseLocalDayKey(dayKey: string) {
    const seconds = displayLocalToEpoch(dayKey);
    return new Date(seconds === null ? NaN : seconds * 1000);
}

export function formatDateLabel(dayKey: string) {
    const formatted = formatDateTime(
        parseLocalDayKey(dayKey),
        {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            weekday: 'short'
        },
        { fallback: dayKey }
    );
    return formatted || dayKey;
}
