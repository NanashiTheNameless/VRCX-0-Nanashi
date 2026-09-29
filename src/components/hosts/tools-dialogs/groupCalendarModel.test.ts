import { format, startOfDay, startOfMonth } from 'date-fns';
import { enUS } from 'react-day-picker/locale/en-US';
import { ja } from 'react-day-picker/locale/ja';
import { zhCN } from 'react-day-picker/locale/zh-CN';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    buildEventsByDate,
    buildFollowedCountByDate,
    calendarDateKey,
    calendarLocaleForLanguage,
    dateKeyToLocalDate,
    monthDateFromKey
} from './groupCalendarModel';

describe('groupCalendarModel date helpers', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-22T05:00:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('resolves date keys in the requested calendar time zone', () => {
        const instant = new Date('2026-01-01T01:30:00.000Z');

        expect(calendarDateKey(instant, 'Asia/Tokyo')).toBe('2026-01-01');
        expect(calendarDateKey(instant, 'America/New_York')).toBe('2025-12-31');
    });

    it('falls back to local date key when the time zone is invalid', () => {
        const instant = new Date('2026-01-01T01:30:00.000Z');

        // Invalid zone: no throw, falls back to machine-local formatting.
        expect(calendarDateKey(instant, 'Invalid/Zone')).toBe(
            format(instant, 'yyyy-MM-dd')
        );
        // Contrast: a valid faraway zone genuinely shifts the day, proving the
        // fallback above is not just returning a zone-resolved value.
        expect(calendarDateKey(instant, 'America/New_York')).toBe('2025-12-31');
    });

    it('parses strict date keys and falls back to today for invalid input', () => {
        // Derive the expected fallback the same way the implementation does so
        // the assertion stays correct regardless of the runner's time zone.
        const todayKey = format(startOfDay(new Date()), 'yyyy-MM-dd');

        expect(format(dateKeyToLocalDate('2026-02-03'), 'yyyy-MM-dd')).toBe(
            '2026-02-03'
        );
        expect(format(dateKeyToLocalDate('2026-02-30'), 'yyyy-MM-dd')).toBe(
            todayKey
        );
        expect(format(dateKeyToLocalDate('2026/02/03'), 'yyyy-MM-dd')).toBe(
            todayKey
        );
    });

    it('resolves month start dates from date keys', () => {
        const monthKey = format(startOfMonth(new Date()), 'yyyy-MM-dd');

        expect(format(monthDateFromKey('2026-02-18'), 'yyyy-MM-dd')).toBe(
            '2026-02-01'
        );
        expect(format(monthDateFromKey('bad-date'), 'yyyy-MM-dd')).toBe(
            monthKey
        );
    });

    it('maps app languages to calendar locales', () => {
        expect(calendarLocaleForLanguage('zh_CN')).toBe(zhCN);
        expect(calendarLocaleForLanguage('ja')).toBe(ja);
        expect(calendarLocaleForLanguage('ko')).toBe(enUS);
        expect(calendarLocaleForLanguage('')).toBe(enUS);
    });
});

describe('groupCalendarModel event grouping', () => {
    it('groups events by requested time zone date key and sorts by start time', () => {
        const lateTokyo = {
            id: 'evt_late_tokyo',
            startsAt: '2026-01-01T03:00:00.000Z'
        };
        const earlyTokyo = {
            id: 'evt_early_tokyo',
            startsAt: '2026-01-01T01:30:00.000Z'
        };
        const previousTokyo = {
            id: 'evt_previous_tokyo',
            startsAt: '2025-12-31T14:00:00.000Z'
        };

        expect(
            buildEventsByDate(
                [lateTokyo, earlyTokyo, previousTokyo],
                'Asia/Tokyo'
            )
        ).toEqual({
            '2025-12-31': [previousTokyo],
            '2026-01-01': [earlyTokyo, lateTokyo]
        });
        expect(buildEventsByDate([earlyTokyo], 'America/New_York')).toEqual({
            '2025-12-31': [earlyTokyo]
        });
    });

    it('counts followed events with the same time zone date key as event grouping', () => {
        const events = [
            {
                id: 'evt_followed_tokyo',
                startsAt: '2026-01-01T01:30:00.000Z'
            },
            {
                eventId: 'evt_followed_previous',
                startsAt: '2025-12-31T14:00:00.000Z'
            },
            {
                id: 'evt_unfollowed',
                startsAt: '2026-01-01T02:00:00.000Z'
            },
            {
                startsAt: '2026-01-01T03:00:00.000Z'
            }
        ];

        expect(
            buildFollowedCountByDate(
                events,
                ['evt_followed_tokyo', 'evt_followed_previous'],
                'Asia/Tokyo'
            )
        ).toEqual({
            '2025-12-31': 1,
            '2026-01-01': 1
        });
        expect(
            buildFollowedCountByDate(
                events,
                ['evt_followed_tokyo'],
                'America/New_York'
            )
        ).toEqual({
            '2025-12-31': 1
        });
    });
});
