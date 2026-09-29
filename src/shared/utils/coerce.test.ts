import { describe, expect, it } from 'vitest';

import { normalizeNumber } from './coerce';

describe('coerce utils', () => {
    it('coerces finite numbers and falls back to zero', () => {
        expect(normalizeNumber(12)).toBe(12);
        expect(normalizeNumber('3.5')).toBe(3.5);
        expect(normalizeNumber('not a number')).toBe(0);
        expect(normalizeNumber(Infinity)).toBe(0);
        expect(normalizeNumber(null)).toBe(0);
    });
});
