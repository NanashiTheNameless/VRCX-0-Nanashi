import { describe, expect, it } from 'vitest';

import {
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
