import { describe, expect, it } from 'vitest';

import { aggregateFriendUserStats } from './friendStats';

describe('friendStats', () => {
    it('aggregates game-log stats by friend id and keeps the most recent last seen time', () => {
        const stats = aggregateFriendUserStats(
            [
                {
                    displayName: 'Ava',
                    userId: 'usr_ava',
                    lastSeen: '2026-04-10T00:00:00.000Z',
                    timeSpent: 100,
                    joinCount: 1
                },
                {
                    displayName: 'Ava',
                    userId: '',
                    lastSeen: '2026-04-12T00:00:00.000Z',
                    timeSpent: 200,
                    joinCount: 2
                },
                {
                    displayName: 'Ben',
                    userId: '',
                    lastSeen: '2026-04-11T00:00:00.000Z',
                    timeSpent: 50,
                    joinCount: 1
                }
            ],
            [
                { id: 'usr_ava', displayName: 'Ava' },
                { id: 'usr_ben', displayName: 'Ben' }
            ]
        );

        expect(stats.get('usr_ava')).toMatchObject({
            lastSeen: '2026-04-12T00:00:00.000Z',
            timeSpent: 300,
            joinCount: 3
        });
        expect(stats.get('usr_ben')).toMatchObject({
            lastSeen: '2026-04-11T00:00:00.000Z',
            timeSpent: 50,
            joinCount: 1
        });
    });
});
