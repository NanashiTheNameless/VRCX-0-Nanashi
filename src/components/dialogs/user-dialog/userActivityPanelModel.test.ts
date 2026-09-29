import { describe, expect, it } from 'vitest';

import { getDisplayDayLabels, getRangeDays } from './userActivityPanelModel';

describe('userActivityPanelModel', () => {
    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    it('rotates day labels from the configured first day of week', () => {
        expect(getDisplayDayLabels(dayLabels, 0)).toEqual([
            'Sun',
            'Mon',
            'Tue',
            'Wed',
            'Thu',
            'Fri',
            'Sat'
        ]);
        expect(getDisplayDayLabels(dayLabels, 1)).toEqual([
            'Mon',
            'Tue',
            'Wed',
            'Thu',
            'Fri',
            'Sat',
            'Sun'
        ]);
        expect(getDisplayDayLabels(dayLabels, 6)).toEqual([
            'Sat',
            'Sun',
            'Mon',
            'Tue',
            'Wed',
            'Thu',
            'Fri'
        ]);
    });

    it('parses range days, maps all-time to zero, and falls back to the default range', () => {
        expect(getRangeDays('7')).toBe(7);
        expect(getRangeDays('all')).toBe(0);
        expect(getRangeDays('bad')).toBe(30);
        expect(getRangeDays(undefined)).toBe(30);
    });
});
