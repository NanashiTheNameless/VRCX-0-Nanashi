import type { GroupRoleRecord } from '@/domain/entities/group';
import type { GroupRoleMutation } from '@/platform/tauri/bindings';
import { isRecord } from '@/shared/utils/record';

export const GROUP_ROLE_NAME_MAX = 64;
export const GROUP_ROLE_DESCRIPTION_MAX = 512;

export type GroupPermissionDefinition = {
    name: string;
    displayName: string;
    help: string;
    isManagementPermission: boolean;
    allowedToAdd: boolean;
};

export type GroupRoleForm = {
    name: string;
    description: string;
    isSelfAssignable: boolean;
    isAddedOnJoin: boolean;
    requiresTwoFactor: boolean;
    requiresPurchase: boolean;
    permissions: string[];
};

export type GroupRoleViewer = {
    canManage: boolean;
    canManageDefaultRole: boolean;
    canAssignRoles: boolean;
    myRoleIds: string[];
    isMember: boolean;
};

export type GroupRoleEditability = {
    readOnly: boolean;
    detailsReadOnly: boolean;
    flagsReadOnly: boolean;
    permissionsReadOnly: boolean;
};

export function stringList(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
}

function roleOrder(role: GroupRoleRecord) {
    return typeof role.order === 'number' ? role.order : 0;
}

export function sortGroupRoles(roles: GroupRoleRecord[]) {
    return [...roles].sort((a, b) => roleOrder(a) - roleOrder(b));
}

export function isOwnerRole(role: GroupRoleRecord | null | undefined) {
    return stringList(role?.permissions).includes('*');
}

export function isDefaultRole(role: GroupRoleRecord | null | undefined) {
    return role?.defaultRole === true;
}

export function myHighestRoleOrder(
    roles: GroupRoleRecord[],
    myRoleIds: string[]
) {
    const orders = roles
        .filter((role) => role.id && myRoleIds.includes(role.id))
        .map(roleOrder);
    return orders.length ? Math.min(...orders) : Infinity;
}

export function canModifyRole(
    role: GroupRoleRecord,
    roles: GroupRoleRecord[],
    viewer: GroupRoleViewer
) {
    if (isDefaultRole(role)) {
        return true;
    }
    if (isOwnerRole(role)) {
        return Boolean(role.id && viewer.myRoleIds.includes(role.id));
    }
    return roleOrder(role) > myHighestRoleOrder(roles, viewer.myRoleIds);
}

export function isLockedRole(
    role: GroupRoleRecord,
    roles: GroupRoleRecord[],
    viewer: GroupRoleViewer
) {
    return (
        isDefaultRole(role) ||
        isOwnerRole(role) ||
        !canModifyRole(role, roles, viewer)
    );
}

export function groupRoleEditability(
    role: GroupRoleRecord | null,
    roles: GroupRoleRecord[],
    viewer: GroupRoleViewer
): GroupRoleEditability {
    const isDefault = isDefaultRole(role);
    const isOwner = isOwnerRole(role);
    const readOnly =
        (isDefault ? !viewer.canManageDefaultRole : !viewer.canManage) ||
        (role !== null && !canModifyRole(role, roles, viewer));
    const detailsReadOnly = readOnly || isDefault;
    return {
        readOnly,
        detailsReadOnly,
        flagsReadOnly: detailsReadOnly || isOwner,
        permissionsReadOnly: readOnly || isOwner
    };
}

export function canToggleOwnRole(
    role: GroupRoleRecord,
    roles: GroupRoleRecord[],
    viewer: GroupRoleViewer
) {
    if (!viewer.isMember || isDefaultRole(role) || isOwnerRole(role)) {
        return false;
    }
    return (
        role.isSelfAssignable === true ||
        (viewer.canAssignRoles &&
            roleOrder(role) > myHighestRoleOrder(roles, viewer.myRoleIds))
    );
}

export function groupRoleForm(role: GroupRoleRecord | null): GroupRoleForm {
    return {
        name: role?.name || '',
        description: role?.description || '',
        isSelfAssignable: role?.isSelfAssignable === true,
        isAddedOnJoin: role?.isAddedOnJoin === true,
        requiresTwoFactor: role?.requiresTwoFactor === true,
        requiresPurchase: role?.requiresPurchase === true,
        permissions: stringList(role?.permissions)
    };
}

export function groupRoleMutation(
    form: GroupRoleForm,
    editability: GroupRoleEditability
): GroupRoleMutation {
    const mutation: GroupRoleMutation = {};
    if (!editability.detailsReadOnly) {
        mutation.name = form.name.trim();
        mutation.description = form.description.trim();
        mutation.requiresTwoFactor = form.requiresTwoFactor;
    }
    if (!editability.flagsReadOnly) {
        mutation.isSelfAssignable = form.isSelfAssignable;
        mutation.isAddedOnJoin = form.isAddedOnJoin;
        mutation.requiresPurchase = form.requiresPurchase;
    }
    if (!editability.permissionsReadOnly) {
        mutation.permissions = form.permissions.filter(
            (permission) => permission !== '*'
        );
    }
    return mutation;
}

export function groupPermissionDefinitions(
    value: unknown
): GroupPermissionDefinition[] {
    return (Array.isArray(value) ? value : [])
        .filter(isRecord)
        .map((permission) => ({
            name: typeof permission.name === 'string' ? permission.name : '',
            displayName:
                typeof permission.displayName === 'string'
                    ? permission.displayName
                    : '',
            help: typeof permission.help === 'string' ? permission.help : '',
            isManagementPermission: permission.isManagementPermission === true,
            allowedToAdd: permission.allowedToAdd === true
        }))
        .filter((permission) => permission.name && permission.name !== '*');
}

export function viewOnlyPermissionDefinitions(
    roles: GroupRoleRecord[]
): GroupPermissionDefinition[] {
    const names = new Set(
        roles.flatMap((role) => stringList(role.permissions))
    );
    names.delete('*');
    return [...names].sort().map((name) => ({
        name,
        displayName: name,
        help: '',
        isManagementPermission: false,
        allowedToAdd: false
    }));
}

export function planGroupRoleReorder(
    sortedRoles: GroupRoleRecord[],
    sectionRoleIds: string[],
    activeId: string,
    overId: string,
    viewer: GroupRoleViewer
): { roleId: string; order: number }[] | null {
    const fromIndex = sectionRoleIds.indexOf(activeId);
    const toIndex = sectionRoleIds.indexOf(overId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
        return null;
    }
    const nextSectionIds = [...sectionRoleIds];
    const [moved] = nextSectionIds.splice(fromIndex, 1);
    nextSectionIds.splice(toIndex, 0, moved ?? activeId);
    const rolesById = new Map(sortedRoles.map((role) => [role.id, role]));
    const sectionSet = new Set(sectionRoleIds);
    let sectionCursor = 0;
    const reordered = sortedRoles.map((role) =>
        role.id && sectionSet.has(role.id)
            ? (rolesById.get(nextSectionIds[sectionCursor++]) ?? role)
            : role
    );
    const lockedMoved = reordered.some(
        (role, index) =>
            role.id !== sortedRoles[index]?.id &&
            isLockedRole(role, sortedRoles, viewer)
    );
    if (lockedMoved) {
        return null;
    }
    const orders = sortedRoles.map(roleOrder);
    return reordered.flatMap((role, index) =>
        role.id && role.id !== sortedRoles[index]?.id
            ? [{ roleId: role.id, order: orders[index] ?? 0 }]
            : []
    );
}
