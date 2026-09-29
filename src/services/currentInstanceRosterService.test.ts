import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getCurrentInstanceSnapshot: vi.fn()
}));

vi.mock('@/repositories/currentInstanceRosterRepository', () => ({
    default: {
        getCurrentInstanceSnapshot: mocks.getCurrentInstanceSnapshot
    }
}));

import { loadCurrentInstanceRoster } from './currentInstanceRosterService';

const runtimePlayer = {
    id: 'usr_runtime',
    userId: 'usr_runtime',
    displayName: 'Runtime Player',
    joinedAt: '2026-08-01T01:00:00.000Z',
    joinedAtMs: Date.parse('2026-08-01T01:00:00.000Z'),
    lastDurationMs: 0,
    source: 'runtime' as const
};

const worldId = 'wrld_00000000-0000-0000-0000-000000000000';

describe('currentInstanceRosterService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('trims the requested location and defaults a missing player count to zero', async () => {
        mocks.getCurrentInstanceSnapshot.mockResolvedValueOnce({
            context: {
                createdAt: '2026-08-01T01:00:00.000Z',
                groupName: '',
                location: `${worldId}:1~region(jp)`,
                playerFactsKnown: true,
                source: 'runtime',
                time: 0,
                worldId,
                worldName: 'Runtime World'
            },
            players: [runtimePlayer]
        });

        await expect(
            loadCurrentInstanceRoster({
                currentLocation: `  ${worldId}:1~region(jp)  `
            })
        ).resolves.toEqual({
            context: {
                createdAt: '2026-08-01T01:00:00.000Z',
                groupName: '',
                location: `${worldId}:1~region(jp)`,
                playerCount: 0,
                playerFactsKnown: true,
                source: 'runtime',
                time: 0,
                worldId,
                worldName: 'Runtime World'
            },
            players: [runtimePlayer]
        });
        expect(mocks.getCurrentInstanceSnapshot).toHaveBeenCalledWith({
            currentLocation: `${worldId}:1~region(jp)`
        });
    });
});
