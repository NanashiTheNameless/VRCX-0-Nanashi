import { describe, expect, it } from 'vitest';

import {
    buildInstancePresenceFact,
    instancePresenceKey
} from './instancePresence';

describe('instancePresence domain model', () => {
    it('keys only real instances by endpoint and normalized location', () => {
        expect(
            instancePresenceKey('api', 'wrld_test:12345~hidden(usr_owner)')
        ).toBe('api::wrld_test:12345~hidden(usr_owner)');
        expect(
            instancePresenceKey('api', 'wrld_test:12345~group(grp_owner)')
        ).toBe('api::wrld_test:12345~group(grp_owner)');
        expect(instancePresenceKey('api', 'private')).toBe('');
    });

    it('builds current instance presence from runtime players', () => {
        const presence = buildInstancePresenceFact({
            endpoint: 'api',
            location: 'wrld_test:12345~hidden(usr_owner)',
            source: 'gameRuntime',
            players: [
                {
                    userId: 'usr_friend',
                    displayName: 'Friend',
                    joinedAt: '2026-01-01T00:00:00.000Z'
                }
            ]
        });

        expect(presence?.locationKey).toBe('wrld_test:12345~hidden(usr_owner)');
        expect(presence?.userIds).toEqual(['usr_friend']);
        expect(presence?.playersById.usr_friend).toMatchObject({
            userId: 'usr_friend',
            displayName: 'Friend',
            joinedAt: '2026-01-01T00:00:00.000Z'
        });
    });
});
