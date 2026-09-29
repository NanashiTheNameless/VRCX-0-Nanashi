import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { commands } from '@/platform/tauri/bindings';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import { parseLocation } from '@/shared/utils/location';
import { useRuntimeStore } from '@/state/runtimeStore';

import { playerGroupRoles, playerGroupRoster } from './playerListGroupRoles';
import type { PlayerListRow } from './playerListTypes';

export function usePlayerListGroupRoles(
    location: string,
    rows: readonly PlayerListRow[],
    enabled: boolean
) {
    const queryClient = useQueryClient();
    const ownerId = useRuntimeStore((state) => state.auth.currentUserId);
    const endpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const context = JSON.stringify([ownerId, endpoint, location]);
    const [selection, setSelection] = useState({ context, value: 'auto' });
    const selectedGroup =
        selection.context === context ? selection.value : 'auto';
    const instanceGroupId = parseLocation(location).groupId || '';
    const groupId = selectedGroup === 'auto' ? instanceGroupId : selectedGroup;
    const active = Boolean(enabled && ownerId && groupId);
    const rosterKey = ['player-list-group', ownerId, endpoint, groupId];
    const roster = useQuery({
        queryKey: rosterKey,
        enabled: active,
        retry: false,
        staleTime: Infinity,
        refetchOnWindowFocus: false,
        queryFn: async () =>
            playerGroupRoster(
                await groupProfileRepository.getGroupProfile({
                    groupId,
                    includeRoles: true
                })
            )
    });
    const userIds = useMemo(
        () => [...new Set(rows.map((row) => row.userId).filter(Boolean))],
        [rows]
    );
    const looked = useQueries({
        queries: userIds.map((userId) => ({
            queryKey: [...rosterKey, userId],
            enabled: active,
            retry: false,
            staleTime: Infinity,
            refetchOnWindowFocus: false,
            queryFn: () =>
                commands.appVrchatGroupMemberRoleIdsGet({ groupId, userId })
        })),
        combine: (results) => results.map((result) => result.data)
    });
    const members = useMemo(
        () => new Map(userIds.map((userId, index) => [userId, looked[index]])),
        [looked, userIds]
    );
    const enrichedRows = useMemo(
        () =>
            rows.map((row) => ({
                ...row,
                groupRoles: roster.data
                    ? playerGroupRoles(
                          roster.data,
                          members.get(row.userId),
                          row.userId
                      )
                    : null
            })),
        [members, roster.data, rows]
    );

    return {
        rows: enrichedRows,
        selectedGroup,
        groupId,
        instanceGroupId,
        selectGroup: (value: string) => setSelection({ context, value }),
        refresh: () =>
            void queryClient.invalidateQueries({ queryKey: rosterKey })
    };
}
