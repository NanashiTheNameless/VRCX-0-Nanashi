import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';

import { VRCHAT_STAFF_GROUP_ID } from '@/shared/constants/user';

import {
    flushUserGroupMembershipCache,
    groupIdsFromUserGroupData,
    groupMembership,
    recordUserGroups,
    resetUserGroupMembershipStoreForTests,
    setPinnedUserGroupIds,
    setTrackedGroupIds,
    trackUserGroupMembership,
    useUserGroupMembershipStore
} from './userGroupMembershipStore';

const USER = 'usr_44444444-4444-4444-4444-444444444444';
const OTHER = 'grp_00000000-0000-0000-0000-000000000001';
const UNTRACKED = 'grp_00000000-0000-0000-0000-000000000002';

function entry(userId = USER) {
    return useUserGroupMembershipStore.getState().byUser.get(userId);
}

describe('userGroupMembershipStore', () => {
    beforeEach(() => {
        resetUserGroupMembershipStoreForTests();
        localStorage.clear();
    });

    it('reads group ids from raw user group rows and the overview', () => {
        expect(
            groupIdsFromUserGroupData([
                { id: 'gmem_1', groupId: VRCHAT_STAFF_GROUP_ID },
                { id: OTHER }
            ])
        ).toEqual([VRCHAT_STAFF_GROUP_ID, OTHER]);
        expect(
            groupIdsFromUserGroupData({ groups: [{ groupId: OTHER }] })
        ).toEqual([OTHER]);
        expect(groupIdsFromUserGroupData({ name: 'not a list' })).toBeNull();
    });

    it('answers from the full list this session and unknown before it', () => {
        expect(groupMembership(entry(), OTHER)).toBeNull();
        recordUserGroups(USER, [OTHER]);
        expect(groupMembership(entry(), OTHER)).toBe(true);
        expect(groupMembership(entry(), UNTRACKED)).toBe(false);
        expect(groupMembership(entry(), VRCHAT_STAFF_GROUP_ID)).toBe(false);
    });

    it('remembers only tracked groups across restarts', () => {
        setTrackedGroupIds([OTHER]);
        recordUserGroups(USER, [OTHER, UNTRACKED]);
        expect(localStorage.getItem('vrcx0.userGroupMembership')).toBeNull();
        flushUserGroupMembershipCache();
        const saved = JSON.parse(
            localStorage.getItem('vrcx0.userGroupMembership') || '{}'
        );
        expect(saved[USER].in).toEqual([OTHER]);
        expect(saved[USER].out).toEqual([VRCHAT_STAFF_GROUP_ID]);
        expect(JSON.stringify(saved)).not.toContain(UNTRACKED);
    });

    it('keeps at most 2000 users in memory, dropping the oldest', () => {
        const userId = (index: number) =>
            `usr_${String(index).padStart(8, '0')}`;
        for (let index = 0; index <= 2000; index += 1) {
            recordUserGroups(userId(index), [OTHER]);
        }
        const { byUser } = useUserGroupMembershipStore.getState();
        expect(byUser.size).toBe(2000);
        expect(byUser.has(userId(0))).toBe(false);
        expect(byUser.has(userId(2000))).toBe(true);
    });

    it('updates when a user leaves a group', () => {
        recordUserGroups(USER, [VRCHAT_STAFF_GROUP_ID]);
        expect(groupMembership(entry(), VRCHAT_STAFF_GROUP_ID)).toBe(true);
        recordUserGroups(USER, []);
        expect(groupMembership(entry(), VRCHAT_STAFF_GROUP_ID)).toBe(false);
    });

    it('keeps current players when initializing more users than the cache holds', () => {
        setPinnedUserGroupIds([USER]);
        recordUserGroups(USER, [VRCHAT_STAFF_GROUP_ID]);
        for (let index = 0; index < 2000; index++) {
            recordUserGroups(`usr_${index}`, []);
        }
        expect(useUserGroupMembershipStore.getState().byUser.size).toBe(2000);
        expect(groupMembership(entry(), VRCHAT_STAFF_GROUP_ID)).toBe(true);
        expect(entry('usr_0')).toBeUndefined();

        setPinnedUserGroupIds([]);
        recordUserGroups('usr_next', []);
        expect(entry()).toBeUndefined();
    });

    it('learns from user group lists loaded anywhere in the app', () => {
        const client = new QueryClient();
        client.setQueryData(
            ['user', 'usr_existing', 'groups'],
            [{ groupId: OTHER }]
        );
        trackUserGroupMembership(client);
        expect(groupMembership(entry('usr_existing'), OTHER)).toBe(true);

        client.setQueryData(
            ['user', USER, 'groupsOverview', { endpoint: 'x' }],
            { groups: [{ groupId: VRCHAT_STAFF_GROUP_ID }] }
        );
        expect(groupMembership(entry(), VRCHAT_STAFF_GROUP_ID)).toBe(true);

        client.setQueryData(['world', 'wrld_x'], [{ groupId: OTHER }]);
        expect(useUserGroupMembershipStore.getState().byUser.size).toBe(2);
    });
});
