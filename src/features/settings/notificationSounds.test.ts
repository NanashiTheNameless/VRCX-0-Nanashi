import { describe, expect, it } from 'vitest';

import { parseNotificationSounds } from './notificationSounds';

describe('notification sound configuration', () => {
    it('uses backend defaults and preserves unknown event names', () => {
        expect(
            parseNotificationSounds('{"rules":{"FutureEvent@friend":{}}}')
        ).toEqual({
            version: 1,
            rules: {
                'FutureEvent@friend': { enabled: true, path: '', volume: 0.8 }
            }
        });
        expect(parseNotificationSounds('')).toEqual({ version: 1, rules: {} });
    });
    it.each([
        'null',
        '[]',
        '{"version":2,"rules":{}}',
        '{"rules":[]}',
        '{"rules":{"Online":{"enabled":"false"}}}',
        '{"rules":{"Online":{"path":42}}}',
        '{"rules":{"Online":{"volume":1e999}}}'
    ])('rejects invalid settings: %s', (raw) => {
        expect(() => parseNotificationSounds(raw)).toThrow();
    });
    it('clamps volume to the playback range', () => {
        expect(
            parseNotificationSounds('{"rules":{"Online":{"volume":2}}}').rules
                .Online.volume
        ).toBe(1);
    });
});
