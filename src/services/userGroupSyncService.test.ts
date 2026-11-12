import { CodeXml, Diamond, ShieldCheck } from 'lucide-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getGroups: vi.fn() }));
vi.mock('@/platform/tauri/bindings', () => ({
    commands: { appVrchatGroupUserGroupsGet: mocks.getGroups }
}));

import { queryKeys } from '@/lib/entityQueryCache';
import { queryClient } from '@/lib/queryClient';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import { VRCHAT_STAFF_GROUP_ID } from '@/shared/constants/user';
import { DEFAULT_VRCHAT_API_ENDPOINT } from '@/shared/vrchatEndpoint';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';
import { useUserFactsStore } from '@/state/userFactsStore';
import {
    groupMembership,
    resetUserGroupMembershipStoreForTests,
    useUserGroupMembershipStore
} from '@/state/userGroupMembershipStore';

import { buildOverlayUserBadges } from './overlayBadgeSyncService';
import { startUserGroupSync } from './userGroupSyncService';

const OWNER = 'usr_owner';
const PLAYER = 'usr_player';
const FRIEND = 'usr_friend';
const ENDPOINT = DEFAULT_VRCHAT_API_ENDPOINT;
let stop: (() => void) | undefined;

function signIn(owner = OWNER) {
    useRuntimeStore.getState().setAuthBootstrap({
        currentUserId: owner,
        currentUserEndpoint: ENDPOINT
    });
    useSessionStore.getState().setSessionPhase('ready');
}

function membership(userId: string) {
    return groupMembership(
        useUserGroupMembershipStore.getState().byUser.get(userId),
        VRCHAT_STAFF_GROUP_ID
    );
}

beforeEach(() => {
    vi.useFakeTimers();
    queryClient.clear();
    resetUserGroupMembershipStoreForTests();
    useRuntimeStore.getState().resetRuntimeState();
    useSessionStore.getState().resetSessionState();
    useFriendRosterStore.getState().resetRoster();
    useUserFactsStore.getState().resetUserFacts();
    mocks.getGroups.mockReset();
    mocks.getGroups.mockResolvedValue({ status: 200, data: '[]' });
});

afterEach(() => {
    stop?.();
    stop = undefined;
    queryClient.clear();
    resetUserGroupMembershipStoreForTests();
    vi.useRealTimers();
});

describe('user group initialization', () => {
    it('loads all initialized users and gives group-only staff an overlay badge without opening a profile', async () => {
        signIn();
        useRuntimeStore
            .getState()
            .setGameState({ currentLocationPlayerIds: [PLAYER] });
        useFriendRosterStore.getState().setRosterSnapshot({
            currentUserId: OWNER,
            friendsById: { [FRIEND]: { id: FRIEND } }
        });
        useUserFactsStore
            .getState()
            .replaceUserFacts([{ id: 'usr_known', endpoint: ENDPOINT }]);
        mocks.getGroups.mockImplementation(async ({ userId }) => ({
            status: 200,
            data: JSON.stringify(
                userId === PLAYER
                    ? [{ id: 'gmem_staff', groupId: VRCHAT_STAFF_GROUP_ID }]
                    : []
            )
        }));

        stop = startUserGroupSync();
        await vi.advanceTimersByTimeAsync(0);
        expect(membership(PLAYER)).toBe(true);
        const table = buildOverlayUserBadges({ CodeXml, Diamond, ShieldCheck });
        const staff = table.users?.[PLAYER]?.[0];
        expect(staff).toBeDefined();
        expect(table.styles?.[staff!]).toMatchObject({
            colorFrom: '#2f7cf6',
            round: false
        });
        await vi.advanceTimersByTimeAsync(1500);
        expect(
            mocks.getGroups.mock.calls.map(([input]) => input.userId)
        ).toEqual([PLAYER, OWNER, FRIEND, 'usr_known']);
    });

    it('queues new users once and shares fresh group lists with profile lookups', async () => {
        signIn();
        await groupProfileRepository.getUserGroups({ userId: OWNER });
        stop = startUserGroupSync();
        await vi.advanceTimersByTimeAsync(0);
        expect(mocks.getGroups).toHaveBeenCalledTimes(1);

        useRuntimeStore
            .getState()
            .setGameState({ currentLocationPlayerIds: [PLAYER, PLAYER] });
        await vi.advanceTimersByTimeAsync(500);
        useUserFactsStore
            .getState()
            .replaceUserFacts([{ id: PLAYER, endpoint: ENDPOINT }]);
        await groupProfileRepository.getUserGroups({ userId: PLAYER });
        await vi.advanceTimersByTimeAsync(10_000);
        expect(mocks.getGroups).toHaveBeenCalledTimes(2);
        expect(
            queryClient.getQueryData(queryKeys.userGroups(PLAYER, ENDPOINT))
        ).toEqual([]);
        expect(membership(PLAYER)).toBe(false);
    });

    it('does not fetch before sign-in and drops users who leave before their lookup', async () => {
        useRuntimeStore
            .getState()
            .setGameState({ currentLocationPlayerIds: [PLAYER] });
        stop = startUserGroupSync();
        await vi.advanceTimersByTimeAsync(1000);
        expect(mocks.getGroups).not.toHaveBeenCalled();

        signIn();
        useRuntimeStore
            .getState()
            .setGameState({ currentLocationPlayerIds: [] });
        await vi.advanceTimersByTimeAsync(0);
        expect(mocks.getGroups).toHaveBeenCalledExactlyOnceWith({
            userId: OWNER
        });
    });

    it('pauses the entire queue after a rate limit, then retries without treating failure as non-membership', async () => {
        signIn();
        useRuntimeStore
            .getState()
            .setGameState({ currentLocationPlayerIds: [PLAYER] });
        mocks.getGroups.mockResolvedValueOnce({
            status: 429,
            data: 'Slow down'
        });
        stop = startUserGroupSync();
        await vi.advanceTimersByTimeAsync(0);
        expect(membership(PLAYER)).toBeNull();
        await vi.advanceTimersByTimeAsync(59_999);
        expect(mocks.getGroups).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(mocks.getGroups).toHaveBeenCalledTimes(2);
        expect(membership(PLAYER)).toBe(false);
        await vi.advanceTimersByTimeAsync(500);
        expect(mocks.getGroups).toHaveBeenCalledTimes(3);
    });

    it('keeps failed lookups unknown and retries transient failures', async () => {
        signIn();
        mocks.getGroups.mockRejectedValueOnce(new Error('Offline'));
        stop = startUserGroupSync();
        await vi.advanceTimersByTimeAsync(0);
        expect(membership(OWNER)).toBeNull();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(mocks.getGroups).toHaveBeenCalledTimes(2);
        expect(membership(OWNER)).toBe(false);
    });

    it('backs off for structured rate-limit errors from the backend', async () => {
        signIn();
        useRuntimeStore
            .getState()
            .setGameState({ currentLocationPlayerIds: [PLAYER] });
        mocks.getGroups.mockRejectedValueOnce({
            code: 'vrchat_api',
            statusCode: 429
        });
        stop = startUserGroupSync();
        await vi.advanceTimersByTimeAsync(59_999);
        expect(mocks.getGroups).toHaveBeenCalledTimes(1);
        expect(membership(PLAYER)).toBeNull();
        await vi.advanceTimersByTimeAsync(1);
        expect(mocks.getGroups).toHaveBeenCalledTimes(2);
    });

    it('does not retry forbidden lists or record them as empty lists', async () => {
        signIn();
        mocks.getGroups.mockResolvedValue({ status: 403, data: 'Forbidden' });
        stop = startUserGroupSync();
        await vi.advanceTimersByTimeAsync(120_000);
        expect(mocks.getGroups).toHaveBeenCalledTimes(1);
        expect(membership(OWNER)).toBeNull();
    });

    it('keeps requests serial and discards old retry state across a sign-out and sign-in', async () => {
        signIn();
        useRuntimeStore
            .getState()
            .setGameState({ currentLocationPlayerIds: [PLAYER] });
        let reject!: (error: unknown) => void;
        mocks.getGroups.mockReturnValueOnce(
            new Promise((_, rejectRequest) => {
                reject = rejectRequest;
            })
        );
        stop = startUserGroupSync();
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(1000);
        expect(mocks.getGroups).toHaveBeenCalledTimes(1);
        useSessionStore.getState().setSessionPhase('signed_out');
        signIn();
        reject(new Error('Old connection failed'));
        await vi.advanceTimersByTimeAsync(500);
        expect(mocks.getGroups).toHaveBeenCalledTimes(2);
        expect(membership(PLAYER)).toBe(false);
    });

    it('stops queued work on sign-out and cleanup', async () => {
        signIn();
        useRuntimeStore
            .getState()
            .setGameState({ currentLocationPlayerIds: [PLAYER] });
        stop = startUserGroupSync();
        await vi.advanceTimersByTimeAsync(0);
        useSessionStore.getState().setSessionPhase('signed_out');
        await vi.advanceTimersByTimeAsync(60_000);
        expect(mocks.getGroups).toHaveBeenCalledTimes(1);
        signIn();
        stop();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(mocks.getGroups).toHaveBeenCalledTimes(1);
    });
});
