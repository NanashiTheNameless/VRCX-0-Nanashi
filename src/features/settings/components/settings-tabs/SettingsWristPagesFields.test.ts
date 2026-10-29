import { describe, expect, it } from 'vitest';

import {
    clampSwitchCooldownMs,
    parseWristPages,
    serializeWristPages
} from './SettingsWristPagesFields';

describe('wrist page order', () => {
    it('keeps the saved order, dedupes, and lists hidden pages last', () => {
        const rows = parseWristPages('notes, feed,notes,bogus');
        expect(rows).toEqual([
            { id: 'notes', shown: true },
            { id: 'feed', shown: true },
            { id: 'players', shown: false }
        ]);
        expect(serializeWristPages(rows)).toBe('notes,feed');
    });

    it('never ends up with no page shown', () => {
        expect(serializeWristPages(parseWristPages(''))).toBe('feed');
    });
});

describe('wrist switch cooldown', () => {
    it('keeps 0 to turn it off and caps at 5 seconds', () => {
        expect(clampSwitchCooldownMs(0)).toBe(0);
        expect(clampSwitchCooldownMs(-50)).toBe(0);
        expect(clampSwitchCooldownMs(1234.4)).toBe(1234);
        expect(clampSwitchCooldownMs(9000)).toBe(5000);
        expect(clampSwitchCooldownMs(Number.NaN)).toBe(1000);
    });
});
