import type { GroupProfileRecord } from '@/domain/entities/group';

export interface PlayerGroupRole {
    id: string;
    name: string;
    order?: number;
}

export interface PlayerGroupRoster {
    ownerId: string;
    roles: PlayerGroupRole[];
}

export function playerGroupRoster(
    group: Pick<GroupProfileRecord, 'roles' | 'ownerId'>
): PlayerGroupRoster {
    const roles: PlayerGroupRole[] = [];
    for (const role of group.roles) {
        if (typeof role.id !== 'string' || typeof role.name !== 'string')
            continue;
        roles.push({
            id: role.id,
            name: role.name,
            order:
                typeof role.order === 'number' && Number.isFinite(role.order)
                    ? role.order
                    : undefined
        });
    }
    return { ownerId: group.ownerId, roles };
}

export function playerGroupRoles(
    roster: PlayerGroupRoster,
    roleIds: readonly string[] | null | undefined,
    userId: string
): PlayerGroupRole[] | null {
    if (!roleIds) return null;
    const owned = new Set(roleIds);
    return roster.roles
        .filter(
            (role) =>
                owned.has(role.id) ||
                (roster.ownerId === userId && role.order === 0)
        )
        .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
}

export function playerGroupRoleOrder(
    roles: readonly PlayerGroupRole[] | null | undefined
): number | undefined {
    if (!roles) return undefined;
    return roles.length
        ? roles.find((role) => role.order !== undefined)?.order
        : Number.MAX_SAFE_INTEGER;
}
