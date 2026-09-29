import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauriMock = vi.hoisted(() => ({
    commands: {
        appIngestUserFacts: vi.fn()
    }
}));

vi.mock('@/platform/tauri/bindings', () => ({ commands: tauriMock.commands }));

import { flushPendingUserFactEntries } from '@/services/userFactAccessService';
import { useInstancePresenceStore } from '@/state/instancePresenceStore';
import { useLocationHintStore } from '@/state/locationHintStore';

import {
    recordCurrentUserSnapshot,
    recordGameRuntimePresence,
    recordLocationHintsFromInstances,
    recordKnownUser,
    resetDomainFacts
} from './domainIngestionService';

type IngestedEntry = {
    user?: { id?: string };
    source?: string;
};

function ingestedEntryFor(userId: string, source?: string) {
    return tauriMock.commands.appIngestUserFacts.mock.calls
        .flatMap((call) => (Array.isArray(call[0]) ? call[0] : []))
        .filter(
            (entry: IngestedEntry) =>
                entry?.user?.id === userId &&
                (source === undefined || entry?.source === source)
        )
        .at(-1);
}

describe('domainIngestionService', () => {
    beforeEach(() => {
        tauriMock.commands.appIngestUserFacts.mockReset();
        tauriMock.commands.appIngestUserFacts.mockResolvedValue(undefined);
        resetDomainFacts();
    });

    it('forwards current user and friend patch users to the Rust ingest IPC', async () => {
        recordCurrentUserSnapshot(
            {
                id: 'usr_self',
                displayName: 'Self',
                isBoopingEnabled: false,
                location: 'private'
            },
            { endpoint: 'api' }
        );
        recordKnownUser(
            {
                id: 'usr_friend',
                displayName: 'Friend',
                location: 'wrld_live:123'
            },
            { endpoint: 'api', source: 'realtime', isFriend: true }
        );
        await flushPendingUserFactEntries();

        expect(tauriMock.commands.appIngestUserFacts).toHaveBeenCalled();

        expect(ingestedEntryFor('usr_self')).toMatchObject({
            user: {
                id: 'usr_self',
                displayName: 'Self'
            },
            isCurrentUser: true
        });
        expect(ingestedEntryFor('usr_friend')).toMatchObject({
            user: {
                id: 'usr_friend',
                displayName: 'Friend',
                location: 'wrld_live:123'
            },
            source: 'realtime',
            isFriend: true
        });
    });

    it('records the game runtime location for the current user and the instance presence', async () => {
        recordGameRuntimePresence({
            endpoint: 'api',
            currentUserId: 'usr_self',
            currentUserSnapshot: {
                id: 'usr_self',
                displayName: 'Self'
            },
            currentLocation: 'wrld_game:12345',
            currentLocationStartedAt: '2026-01-01T00:00:00.000Z',
            currentLocationPlayers: [
                {
                    userId: 'usr_friend',
                    displayName: 'Friend',
                    joinedAt: '2026-01-01T00:00:00.000Z'
                }
            ]
        });
        await flushPendingUserFactEntries();

        expect(ingestedEntryFor('usr_self', 'gameRuntime')).toMatchObject({
            user: {
                id: 'usr_self',
                location: 'wrld_game:12345'
            },
            source: 'gameRuntime',
            isCurrentUser: true
        });
        expect(
            useInstancePresenceStore.getState().presenceByKey[
                'api::wrld_game:12345'
            ].userIds
        ).toEqual(['usr_friend']);
    });

    it('normalizes player snapshot ids to the real user id and drops synthetic ids for anonymous players', async () => {
        recordGameRuntimePresence({
            endpoint: 'api',
            currentUserId: 'usr_self',
            currentUserSnapshot: {
                id: 'usr_self',
                displayName: 'Self'
            },
            currentLocation: 'wrld_game:12345',
            currentLocationStartedAt: '2026-01-01T00:00:00.000Z',
            currentLocationPlayers: [
                {
                    id: 'id:usr_dup',
                    userId: 'usr_dup',
                    displayName: 'Dup',
                    joinedAt: '2026-01-01T00:00:00.000Z'
                },
                {
                    id: 'row:1',
                    displayName: 'Anon'
                }
            ]
        });
        await flushPendingUserFactEntries();

        expect(ingestedEntryFor('usr_dup', 'playerSnapshot')).toMatchObject({
            user: {
                id: 'usr_dup',
                userId: 'usr_dup',
                displayName: 'Dup'
            },
            source: 'playerSnapshot'
        });

        const ingestedIds = tauriMock.commands.appIngestUserFacts.mock.calls
            .flatMap((call) => (Array.isArray(call[0]) ? call[0] : []))
            .map((entry: IngestedEntry) => entry?.user?.id);
        expect(ingestedIds).not.toContain('row:1');
        expect(ingestedIds).not.toContain('id:usr_dup');
    });

    it('keeps traveling as a sentinel and does not record destination as current presence', async () => {
        recordGameRuntimePresence({
            endpoint: 'api',
            currentUserId: 'usr_self',
            currentUserSnapshot: {
                id: 'usr_self',
                displayName: 'Self'
            },
            currentLocation: 'traveling:traveling',
            currentDestination: 'wrld_destination:12345',
            currentLocationStartedAt: '2026-01-01T00:00:00.000Z',
            currentLocationPlayers: [
                {
                    userId: 'usr_friend',
                    displayName: 'Friend'
                }
            ]
        });
        await flushPendingUserFactEntries();

        expect(ingestedEntryFor('usr_self', 'gameRuntime')).toMatchObject({
            user: {
                id: 'usr_self',
                location: 'traveling',
                travelingToLocation: 'wrld_destination:12345'
            },
            source: 'gameRuntime',
            isCurrentUser: true
        });
        expect(useInstancePresenceStore.getState().presenceByKey).toEqual({});
    });

    it('records instance display hints separately from full query data', async () => {
        recordLocationHintsFromInstances({
            endpoint: 'api',
            instances: [
                {
                    location: 'wrld_test:12345~group(grp_test)',
                    worldName: 'World',
                    groupName: 'Group',
                    displayName: 'Instance',
                    closedAt: '2026-01-01T00:00:00.000Z',
                    users: [
                        {
                            id: 'usr_api',
                            displayName: 'API User'
                        }
                    ]
                }
            ]
        });
        await flushPendingUserFactEntries();

        expect(
            useLocationHintStore.getState().hintsByKey[
                'api::wrld_test:12345~group(grp_test)'
            ]
        ).toMatchObject({
            worldName: 'World',
            groupName: 'Group',
            instanceName: 'Instance',
            isClosed: true
        });
        expect(ingestedEntryFor('usr_api')).toMatchObject({
            user: {
                id: 'usr_api',
                displayName: 'API User'
            },
            source: 'instance'
        });
    });

    it('resets domain stores on auth boundaries', async () => {
        recordKnownUser(
            {
                id: 'usr_test',
                displayName: 'User'
            },
            { endpoint: 'api', source: 'profile' }
        );
        recordLocationHintsFromInstances({
            endpoint: 'api',
            instances: [{ location: 'wrld_test:12345', worldName: 'World' }]
        });
        await flushPendingUserFactEntries();

        expect(ingestedEntryFor('usr_test')).toMatchObject({
            user: { id: 'usr_test', displayName: 'User' },
            source: 'profile'
        });
        expect(
            Object.keys(useInstancePresenceStore.getState().presenceByKey)
        ).not.toHaveLength(0);
        expect(
            Object.keys(useLocationHintStore.getState().hintsByKey)
        ).not.toHaveLength(0);

        resetDomainFacts();

        expect(useInstancePresenceStore.getState().presenceByKey).toEqual({});
        expect(useLocationHintStore.getState().hintsByKey).toEqual({});
    });
});
