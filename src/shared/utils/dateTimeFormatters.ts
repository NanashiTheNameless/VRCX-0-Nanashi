import {
    absoluteDateFromValue,
    displayDateFormatInput,
    displayDateParts
} from './displayTimeZone';
export type DateTimeFormatterOptions = {
    locale?: string | null;
    fallback?: string;
    hour12?: boolean;
};

export type TimeZoneDateParts = {
    year: string;
    month: string;
    day: string;
};

const dateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();
const relativeTimeFormatterCache = new Map<string, Intl.RelativeTimeFormat>();

export function getDateTimeFormatter(
    locale: string,
    options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
    const key = JSON.stringify([locale, options]);
    const cached = dateTimeFormatterCache.get(key);
    if (cached) {
        return cached;
    }

    const formatter = new Intl.DateTimeFormat(locale, options);
    dateTimeFormatterCache.set(key, formatter);
    return formatter;
}

export function getRelativeTimeFormatter(
    locale: string,
    options: Intl.RelativeTimeFormatOptions
): Intl.RelativeTimeFormat {
    const key = JSON.stringify([locale, options]);
    const cached = relativeTimeFormatterCache.get(key);
    if (cached) {
        return cached;
    }

    const formatter = new Intl.RelativeTimeFormat(locale, options);
    relativeTimeFormatterCache.set(key, formatter);
    return formatter;
}

export function normalizeDateLocale(
    locale: string | null | undefined,
    fallback = 'en-gb'
): string {
    if (!locale) {
        return fallback;
    }

    const dateLocale = locale.replace(/_/g, '-').trim();
    return dateLocale || fallback;
}

function toValidDate(value: unknown): Date | null {
    return absoluteDateFromValue(value);
}

function padDatePart(value: number): string {
    return String(value).padStart(2, '0');
}

export function formatIsoDateTime(value: unknown, fallback = '-'): string {
    const date = toValidDate(value);
    if (!date) {
        return fallback;
    }

    const parts = displayDateParts(date);
    return `${parts.year}-${padDatePart(parts.month)}-${padDatePart(parts.day)} ${padDatePart(parts.hour)}:${padDatePart(parts.minute)}:${padDatePart(parts.second)}`;
}

export function formatDateTimeValue(
    value: unknown,
    options: Intl.DateTimeFormatOptions,
    { locale, fallback = '-', hour12 }: DateTimeFormatterOptions = {}
): string {
    const date = toValidDate(value);
    if (!date) {
        return fallback;
    }

    const formatOptions = { ...options };
    if (typeof hour12 === 'boolean') {
        formatOptions.hour12 = hour12;
    }

    try {
        const input = displayDateFormatInput(date, formatOptions);
        return getDateTimeFormatter(
            normalizeDateLocale(locale),
            input.options
        ).format(input.date);
    } catch {
        return fallback;
    }
}

export function getTimeZoneDateParts(
    value: unknown,
    timeZone: unknown
): TimeZoneDateParts | null {
    const date = toValidDate(value || new Date());
    if (!date) {
        return null;
    }

    try {
        const parts = getDateTimeFormatter('en-US', {
            timeZone: String(timeZone || ''),
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(date);
        const values = Object.fromEntries(
            parts
                .filter((part) => part.type !== 'literal')
                .map((part) => [part.type, part.value])
        );
        if (values.year && values.month && values.day) {
            return {
                year: values.year,
                month: values.month,
                day: values.day
            };
        }
    } catch {
        return null;
    }

    return null;
}
