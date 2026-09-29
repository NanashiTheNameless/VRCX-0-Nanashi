import { describe, expect, it } from 'vitest';

import { safeJsonParse } from './json';

describe('safeJsonParse', () => {
    it('parses stored JSON and treats empty or malformed values as absent', () => {
        expect(safeJsonParse('{"sorting":[]}')).toEqual({ sorting: [] });
        expect(safeJsonParse('bad json')).toBeNull();
        expect(safeJsonParse('')).toBeNull();
        expect(safeJsonParse(null)).toBeNull();
    });
});
