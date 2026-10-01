// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type RuntimeAuthState = {
    auth: {
        currentUserEndpoint: string;
        currentUserId: string;
        currentUserSnapshot: null;
    };
};

const runtimeState: RuntimeAuthState = {
    auth: {
        currentUserEndpoint: 'https://api.vrchat.cloud',
        currentUserId: '',
        currentUserSnapshot: null
    }
};

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: <T>(selector: (state: RuntimeAuthState) => T): T =>
        selector(runtimeState)
}));

import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useUserFactsStore } from '@/state/userFactsStore';
import { onlinePresence, pendingPresence } from '@/test/presenceFixtures';

import { useKnownUserFact, useKnownUserFacts } from './useKnownUser';

const endpoint = runtimeState.auth.currentUserEndpoint;

function replaceFact(userId: string, displayName: string) {
    act(() => {
        useUserFactsStore.getState().replaceUserFacts([
            {
                id: userId,
                endpoint,
                displayName
            }
        ]);
    });
}

describe('useKnownUserFacts', () => {
    beforeEach(() => {
        useUserFactsStore.getState().resetUserFacts();
        useFriendRosterStore.getState().resetRoster();
    });

    it('resolves facts for the requested user ids', () => {
        replaceFact('usr_1', 'Alice');
        const userIds = ['usr_1', 'usr_2'];
        const { result } = renderHook(() => useKnownUserFacts(userIds));

        expect(result.current.usr_1?.displayName).toBe('Alice');
        expect(result.current.usr_2).toBeUndefined();
    });

    it('does not re-render when unrelated user facts change', () => {
        replaceFact('usr_1', 'Alice');
        const userIds = ['usr_1'];
        let renderCount = 0;
        const { result } = renderHook(() => {
            renderCount += 1;
            return useKnownUserFacts(userIds);
        });

        replaceFact('usr_other', 'Someone');

        expect(renderCount).toBe(1);
        expect(result.current.usr_1?.displayName).toBe('Alice');
    });

    it('re-renders when a requested user fact changes', () => {
        replaceFact('usr_1', 'Alice');
        const userIds = ['usr_1'];
        const { result } = renderHook(() => useKnownUserFacts(userIds));

        replaceFact('usr_1', 'Alicia');

        expect(result.current.usr_1?.displayName).toBe('Alicia');
    });

    it('reads friend presence from the roster instead of the stateless fact view', () => {
        act(() => {
            useUserFactsStore.getState().replaceUserFacts([
                {
                    id: 'usr_friend',
                    endpoint,
                    displayName: 'Friend',
                    $presence: onlinePresence('wrld_a:1')
                },
                {
                    id: 'usr_stranger',
                    endpoint,
                    $presence: onlinePresence('wrld_b:2')
                }
            ]);
            useFriendRosterStore.getState().applyFriendPatch({
                userId: 'usr_friend',
                patch: { id: 'usr_friend' },
                presence: { rev: 1, view: pendingPresence('wrld_a:1') }
            });
        });
        const userIds = ['usr_friend', 'usr_stranger'];
        const { result } = renderHook(() => ({
            facts: useKnownUserFacts(userIds),
            fact: useKnownUserFact('usr_friend')
        }));

        expect(result.current.facts.usr_friend?.$presence).toEqual(
            pendingPresence('wrld_a:1')
        );
        expect(result.current.facts.usr_friend?.displayName).toBe('Friend');
        expect(result.current.fact?.$presence).toEqual(
            pendingPresence('wrld_a:1')
        );
        expect(result.current.facts.usr_stranger?.$presence).toEqual(
            onlinePresence('wrld_b:2')
        );
    });
});
