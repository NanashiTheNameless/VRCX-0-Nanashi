// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useFriendRosterStore } from '@/state/friendRosterStore';

import { useFriendMemberIds } from './useFriendMemberIds';

function patchFriend(id: string, status: string) {
    useFriendRosterStore.getState().applyFriendPatch({
        userId: id,
        patch: { id, displayName: id, state: 'online', status }
    });
}

beforeEach(() => {
    useFriendRosterStore.getState().resetRoster();
    patchFriend('usr_friend', 'active');
    patchFriend('usr_elsewhere', 'active');
});

afterEach(() => {
    cleanup();
    useFriendRosterStore.getState().resetRoster();
});

describe('useFriendMemberIds', () => {
    it('lists which loaded members are friends', () => {
        const { result } = renderHook(() =>
            useFriendMemberIds(['usr_friend', 'usr_stranger'])
        );

        expect([...result.current]).toEqual(['usr_friend']);
    });

    it('does not re-render when a friend only changes presence', () => {
        let renders = 0;
        const { result } = renderHook(() => {
            renders += 1;
            return useFriendMemberIds(['usr_friend', 'usr_stranger']);
        });
        const initial = result.current;
        const rendersBefore = renders;

        act(() => {
            patchFriend('usr_friend', 'busy');
            patchFriend('usr_elsewhere', 'join me');
        });

        expect(renders).toBe(rendersBefore);
        expect(result.current).toBe(initial);
    });

    it('picks up a member who becomes a friend', () => {
        const { result } = renderHook(() =>
            useFriendMemberIds(['usr_friend', 'usr_stranger'])
        );

        act(() => {
            patchFriend('usr_stranger', 'active');
        });

        expect([...result.current].sort()).toEqual([
            'usr_friend',
            'usr_stranger'
        ]);
    });
});
