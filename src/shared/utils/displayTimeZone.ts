let displayTimeZone = '';
let partsFormatter: Intl.DateTimeFormat | null = null;

export function getDisplayTimeZone(): string {
    return !displayTimeZone || displayTimeZone.toLowerCase() === 'system'
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : displayTimeZone;
}

export function fixedTimeZoneOffset(value: string): number | null {
    const text = value.trim().toUpperCase();
    if (text === 'UTC' || text === 'GMT') return 0;
    const match = /^(?:UTC|GMT)?([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(text);
    if (!match) return null;
    const hours = Number(match[2]);
    const minutes = Number(match[3] ?? 0);
    if (minutes >= 60 || hours > 23) return null;
    return (match[1] === '-' ? -1 : 1) * (hours * 3600 + minutes * 60);
}

export function isValidDisplayTimeZone(value: string): boolean {
    const zone = value.trim();
    if (
        !zone ||
        zone.toLowerCase() === 'system' ||
        fixedTimeZoneOffset(zone) !== null
    )
        return true;
    try {
        new Intl.DateTimeFormat('en', { timeZone: zone });
        return true;
    } catch {
        return false;
    }
}

export function setDisplayTimeZone(value: string): void {
    displayTimeZone = isValidDisplayTimeZone(value) ? value.trim() : '';
    partsFormatter = null;
}

export function displayDateFormatInput(
    date: Date,
    options: Intl.DateTimeFormatOptions = {}
) {
    if (
        options.timeZone !== undefined ||
        !displayTimeZone ||
        displayTimeZone.toLowerCase() === 'system'
    ) {
        return { date, options };
    }
    const offset = fixedTimeZoneOffset(displayTimeZone);
    return offset === null
        ? { date, options: { ...options, timeZone: displayTimeZone } }
        : {
              date: new Date(date.getTime() + offset * 1000),
              options: { ...options, timeZone: 'UTC' }
          };
}

export function displayDateParts(date: Date) {
    const input = displayDateFormatInput(date);
    partsFormatter ??= new Intl.DateTimeFormat('en-GB', {
        ...input.options,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    });
    const parts = partsFormatter.formatToParts(input.date);
    const get = (name: Intl.DateTimeFormatPartTypes) =>
        Number(parts.find((part) => part.type === name)?.value);
    return {
        year: get('year'),
        month: get('month'),
        day: get('day'),
        hour: get('hour'),
        minute: get('minute'),
        second: get('second')
    };
}

export function absoluteDateFromValue(value: unknown): Date | null {
    if (value === null || value === undefined || value === '') return null;
    let date: Date;
    if (value instanceof Date) date = value;
    else if (typeof value === 'number')
        date = new Date(
            Math.abs(value) < 100_000_000_000 ? value * 1000 : value
        );
    else if (typeof value === 'string') {
        date = /^-?\d+$/.test(value.trim())
            ? new Date(
                  Math.abs(Number(value)) < 100_000_000_000
                      ? Number(value) * 1000
                      : Number(value)
              )
            : new Date(value);
    } else return null;
    return Number.isNaN(date.getTime()) ? null : date;
}

export function parseAbsoluteDateMs(value: unknown): number {
    return absoluteDateFromValue(value)?.getTime() ?? Number.NaN;
}

export function epochSecondsFromValue(value: unknown): number | null {
    const milliseconds = parseAbsoluteDateMs(value);
    return Number.isFinite(milliseconds)
        ? Math.floor(milliseconds / 1000)
        : null;
}

export function displayLocalToEpoch(value: string): number | null {
    const match =
        /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(
            value.trim()
        );
    if (!match) return null;
    const [year, month, day, hour, minute, second] = match
        .slice(1)
        .map((part) => Number(part ?? 0));
    const local = Date.UTC(year, month - 1, day, hour, minute, second);
    const check = new Date(local);
    if (
        check.getUTCFullYear() !== year ||
        check.getUTCMonth() !== month - 1 ||
        check.getUTCDate() !== day ||
        hour > 23 ||
        minute > 59 ||
        second > 59
    )
        return null;
    if (!displayTimeZone || displayTimeZone.toLowerCase() === 'system') {
        return Math.floor(
            new Date(year, month - 1, day, hour, minute, second).getTime() /
                1000
        );
    }
    const fixed = fixedTimeZoneOffset(displayTimeZone);
    if (fixed !== null) return local / 1000 - fixed;
    const offsets = new Set<number>();
    const wallMilliseconds = (date: Date) => {
        const p = displayDateParts(date);
        return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    };
    for (const shift of [-172800000, 0, 172800000]) {
        const candidate = local + shift;
        offsets.add(wallMilliseconds(new Date(candidate)) - candidate);
    }
    const candidates = [...offsets].map((offset) => local - offset);
    const exact = candidates.filter(
        (candidate) => wallMilliseconds(new Date(candidate)) === local
    );
    if (exact.length) return Math.min(...exact) / 1000;
    const afterGap = candidates.filter(
        (candidate) => wallMilliseconds(new Date(candidate)) > local
    );
    afterGap.sort(
        (a, b) => wallMilliseconds(new Date(a)) - wallMilliseconds(new Date(b))
    );
    return afterGap.length ? afterGap[0] / 1000 : null;
}

export function displayDateBoundary(
    value: string,
    boundary: 'start' | 'end'
): number | null {
    const text = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return epochSecondsFromValue(text);
    const start = displayLocalToEpoch(text);
    if (start === null || boundary === 'start') return start;
    const nextDay = new Date(`${text}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const end = displayLocalToEpoch(nextDay.toISOString().slice(0, 10));
    return end === null ? null : end - 1;
}

export function displayOffsetMinutesAt(milliseconds = Date.now()): number {
    const wholeSeconds = Math.floor(milliseconds / 1000) * 1000;
    const p = displayDateParts(new Date(wholeSeconds));
    return (
        (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) -
            wholeSeconds) /
        60000
    );
}

export function displayDayKey(value: unknown): string {
    const date = absoluteDateFromValue(value);
    if (!date) return '';
    const p = displayDateParts(date);
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
