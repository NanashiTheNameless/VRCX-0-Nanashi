import { describe, expect, it } from 'vitest';

import { sanitizeFeedColumnDensity } from './feedColumnsDensity';

describe('feed columns density helpers', () => {
    it('falls back to compact for unsupported density values', () => {
        expect(sanitizeFeedColumnDensity('standard')).toBe('compact');
        expect(sanitizeFeedColumnDensity('dense')).toBe('dense');
    });
});
