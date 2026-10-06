import { describe, expect, it } from 'vitest';

import { clampSetting, presetWidthCm } from './SettingsWristPlacementFields';

describe('wrist placement settings', () => {
    it('keeps the physical width of the old size presets', () => {
        expect(presetWidthCm('compact')).toBe(32);
        expect(presetWidthCm('normal')).toBe(40);
        expect(presetWidthCm('large')).toBe(48);
        expect(presetWidthCm('bogus')).toBe(40);
    });

    it('clamps and rounds like the Rust config loader', () => {
        const width = {
            id: 'width',
            key: 'k',
            min: 10,
            max: 80,
            unit: 'cm'
        } as const;
        const tilt = {
            id: 'tilt',
            key: 'k',
            min: -90,
            max: 90,
            unit: 'deg'
        } as const;
        expect(clampSetting(width, 500)).toBe(80);
        expect(clampSetting(width, 3)).toBe(10);
        expect(clampSetting(tilt, -12.6)).toBe(-13);
        expect(clampSetting(width, Number.NaN)).toBe(40);
        expect(clampSetting(tilt, Number.NaN)).toBe(0);
    });
});
