import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildOverlayBadgeEffects } from './overlayBadgeEffects';

describe('overlay badge effects', () => {
    it('uses the main app keyframes, delays, particle positions, and easing', () => {
        const root = path.join(import.meta.dirname, '..');
        const expected = buildOverlayBadgeEffects(
            fs.readFileSync(path.join(root, 'src/styles/globals.css'), 'utf8')
        );
        expect(
            JSON.parse(
                fs.readFileSync(
                    path.join(root, 'crates/vr-overlay/ui/badge-effects.json'),
                    'utf8'
                )
            )
        ).toEqual(JSON.parse(expected));
        const data = JSON.parse(expected);
        expect(data.animations['fork-dev-scan'].duration).toBe(22600);
        expect(data.animations['fork-dev-glitch'].easing).toBe('steps');
        expect(data.sparkles).toHaveLength(6);
        expect(
            data.embers.flatMap((layer: { dots: unknown[] }) => layer.dots)
        ).toHaveLength(12);
        expect(
            data.animations['award-wiggle'].tracks.rotate.map(
                (stop: { value: number }) => stop.value
            )
        ).toEqual([0, -14, 14, -14, 14, -14, 0, 0]);
    });
});
