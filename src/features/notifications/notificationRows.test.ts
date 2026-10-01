import { describe, expect, it } from 'vitest';

import {
    buildCachedInstanceMap,
    filterNotificationRows,
    getCachedInstanceLocation,
    matchesNotificationSearch,
    normalizeWorldTarget
} from './notificationRows';

describe('notification row helpers', () => {
    it('filters notifications by type and user search text', () => {
        const rows = [
            { type: 'invite', senderUsername: 'Maple', message: 'Join me' },
            { type: 'message', senderUsername: 'Oak', message: 'Hello' },
            { type: 'boop', senderUsername: 'Birch', message: 'Boop' }
        ];

        expect(matchesNotificationSearch(rows[0], 'join')).toBe(true);
        expect(
            filterNotificationRows(rows, ['invite', 'message'], 'oak')
        ).toEqual([rows[1]]);
        expect(filterNotificationRows(rows, [], '')).toEqual(rows);
    });

    it('normalizes world targets', () => {
        expect(normalizeWorldTarget('wrld_123:456~private')).toBe('wrld_123');
        expect(normalizeWorldTarget('wrld_123')).toBe('wrld_123');
    });

    it('normalizes cached instances', () => {
        expect(
            getCachedInstanceLocation({
                instance: { location: 'wrld_123:456' }
            })
        ).toBe('wrld_123:456');

        const cached = buildCachedInstanceMap([
            { instance: { location: 'wrld_123:456', name: 'Cached' } },
            { instanceId: 'wrld_789:000', name: 'Fallback' }
        ]);
        expect(cached.get('wrld_123:456')).toEqual({
            location: 'wrld_123:456',
            name: 'Cached'
        });
        expect(cached.get('wrld_789:000')).toEqual({
            instanceId: 'wrld_789:000',
            name: 'Fallback'
        });
    });
});
