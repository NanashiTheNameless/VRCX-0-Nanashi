import { describe, expect, it } from 'vitest';

import {
    collectRuntimeRosterPlayers,
    decorateCurrentUserInRoster,
    type CurrentInstanceRosterPlayer
} from './currentInstanceRoster';

describe('collectRuntimeRosterPlayers', () => {
    it('deduplicates repeated GameLog join events for the same player into a single roster entry', () => {
        const { players } = collectRuntimeRosterPlayers([
            { userId: 'usr_1', displayName: 'Alice', joinTime: 1 },
            { userId: 'usr_1', displayName: 'Alice', joinTime: 2 }
        ]);

        expect(players).toHaveLength(1);
        expect(players[0].joinedAtMs).toBe(2000);
    });

    it('falls back to matching by display name when the GameLog event has no user id yet, so an early join event still dedupes once the id arrives', () => {
        const { players } = collectRuntimeRosterPlayers([
            { userId: '', displayName: 'Bob', joinTime: 1 },
            { userId: '', displayName: 'Bob', joinTime: 2 }
        ]);

        expect(players).toHaveLength(1);
        expect(players[0].id).toBe('display:Bob');
    });

    it('skips a GameLog event that identifies neither a user id nor a display name, since it cannot be shown in the roster', () => {
        const { players } = collectRuntimeRosterPlayers([
            { userId: '', displayName: '', joinTime: 1 }
        ]);

        expect(players).toHaveLength(0);
    });

    it('excludes players with no known user id from playerIds, so downstream user-detail lookups are not made for display-name-only rows', () => {
        const { playerIds } = collectRuntimeRosterPlayers([
            { userId: 'usr_1', displayName: 'Alice', joinTime: 1 },
            { userId: '', displayName: 'Bob', joinTime: 1 }
        ]);

        expect(playerIds).toEqual(['usr_1']);
    });
});

describe('decorateCurrentUserInRoster', () => {
    const otherPlayer: CurrentInstanceRosterPlayer = {
        id: 'usr_2',
        userId: 'usr_2',
        displayName: 'Someone Else',
        joinedAt: 1767225600,
        joinedAtMs: 1_735_689_600_000
    };

    it('does not add a local user who is absent from the observed roster', () => {
        const result = decorateCurrentUserInRoster({
            currentUserId: 'usr_self',
            currentUserDisplayName: 'Me',
            joinedAt: 1769904000,
            players: [otherPlayer]
        });

        expect(result).toEqual([otherPlayer]);
    });

    it('merges into the existing GameLog-observed entry for the current user by user id, without creating a duplicate row', () => {
        const selfFromGameLog: CurrentInstanceRosterPlayer = {
            id: 'usr_self',
            userId: 'usr_self',
            displayName: 'Me',
            joinedAt: 1767571200,
            joinedAtMs: 1_736_035_200_000,
            lastDurationMs: 500
        };

        const result = decorateCurrentUserInRoster({
            currentUserId: 'usr_self',
            currentUserDisplayName: 'Me',
            joinedAt: 1769904000,
            players: [otherPlayer, selfFromGameLog]
        });

        expect(result).toHaveLength(2);
        expect(
            result.filter((player) => player.userId === 'usr_self')
        ).toHaveLength(1);
        expect(result[0].joinedAt).toBe(1767571200);
        expect(result[0].lastDurationMs).toBe(500);
    });

    it('matches the current user by case-insensitive display name when the user id is not yet known from GameLog, so the entry still merges instead of duplicating', () => {
        const selfFromGameLog: CurrentInstanceRosterPlayer = {
            id: 'display:me',
            userId: '',
            displayName: 'me',
            joinedAt: 1767571200,
            joinedAtMs: 1_736_035_200_000
        };

        const result = decorateCurrentUserInRoster({
            currentUserId: 'usr_self',
            currentUserDisplayName: 'Me',
            joinedAt: 1769904000,
            players: [selfFromGameLog]
        });

        expect(result).toHaveLength(1);
        expect(result[0].userId).toBe('usr_self');
        expect(result[0].joinedAt).toBe(1767571200);
    });

    it('leaves the roster untouched when the current user identity is not yet known, avoiding a bogus self-entry', () => {
        const result = decorateCurrentUserInRoster({
            currentUserId: '',
            currentUserDisplayName: '',
            joinedAt: 1769904000,
            players: [otherPlayer]
        });

        expect(result).toEqual([otherPlayer]);
    });
});

it('does not relabel a different known user as self when names match', () => {
    const row = {
        id: 'usr_other',
        userId: 'usr_other',
        displayName: 'Me',
        joinedAt: 0,
        joinedAtMs: 0
    };
    expect(
        decorateCurrentUserInRoster({
            currentUserId: 'usr_self',
            currentUserDisplayName: 'Me',
            joinedAt: 0,
            players: [row]
        })
    ).toEqual([row]);
});
