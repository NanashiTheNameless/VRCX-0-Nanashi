import { afterEach, describe, expect, it } from 'vitest';

import type {
    ActivityPageAccessSlice,
    ActivityPageView
} from '@/platform/tauri/bindings';
import {
    setDisplayTimeZone,
    displayOffsetMinutesAt
} from '@/shared/utils/displayTimeZone';

import {
    accessShare,
    averageMinutesPerDay,
    canPageBack,
    customWindow,
    localDateRange,
    nextWindow,
    normalizeActivityRange,
    normalizeHeatmapBuckets,
    parseLocalDate,
    peakHour,
    periodDirection,
    previousWindow,
    rangeDaysFor,
    visibleAccessSlices,
    windowDateRange,
    windowEndsNow
} from './activityPageModel';

const DAY_MS = 86_400_000;
const TODAY_END_MS = Date.UTC(2025, 0, 31);

function pageView(overrides: Partial<ActivityPageView>): ActivityPageView {
    return {
        rangeDays: 30,
        utcOffsetMinutes: 0,
        windowFrom: (TODAY_END_MS - 30 * DAY_MS) / 1000,
        windowTo: TODAY_END_MS / 1000,
        summary: {
            totalMinutes: 0,
            windowDays: 30,
            activeDays: 0,
            sessionCount: 0,
            longestSessionMinutes: 0
        },
        previous: { totalMinutes: 0, activeDays: 0, hasData: false },
        series: { bucket: 'day', points: [] },
        accessSplit: [],
        worlds: {
            top: [],
            distinctCount: 0,
            newWorldMinutes: 0,
            returningWorldMinutes: 0
        },
        people: {
            order: 'minutes',
            companions: [],
            strangers: [],
            fading: [],
            encounteredCount: 0,
            newFaceCount: 0
        },
        coverage: {
            from: 0,
            to: 0,
            firstSourceAt: Date.UTC(2024, 5, 1) / 1000
        },
        builtFromCursor: '',
        builtAt: 0,
        stale: false,
        ...overrides
    };
}

describe('activityPageModel', () => {
    it('falls back to 30 days for unknown or dropped ranges', () => {
        expect(normalizeActivityRange(null)).toBe('30');
        expect(normalizeActivityRange('7')).toBe('30');
        expect(normalizeActivityRange('180')).toBe('180');
        expect(normalizeActivityRange('all')).toBe('all');
    });

    it('sends 0 days for the all-time range', () => {
        expect(rangeDaysFor('all')).toBe(0);
        expect(rangeDaysFor('365')).toBe(365);
    });

    it('averages total minutes over the window, not over active days', () => {
        expect(
            averageMinutesPerDay({
                totalMinutes: 600,
                windowDays: 30,
                activeDays: 10,
                sessionCount: 12,
                longestSessionMinutes: 120
            })
        ).toBe(20);
    });

    it('keeps access shares at zero when nothing was recorded', () => {
        expect(accessShare(0, 0)).toBe(0);
        expect(accessShare(30, 120)).toBe(25);
    });

    it('finds the busiest hour across the whole week', () => {
        const buckets = Array.from({ length: 168 }, () => 0);
        buckets[3] = 10;
        buckets[24 + 3] = 20;
        buckets[24 + 15] = 25;

        expect(peakHour(buckets)).toBe(3);
    });

    it('has no busiest hour before any buckets arrive', () => {
        expect(peakHour([])).toBeNull();
    });

    it('drops access slices that round down to zero percent', () => {
        const slices: ActivityPageAccessSlice[] = [
            { access: 'friends', minutes: 600 },
            { access: 'public', minutes: 2 }
        ];

        expect(
            visibleAccessSlices(slices).map((slice) => slice.access)
        ).toEqual(['friends']);
    });

    it('spreads heatmap colours by rank so a tight cluster still shows contrast', () => {
        const normalized = normalizeHeatmapBuckets([0, 1, 2, 3, 400]);

        expect(normalized).toEqual([0, 0.25, 0.5, 0.75, 1]);
    });

    it('keeps every heatmap bucket at zero when nothing was recorded', () => {
        expect(normalizeHeatmapBuckets([0, 0, 0])).toEqual([0, 0, 0]);
    });

    it('pages back by one window length from the shown window start', () => {
        const view = pageView({});

        expect(previousWindow(view, null)).toEqual({
            rangeDays: 30,
            windowToMs: TODAY_END_MS - 30 * DAY_MS,
            custom: false
        });
    });

    it('returns to the live preset once paging forward reaches today', () => {
        const nowMs = TODAY_END_MS - 3_600_000;
        const pagedBack = pageView({
            windowFrom: (TODAY_END_MS - 60 * DAY_MS) / 1000,
            windowTo: (TODAY_END_MS - 30 * DAY_MS) / 1000
        });
        const pagedTwice = pageView({
            windowFrom: (TODAY_END_MS - 90 * DAY_MS) / 1000,
            windowTo: (TODAY_END_MS - 60 * DAY_MS) / 1000
        });
        const override = {
            rangeDays: 30,
            windowToMs: TODAY_END_MS - 30 * DAY_MS,
            custom: false
        };

        expect(nextWindow(pagedBack, override, nowMs)).toBeNull();
        expect(nextWindow(pagedTwice, override, nowMs)).toEqual({
            rangeDays: 30,
            windowToMs: TODAY_END_MS - 30 * DAY_MS,
            custom: false
        });
    });

    it('keeps a custom window custom when paging forward reaches today', () => {
        const nowMs = TODAY_END_MS - 3_600_000;
        const view = pageView({
            rangeDays: 10,
            windowFrom: (TODAY_END_MS - 15 * DAY_MS) / 1000,
            windowTo: (TODAY_END_MS - 5 * DAY_MS) / 1000
        });

        expect(
            nextWindow(
                view,
                {
                    rangeDays: 10,
                    windowToMs: view.windowTo * 1000,
                    custom: true
                },
                nowMs
            )
        ).toEqual({ rangeDays: 10, windowToMs: TODAY_END_MS, custom: true });
    });

    it('knows when the shown window already ends today', () => {
        const nowMs = TODAY_END_MS - 3_600_000;

        expect(windowEndsNow(pageView({}), nowMs)).toBe(true);
        expect(
            windowEndsNow(
                pageView({ windowTo: (TODAY_END_MS - DAY_MS) / 1000 }),
                nowMs
            )
        ).toBe(false);
    });

    it('stops paging back once the window starts before the first record', () => {
        expect(canPageBack(pageView({}))).toBe(true);
        expect(
            canPageBack(
                pageView({
                    coverage: {
                        from: 0,
                        to: 0,
                        firstSourceAt: Date.UTC(2025, 0, 15) / 1000
                    }
                })
            )
        ).toBe(false);
        expect(canPageBack(pageView({ rangeDays: 0, windowFrom: 0 }))).toBe(
            false
        );
    });

    it('turns a picked date range into an inclusive window ending after the last day', () => {
        const window = customWindow(
            parseLocalDate('2025-01-10'),
            parseLocalDate('2025-01-01'),
            540
        );

        expect(window).toEqual({
            rangeDays: 10,
            windowToMs: Date.UTC(2025, 0, 11) - 540 * 60_000,
            custom: true
        });
        expect(windowDateRange(window, 540)).toEqual(
            localDateRange('2025-01-01', '2025-01-10')
        );
    });

    it('covers whole local days when a bar opens the journey', () => {
        const range = localDateRange('2025-01-06', '2025-01-12');

        expect(range.from).toEqual(new Date(2025, 0, 6));
        expect(range.to).toEqual(new Date(2025, 0, 12, 23, 59, 59, 999));
    });

    it('describes the change from the previous period without judging it', () => {
        expect(periodDirection(120, 60)).toBe('more');
        expect(periodDirection(60, 120)).toBe('less');
        expect(periodDirection(60, 60)).toBe('same');
    });
});

describe('activity window display timezone', () => {
    afterEach(() => setDisplayTimeZone(''));

    it('keeps picked dates and forward paging on calendar midnights across DST', () => {
        setDisplayTimeZone('America/Chicago');
        const picked = customWindow(
            parseLocalDate('2025-03-08'),
            parseLocalDate('2025-03-09'),
            displayOffsetMinutesAt()
        );
        expect(picked).toEqual({
            rangeDays: 2,
            windowToMs: Date.parse('2025-03-10T05:00:00Z'),
            custom: true
        });
        expect(windowDateRange(picked, displayOffsetMinutesAt())).toEqual(
            localDateRange('2025-03-08', '2025-03-09')
        );
        const view = pageView({
            rangeDays: 2,
            utcOffsetMinutes: displayOffsetMinutesAt(),
            windowFrom: Date.parse('2025-03-06T06:00:00Z') / 1000,
            windowTo: Date.parse('2025-03-08T06:00:00Z') / 1000
        });
        expect(
            nextWindow(view, picked, Date.parse('2025-03-12T12:00:00Z'))
        ).toEqual(picked);
    });

    it('keeps both days of a fall-back weekend in the custom window', () => {
        setDisplayTimeZone('America/Chicago');
        const picked = customWindow(
            parseLocalDate('2025-11-01'),
            parseLocalDate('2025-11-02'),
            displayOffsetMinutesAt()
        );
        expect(picked.windowToMs).toBe(Date.parse('2025-11-03T06:00:00Z'));
        expect(windowDateRange(picked, displayOffsetMinutesAt())).toEqual(
            localDateRange('2025-11-01', '2025-11-02')
        );
    });
});
