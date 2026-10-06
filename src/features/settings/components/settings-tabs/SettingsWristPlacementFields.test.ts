import { describe, expect, it } from 'vitest';

import {
    clampSetting,
    defaultSettingValue,
    presetWidthCm,
    type NumberSetting
} from './SettingsWristPlacementFields';

describe('wrist placement settings', () => {
    it('keeps the physical width of the old size presets', () => {
        expect(presetWidthCm('compact')).toBe(32);
        expect(presetWidthCm('normal')).toBe(40);
        expect(presetWidthCm('large')).toBe(48);
        expect(presetWidthCm('bogus')).toBe(40);
    });

    it('defaults like the Rust config loader', () => {
        expect(defaultSettingValue('width', 48)).toBe(48);
        expect(defaultSettingValue('height', 48)).toBe(96);
        expect(defaultSettingValue('content_text', 48)).toBe(100);
        expect(defaultSettingValue('tilt', 48)).toBe(0);
    });

    it('clamps and rounds like the Rust config loader', () => {
        const width: NumberSetting = {
            id: 'width',
            key: 'k',
            min: 10,
            max: 80,
            unit: 'cm'
        };
        const text: NumberSetting = {
            id: 'header_text',
            key: 'k',
            min: 50,
            max: 200,
            unit: 'percent'
        };
        expect(clampSetting(width, 500)).toBe(80);
        expect(clampSetting(width, 3)).toBe(10);
        expect(clampSetting(text, 10)).toBe(50);
        expect(clampSetting(text, 149.6)).toBe(150);
        expect(clampSetting(width, Number.NaN, 32)).toBe(32);
        expect(clampSetting(text, Number.NaN)).toBe(100);
    });
});
