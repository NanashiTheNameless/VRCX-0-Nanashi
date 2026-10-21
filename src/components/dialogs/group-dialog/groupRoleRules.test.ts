import { describe, expect, it } from 'vitest';

import type { GroupRoleRecord } from '@/domain/entities/group';

import {
    canToggleOwnRole,
    groupRoleEditability,
    groupRoleForm,
    groupRoleMutation,
    planGroupRoleReorder,
    type GroupRoleViewer
} from './groupRoleRules';

const owner: GroupRoleRecord = {
    id: 'grol_owner',
    order: 0,
    permissions: ['*']
};
const admin: GroupRoleRecord = {
    id: 'grol_admin',
    order: 1,
    isManagementRole: true,
    permissions: ['group-roles-manage']
};
const mod: GroupRoleRecord = {
    id: 'grol_mod',
    order: 2,
    isManagementRole: true,
    permissions: ['group-members-manage']
};
const fan: GroupRoleRecord = {
    id: 'grol_fan',
    order: 3,
    isSelfAssignable: true
};
const guest: GroupRoleRecord = { id: 'grol_guest', order: 4 };
const member: GroupRoleRecord = {
    id: 'grol_member',
    order: 5,
    defaultRole: true
};
const roles = [owner, admin, mod, fan, guest, member];

const adminViewer: GroupRoleViewer = {
    canManage: true,
    canManageDefaultRole: true,
    canAssignRoles: true,
    myRoleIds: ['grol_admin'],
    isMember: true
};

describe('groupRoleRules', () => {
    it('only lets managers edit roles ranked below their own', () => {
        expect(groupRoleEditability(mod, roles, adminViewer).readOnly).toBe(
            false
        );
        expect(groupRoleEditability(admin, roles, adminViewer).readOnly).toBe(
            true
        );
        expect(groupRoleEditability(owner, roles, adminViewer).readOnly).toBe(
            true
        );
        expect(
            groupRoleEditability(mod, roles, {
                ...adminViewer,
                canManage: false
            }).readOnly
        ).toBe(true);
    });

    it('limits the default role to permission changes', () => {
        const editability = groupRoleEditability(member, roles, adminViewer);

        expect(editability).toEqual({
            readOnly: false,
            detailsReadOnly: true,
            flagsReadOnly: true,
            permissionsReadOnly: false
        });
        expect(
            groupRoleMutation(
                {
                    ...groupRoleForm(member),
                    permissions: ['group-galleries-manage']
                },
                editability
            )
        ).toEqual({ permissions: ['group-galleries-manage'] });
    });

    it('sends trimmed details, flags and permissions for an editable role', () => {
        const form = {
            ...groupRoleForm(guest),
            name: ' Guests ',
            description: ' Visitors ',
            isAddedOnJoin: true,
            permissions: ['*', 'group-instance-join']
        };

        expect(
            groupRoleMutation(
                form,
                groupRoleEditability(guest, roles, adminViewer)
            )
        ).toEqual({
            name: 'Guests',
            description: 'Visitors',
            requiresTwoFactor: false,
            isSelfAssignable: false,
            isAddedOnJoin: true,
            requiresPurchase: false,
            permissions: ['group-instance-join']
        });
    });

    it('offers self assignment for self-assignable or assignable lower roles', () => {
        const plainMember: GroupRoleViewer = {
            canManage: false,
            canManageDefaultRole: false,
            canAssignRoles: false,
            myRoleIds: [],
            isMember: true
        };

        expect(canToggleOwnRole(fan, roles, plainMember)).toBe(true);
        expect(canToggleOwnRole(guest, roles, plainMember)).toBe(false);
        expect(canToggleOwnRole(guest, roles, adminViewer)).toBe(true);
        expect(canToggleOwnRole(member, roles, adminViewer)).toBe(false);
        expect(
            canToggleOwnRole(fan, roles, { ...plainMember, isMember: false })
        ).toBe(false);
    });

    it('swaps orders inside a section and refuses to move locked roles', () => {
        expect(
            planGroupRoleReorder(
                roles,
                ['grol_fan', 'grol_guest', 'grol_member'],
                'grol_guest',
                'grol_fan',
                adminViewer
            )
        ).toEqual([
            { roleId: 'grol_guest', order: 3 },
            { roleId: 'grol_fan', order: 4 }
        ]);
        expect(
            planGroupRoleReorder(
                roles,
                ['grol_fan', 'grol_guest', 'grol_member'],
                'grol_member',
                'grol_fan',
                adminViewer
            )
        ).toBeNull();
    });
});
