// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAppTable } from '@/components/data-table/appTable';
import type { GroupProfileRecord } from '@/domain/entities/group';
import { commands } from '@/platform/tauri/bindings';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import { useRuntimeStore } from '@/state/runtimeStore';

import { usePlayerListColumns } from './components/PlayerListColumns';
import { playerGroupRoles, playerGroupRoster } from './playerListGroupRoles';
import type { PlayerListRow } from './playerListTypes';
import { usePlayerListGroupRoles } from './usePlayerListGroupRoles';

vi.mock('@/platform/tauri/bindings', () => ({
    commands: { appVrchatGroupMemberRoleIdsGet: vi.fn() }
}));
vi.mock('@/repositories/groupProfileRepository', () => ({
    default: { getGroupProfile: vi.fn() }
}));
const roles = [
    { id: 'member', name: 'Member', order: 5 },
    { id: 'staff', name: 'Staff', order: 1 },
    { id: 'unknown', name: 'Unknown' }
];
const group = { ownerId: '', roles } as unknown as GroupProfileRecord;
const roster = playerGroupRoster(group);

function player(userId: string): PlayerListRow {
    return {
        userId,
        displayName: userId,
        userRef: null,
        trustLevel: '',
        trustSortNum: 0,
        trustClass: '',
        platformLabel: '',
        platformIcon: null,
        platformClassName: '',
        inVRMode: null,
        status: '',
        statusDescription: '',
        languages: [],
        bioLinks: [],
        note: '',
        avatarUrl: '',
        isCurrentUser: false,
        isFriend: false,
        isFavorite: false,
        isBlocked: false,
        isMuted: false,
        isAvatarInteractionDisabled: false,
        isChatBoxMuted: false,
        timeoutTime: 0,
        moderationSeverity: '',
        ageVerified: false,
        timerMs: 0,
        worldName: '',
        location: ''
    };
}

function renderRoles(initialRows: PlayerListRow[]) {
    useRuntimeStore.setState((state) => ({
        auth: { ...state.auth, currentUserId: 'owner', currentUserEndpoint: '' }
    }));
    vi.mocked(groupProfileRepository.getGroupProfile).mockResolvedValue(group);
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false } }
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const rendered = renderHook(
        ({ rows }) =>
            usePlayerListGroupRoles('wrld_test:1~group(grp_a)', rows, true),
        {
            initialProps: { rows: initialRows },
            wrapper
        }
    );
    return { ...rendered, client };
}

function roleNames(rows: readonly PlayerListRow[]) {
    return rows.map((row) => row.groupRoles?.map((role) => role.name) ?? null);
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('player list group roles', () => {
    it('matches role IDs and uses the group order, telling regular members from unknown ones', () => {
        expect(
            playerGroupRoles(
                roster,
                ['member', 'staff', 'missing'],
                'user'
            )?.map((role) => role.name)
        ).toEqual(['Staff', 'Member']);
        expect(playerGroupRoles(roster, [], 'user')).toEqual([]);
        expect(playerGroupRoles(roster, undefined, 'user')).toBeNull();
        expect(playerGroupRoles(roster, null, 'user')).toBeNull();
    });

    it.each([false, true])(
        'sorts by the highest role and keeps empty values last (descending %s)',
        (desc) => {
            const rows = ['member', 'staff', 'regular', 'unknown'].map(
                (id) => ({
                    ...player(id),
                    groupRoles:
                        id === 'unknown'
                            ? null
                            : playerGroupRoles(
                                  roster,
                                  id === 'regular' ? [] : [id],
                                  id
                              )
                })
            );
            const { result } = renderHook(() =>
                useAppTable({
                    data: rows,
                    columns: usePlayerListColumns(),
                    state: { sorting: [{ id: 'groupRoles', desc }] },
                    getRowId: (row) => row.userId
                })
            );
            expect(
                result.current
                    .getRowModel()
                    .rows.map((row) => row.original.userId)
            ).toEqual(
                desc
                    ? ['regular', 'member', 'staff', 'unknown']
                    : ['staff', 'member', 'regular', 'unknown']
            );
        }
    );

    it('looks up each newly seen player once, caches role IDs per player and refetches on refresh', async () => {
        const roleIdsByUser: Record<string, string[] | null> = {
            a: ['staff'],
            b: null,
            c: ['member']
        };
        vi.mocked(commands.appVrchatGroupMemberRoleIdsGet).mockImplementation(
            async ({ userId }) =>
                userId ? (roleIdsByUser[userId] ?? null) : null
        );
        const { result, rerender, client } = renderRoles([
            player('a'),
            player('b')
        ]);
        await waitFor(() =>
            expect(roleNames(result.current.rows)).toEqual([['Staff'], null])
        );
        expect(commands.appVrchatGroupMemberRoleIdsGet).toHaveBeenCalledTimes(
            2
        );
        expect(commands.appVrchatGroupMemberRoleIdsGet).toHaveBeenCalledWith({
            groupId: 'grp_a',
            userId: 'a'
        });
        expect(commands.appVrchatGroupMemberRoleIdsGet).toHaveBeenCalledWith({
            groupId: 'grp_a',
            userId: 'b'
        });

        rerender({ rows: [player('a'), player('b'), player('c')] });
        await waitFor(() =>
            expect(roleNames(result.current.rows)[2]).toEqual(['Member'])
        );
        expect(commands.appVrchatGroupMemberRoleIdsGet).toHaveBeenCalledTimes(
            3
        );
        expect(
            commands.appVrchatGroupMemberRoleIdsGet
        ).toHaveBeenLastCalledWith({
            groupId: 'grp_a',
            userId: 'c'
        });

        rerender({ rows: [player('c')] });
        rerender({ rows: [player('a'), player('c')] });
        await waitFor(() =>
            expect(roleNames(result.current.rows)[0]).toEqual(['Staff'])
        );
        expect(commands.appVrchatGroupMemberRoleIdsGet).toHaveBeenCalledTimes(
            3
        );

        act(() => result.current.refresh());
        await waitFor(() =>
            expect(
                commands.appVrchatGroupMemberRoleIdsGet
            ).toHaveBeenCalledTimes(5)
        );
        expect(
            vi
                .mocked(commands.appVrchatGroupMemberRoleIdsGet)
                .mock.calls.slice(3)
                .map(([input]) => input)
        ).toEqual([
            { groupId: 'grp_a', userId: 'a' },
            { groupId: 'grp_a', userId: 'c' }
        ]);

        act(() => result.current.selectGroup('grp_b'));
        expect(result.current.groupId).toBe('grp_b');
        expect(roleNames(result.current.rows)).toEqual([null, null]);
        await waitFor(() =>
            expect(
                commands.appVrchatGroupMemberRoleIdsGet
            ).toHaveBeenCalledWith({ groupId: 'grp_b', userId: 'c' })
        );
        client.clear();
    });

    it('shows no roles for a failed lookup without caching it, so refresh retries it', async () => {
        vi.mocked(commands.appVrchatGroupMemberRoleIdsGet).mockImplementation(
            async ({ userId }) => {
                if (userId === 'b') {
                    throw new Error('connection reset');
                }
                return ['staff'];
            }
        );
        const { result, client } = renderRoles([player('a'), player('b')]);
        await waitFor(() =>
            expect(roleNames(result.current.rows)).toEqual([['Staff'], null])
        );
        const failedKey = ['player-list-group', 'owner', '', 'grp_a', 'b'];
        await waitFor(() =>
            expect(client.getQueryState(failedKey)?.status).toBe('error')
        );
        expect(client.getQueryState(failedKey)?.data).toBeUndefined();

        vi.mocked(commands.appVrchatGroupMemberRoleIdsGet).mockResolvedValue([
            'member'
        ]);
        act(() => result.current.refresh());
        await waitFor(() =>
            expect(roleNames(result.current.rows)).toEqual([
                ['Member'],
                ['Member']
            ])
        );
        expect(client.getQueryData(failedKey)).toEqual(['member']);
        client.clear();
    });
});
