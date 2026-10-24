import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appRuntimeGroupInstancesRefresh: vi.fn(),
    getInstanceJoinHistory: vi.fn(),
    hydrateRuntimeGameLogProjection: vi.fn(),
    syncStartupServicesTask: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appRuntimeGroupInstancesRefresh: mocks.appRuntimeGroupInstancesRefresh
    }
}));

vi.mock('@/repositories/gameLogPersistenceRepository', () => ({
    default: {
        getInstanceJoinHistory: mocks.getInstanceJoinHistory
    }
}));

vi.mock('./gameLogIngestService', () => ({
    hydrateRuntimeGameLogProjection: mocks.hydrateRuntimeGameLogProjection
}));

vi.mock('./startupServicesStatus', () => ({
    syncStartupServicesTask: mocks.syncStartupServicesTask
}));

describe('sessionBootstrapService', () => {
    beforeEach(async () => {
        vi.clearAllMocks();

        const { useInstanceJoinHistoryStore } =
            await import('@/state/instanceJoinHistoryStore');
        const { useRuntimeStore } = await import('@/state/runtimeStore');
        const { useSessionStore } = await import('@/state/sessionStore');

        useInstanceJoinHistoryStore.getState().resetInstanceJoinHistory();
        useRuntimeStore.getState().resetRuntimeState();
        useSessionStore.getState().resetSessionState();
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserEndpoint: 'https://api.example.test/api/1',
            currentUserWebsocket: 'wss://pipeline.example.test',
            currentUserSnapshot: {
                id: 'usr_self',
                displayName: 'Self'
            }
        });
        mocks.appRuntimeGroupInstancesRefresh.mockResolvedValue(null);
        mocks.getInstanceJoinHistory.mockResolvedValue(
            new Map([['wrld_test:123', 123456]])
        );
        mocks.hydrateRuntimeGameLogProjection.mockResolvedValue(false);
    });

    it('restores the persisted GameLog roster after the session becomes ready', async () => {
        mocks.hydrateRuntimeGameLogProjection.mockResolvedValue(true);
        const { beginAuthAttempt } = await import('./authAttempt');
        const { bootstrapAuthenticatedSession } =
            await import('./sessionBootstrapService');

        await bootstrapAuthenticatedSession(
            { id: 'usr_self', displayName: 'Self' },
            beginAuthAttempt()
        );

        await vi.waitFor(() => {
            expect(mocks.hydrateRuntimeGameLogProjection).toHaveBeenCalledTimes(
                1
            );
        });
    });

    it('marks the session ready without waiting for post-ready hydration', async () => {
        let finishGroupRefresh: () => void = () => {
            throw new Error('Group refresh was not initialized.');
        };
        mocks.appRuntimeGroupInstancesRefresh.mockImplementationOnce(
            () =>
                new Promise<null>((resolve) => {
                    finishGroupRefresh = () => resolve(null);
                })
        );
        const { useSessionStore } = await import('@/state/sessionStore');
        const { beginAuthAttempt } = await import('./authAttempt');
        const { bootstrapAuthenticatedSession } =
            await import('./sessionBootstrapService');
        let bootstrapCompleted = false;
        const bootstrap = bootstrapAuthenticatedSession(
            { id: 'usr_self', displayName: 'Self' },
            beginAuthAttempt()
        ).then(() => {
            bootstrapCompleted = true;
        });

        await Promise.resolve();

        expect(useSessionStore.getState().sessionPhase).toBe('ready');
        expect(bootstrapCompleted).toBe(true);

        finishGroupRefresh();
        await bootstrap;
        await vi.waitFor(() => {
            expect(mocks.getInstanceJoinHistory).toHaveBeenCalledWith(
                'usr_self'
            );
        });
    });

    it('hydrates the frontend after the backend session is committed', async () => {
        const { useInstanceJoinHistoryStore } =
            await import('@/state/instanceJoinHistoryStore');
        const { useSessionStore } = await import('@/state/sessionStore');
        const { beginAuthAttempt } = await import('./authAttempt');
        const { bootstrapAuthenticatedSession } =
            await import('./sessionBootstrapService');

        await bootstrapAuthenticatedSession(
            {
                id: 'usr_self',
                displayName: 'Self'
            },
            beginAuthAttempt()
        );

        await vi.waitFor(() => {
            expect(mocks.appRuntimeGroupInstancesRefresh).toHaveBeenCalledTimes(
                1
            );
            expect(mocks.getInstanceJoinHistory).toHaveBeenCalledWith(
                'usr_self'
            );
        });
        expect(
            useInstanceJoinHistoryStore.getState().joinedAtByLocation
        ).toEqual({
            'wrld_test:123': 123456
        });
        expect(useSessionStore.getState().isLoggedIn).toBe(true);
        expect(useSessionStore.getState().sessionPhase).toBe('ready');
        expect(useSessionStore.getState().isFriendsLoaded).toBe(false);
    });

    it('re-records the current instance join cleared by the sign-in reset', async () => {
        const { useInstanceJoinHistoryStore } =
            await import('@/state/instanceJoinHistoryStore');
        const { useRuntimeStore } = await import('@/state/runtimeStore');
        const { beginAuthAttempt } = await import('./authAttempt');
        const { bootstrapAuthenticatedSession } =
            await import('./sessionBootstrapService');
        useRuntimeStore.getState().setGameState({
            currentLocation: 'wrld_test:456~region(jp)',
            currentLocationStartedAt: 1790344090
        });

        await bootstrapAuthenticatedSession(
            { id: 'usr_self', displayName: 'Self' },
            beginAuthAttempt()
        );

        await vi.waitFor(() => {
            expect(
                useInstanceJoinHistoryStore.getState().lastJoinedAtByLocation
            ).toEqual({
                'wrld_test:456~region(jp)': Date.parse(
                    '2026-09-25T13:48:10.000Z'
                )
            });
        });
    });

    it('stops post-ready hydration after a newer auth action starts', async () => {
        let finishGroupRefresh: () => void = () => {
            throw new Error('Group refresh was not initialized.');
        };
        mocks.appRuntimeGroupInstancesRefresh.mockImplementationOnce(
            () =>
                new Promise<null>((resolve) => {
                    finishGroupRefresh = () => resolve(null);
                })
        );
        const { useSessionStore } = await import('@/state/sessionStore');
        const { beginAuthAttempt } = await import('./authAttempt');
        const { bootstrapAuthenticatedSession } =
            await import('./sessionBootstrapService');
        const oldAttempt = beginAuthAttempt();
        const oldBootstrap = bootstrapAuthenticatedSession(
            { id: 'usr_self', displayName: 'Self' },
            oldAttempt
        );
        await vi.waitFor(() => {
            expect(mocks.appRuntimeGroupInstancesRefresh).toHaveBeenCalledTimes(
                1
            );
        });
        expect(useSessionStore.getState().sessionPhase).toBe('ready');

        beginAuthAttempt();
        useSessionStore.getState().setSessionState({
            isLoggedIn: false,
            sessionPhase: 'authenticating'
        });
        finishGroupRefresh();

        await oldBootstrap.catch(() => undefined);
        await Promise.resolve();
        expect(mocks.getInstanceJoinHistory).not.toHaveBeenCalled();
        expect(mocks.hydrateRuntimeGameLogProjection).not.toHaveBeenCalled();
        expect(useSessionStore.getState().isLoggedIn).toBe(false);
        expect(useSessionStore.getState().sessionPhase).toBe('authenticating');
    });
});
