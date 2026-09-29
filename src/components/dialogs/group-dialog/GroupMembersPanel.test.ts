import { describe, expect, it } from 'vitest';

import { normalize } from '@/repositories/group-profile/profile';

import { staffRoleIdsOf } from './GroupMembersPanel';

function groupWithRoles(roles: unknown[]) {
    return normalize({ id: 'grp_1', roles });
}

describe('staffRoleIdsOf', () => {
    it('lists management and permission roles by their group order', () => {
        expect(
            staffRoleIdsOf(
                groupWithRoles([
                    { id: 'grol_mod', order: 2, permissions: ['group-bans'] },
                    { id: 'grol_owner', order: 0, isManagementRole: true },
                    { id: 'grol_member', order: 5, permissions: [] },
                    { id: 'grol_admin', order: 1, isManagementRole: true }
                ])
            )
        ).toEqual(['grol_owner', 'grol_admin', 'grol_mod']);
    });

    it('skips roles without an id and ranks roles without a numeric order last', () => {
        expect(
            staffRoleIdsOf(
                groupWithRoles([
                    {
                        id: 'grol_unordered',
                        order: 'first',
                        isManagementRole: true
                    },
                    { name: 'No id', order: 0, isManagementRole: true },
                    null,
                    { id: 'grol_admin', order: 1, isManagementRole: 'yes' },
                    { id: 'grol_owner', order: 0, isManagementRole: true }
                ])
            )
        ).toEqual(['grol_owner', 'grol_unordered']);
    });

    it('returns no staff roles when the group has not loaded', () => {
        expect(staffRoleIdsOf(null)).toEqual([]);
    });
});
