import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    applyToStylesheet,
    QUIET_SECONDS,
    sameIgnoringWhitespace,
    scanGaps,
    timelineProblems
} from './devBadgeEffects';

const stylesheet = path.join(
    import.meta.dirname,
    '..',
    'src/styles/globals.css'
);

describe('developer badge effects', () => {
    it('keeps every glitch at least a quarter second away from a scan', () => {
        expect(timelineProblems()).toEqual([]);
        for (const { before, after } of scanGaps()) {
            expect(before).toBeGreaterThanOrEqual(QUIET_SECONDS);
            expect(after).toBeGreaterThanOrEqual(QUIET_SECONDS);
        }
    });

    it('matches the keyframes in the stylesheet', () => {
        const css = fs.readFileSync(stylesheet, 'utf8');
        expect(
            sameIgnoringWhitespace(css, applyToStylesheet(css)),
            'Run npm run badges:dev-fx after changing scripts/devBadgeEffects.ts.'
        ).toBe(true);
    });
});
