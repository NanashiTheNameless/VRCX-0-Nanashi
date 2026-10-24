import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauriMock = vi.hoisted(() => ({
    commands: {
        appGameLogQuery: vi.fn(),
        appGameLogPreviousInstancesByGroupId: vi.fn(),
        appGameLogPreviousInstancesByWorldId: vi.fn(),
        appInstanceHistoryQuery: vi.fn()
    }
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: tauriMock.commands
}));

import gameLogRepository from './gameLogPersistenceRepository';

describe('gameLogPersistenceRepository', () => {
    beforeEach(() => {
        tauriMock.commands.appGameLogQuery.mockReset();
        tauriMock.commands.appGameLogQuery.mockResolvedValue({
            kind: 'lookupRows',
            value: []
        });
        tauriMock.commands.appGameLogPreviousInstancesByGroupId.mockReset();
        tauriMock.commands.appGameLogPreviousInstancesByGroupId.mockResolvedValue(
            []
        );
        tauriMock.commands.appGameLogPreviousInstancesByWorldId.mockReset();
        tauriMock.commands.appGameLogPreviousInstancesByWorldId.mockResolvedValue(
            []
        );
        tauriMock.commands.appInstanceHistoryQuery.mockReset();
        tauriMock.commands.appInstanceHistoryQuery.mockResolvedValue([]);
    });

    it('keeps previous instance user queries unbounded by default', async () => {
        await gameLogRepository.getPreviousInstancesByUserId({
            id: ' usr_target '
        });

        expect(tauriMock.commands.appInstanceHistoryQuery).toHaveBeenCalledWith(
            {
                userId: 'usr_target',
                dateFrom: null,
                dateTo: null,
                limit: 0
            }
        );
    });

    it('passes optional previous instance date windows to persistence', async () => {
        await gameLogRepository.getPreviousInstancesByUserId(
            { id: ' usr_self ' },
            {
                dateFrom: ' 2026-06-03T12:00:00.000Z ',
                dateTo: ' 2026-07-03T12:00:00.000Z '
            }
        );

        expect(tauriMock.commands.appInstanceHistoryQuery).toHaveBeenCalledWith(
            {
                userId: 'usr_self',
                dateFrom: 1780488000,
                dateTo: 1783080000,
                limit: 0
            }
        );
    });

    it('passes a bounded recent-history limit to the typed query', async () => {
        await gameLogRepository.getPreviousInstancesByUserId(
            { id: 'usr_target' },
            { limit: 50 }
        );

        expect(tauriMock.commands.appInstanceHistoryQuery).toHaveBeenCalledWith(
            {
                userId: 'usr_target',
                dateFrom: null,
                dateTo: null,
                limit: 50
            }
        );
    });

    it('uses the typed previous-instance commands for group and world history', async () => {
        tauriMock.commands.appGameLogPreviousInstancesByGroupId.mockResolvedValueOnce(
            [
                {
                    created_at: '2026-07-01T00:00:00Z',
                    groupName: 'Group',
                    location: 'wrld_group:1~group(grp_target)',
                    time: 60_000,
                    worldName: 'Group World'
                }
            ]
        );
        tauriMock.commands.appGameLogPreviousInstancesByWorldId.mockResolvedValueOnce(
            [
                {
                    created_at: '2026-07-02T00:00:00Z',
                    groupName: '',
                    id: 2,
                    location: 'wrld_target:2',
                    time: 120_000,
                    worldName: 'Target World'
                }
            ]
        );

        const groupRows =
            await gameLogRepository.getPreviousInstancesByGroupId(
                ' grp_target '
            );
        const worldRows = await gameLogRepository.getPreviousInstancesByWorldId(
            { id: ' wrld_target ' }
        );

        expect(
            tauriMock.commands.appGameLogPreviousInstancesByGroupId
        ).toHaveBeenCalledWith('grp_target');
        expect(
            tauriMock.commands.appGameLogPreviousInstancesByWorldId
        ).toHaveBeenCalledWith('wrld_target');
        expect(Array.from(groupRows.values())).toEqual([
            expect.objectContaining({
                location: 'wrld_group:1~group(grp_target)'
            })
        ]);
        expect(worldRows).toEqual([
            expect.objectContaining({ location: 'wrld_target:2' })
        ]);
    });

    it('keeps the first join time and tracks the last leave time for instance players', async () => {
        tauriMock.commands.appGameLogQuery.mockResolvedValueOnce({
            kind: 'playersFromInstanceRows',
            value: [
                {
                    rowId: 1,
                    created_at: '2026-01-01T12:00:00.000Z',
                    displayName: 'Ava',
                    userId: 'usr_ava',
                    time: 0,
                    type: 'OnPlayerJoined'
                },
                {
                    rowId: 2,
                    created_at: '2026-01-01T12:07:00.000Z',
                    displayName: 'Ava',
                    userId: 'usr_ava',
                    time: 420_000,
                    type: 'OnPlayerLeft'
                },
                {
                    rowId: 3,
                    created_at: '2026-01-01T12:10:00.000Z',
                    displayName: 'Ava',
                    userId: 'usr_ava',
                    time: 0,
                    type: 'OnPlayerJoined'
                },
                {
                    rowId: 4,
                    created_at: '2026-01-01T12:12:00.000Z',
                    displayName: 'Ava',
                    userId: 'usr_ava',
                    time: 120_000,
                    type: 'OnPlayerLeft'
                }
            ]
        });

        const players =
            await gameLogRepository.getPlayersFromInstance('wrld_test:12345');

        expect(tauriMock.commands.appGameLogQuery).toHaveBeenCalledWith({
            kind: 'playersFromInstanceRows',
            params: {
                location: 'wrld_test:12345'
            }
        });
        expect(players.get('usr_ava')).toMatchObject({
            created_at: '2026-01-01T12:00:00.000Z',
            left_at: '2026-01-01T12:12:00.000Z',
            time: 540_000,
            count: 2
        });
    });
});
