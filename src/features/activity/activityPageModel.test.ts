import { describe, expect, it } from 'vitest';

import type { ActivityPageAccessSlice } from '@/platform/tauri/bindings';

import {
    accessShare,
    averageMinutesPerDay,
    normalizeActivityRange,
    normalizeHeatmapBuckets,
    peakHour,
    rangeDaysFor,
    visibleAccessSlices
} from './activityPageModel';

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
});
