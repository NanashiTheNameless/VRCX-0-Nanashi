import { describe, expect, it } from 'vitest';

import {
    formatWidgetDate,
    formatWidgetTime,
    getWidgetDayKey
} from './dashboardWidgetUtils';

describe('dashboardWidgetUtils timeline formatting', () => {
    it('groups rows by local calendar day', () => {
        const value = new Date(2026, 7, 12, 11, 37).toISOString();

        expect(getWidgetDayKey(value)).toBe('2026-08-12');
    });

    it('shows a placeholder for rows without a timestamp', () => {
        expect(formatWidgetDate(null)).toBe('--');
        expect(formatWidgetTime('')).toBe('--');
    });
});
