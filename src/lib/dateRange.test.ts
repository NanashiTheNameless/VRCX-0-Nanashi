import { describe, expect, it } from 'vitest';

import { parseDateInput, toDateInputValue } from './dateRange';

describe('dateRange', () => {
    it('round-trips date input values and rejects unparsable input', () => {
        const parsed = parseDateInput('2026-03-04');

        expect(parsed).toBeInstanceOf(Date);
        expect(toDateInputValue(parsed)).toBe('2026-03-04');
        expect(parseDateInput('not-a-date')).toBeUndefined();
        expect(toDateInputValue(null)).toBe('');
    });
});
