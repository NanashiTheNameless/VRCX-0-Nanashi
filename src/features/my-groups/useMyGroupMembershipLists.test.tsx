// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const commandMocks = vi.hoisted(() => ({
    appVrchatGroupMembershipListGet: vi.fn(),
    appVrchatGroupInviteDecline: vi.fn()
}));

const repositoryMocks = vi.hoisted(() => ({
    normalize: (row: Record<string, unknown>) => ({
        ...row,
        id: row.groupId
    }),
    joinGroup: vi.fn(),
    cancelGroupRequest: vi.fn(),
    blockGroup: vi.fn(),
    unblockGroup: vi.fn()
}));

const confirmMock = vi.hoisted(() => vi.fn());

vi.mock('@/platform/tauri/bindings', () => ({
    commands: commandMocks
}));
vi.mock('@/repositories/groupProfileRepository', () => ({
    default: repositoryMocks
}));
vi.mock('@/state/modalStore', () => ({
    useModalStore: (selector: (state: { confirm: unknown }) => unknown) =>
        selector({ confirm: confirmMock })
}));
vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn() }
}));

import { useMyGroupsRevisionStore } from '@/state/myGroupsRevisionStore';

import { useMyGroupMembershipLists } from './useMyGroupMembershipLists';

function okResponse(json: unknown) {
    return { status: 200, data: JSON.stringify(json) };
}

const rowsByStatus: Record<string, unknown[]> = {
    invited: [{ id: 'gmem_1', groupId: 'grp_invite', name: 'Invite' }],
    requested: [{ id: 'gmem_2', groupId: 'grp_request', name: 'Request' }],
    userblocked: [{ id: 'gmem_3', groupId: 'grp_blocked', name: 'Blocked' }]
};

describe('useMyGroupMembershipLists', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        useMyGroupsRevisionStore.setState({ revision: 0 });
        commandMocks.appVrchatGroupMembershipListGet.mockImplementation(
            async ({ status }: { status: string }) =>
                okResponse(rowsByStatus[status])
        );
        commandMocks.appVrchatGroupInviteDecline.mockResolvedValue(
            okResponse({})
        );
        repositoryMocks.joinGroup.mockResolvedValue({});
        repositoryMocks.blockGroup.mockResolvedValue({});
        confirmMock.mockResolvedValue({ ok: true });
    });

    afterEach(() => {
        cleanup();
    });

    async function renderLoaded() {
        const hook = renderHook(() => useMyGroupMembershipLists('usr_self'));
        await waitFor(() => expect(hook.result.current.status).toBe('ready'));
        return hook;
    }

    it('loads invitations, requests and blocked groups by their real group id', async () => {
        const { result } = await renderLoaded();

        expect(result.current.lists.invited.map((row) => row.id)).toEqual([
            'grp_invite'
        ]);
        expect(result.current.lists.requested[0]?.membershipKind).toBe(
            'requested'
        );
        expect(result.current.lists.blocked[0]?.membershipKind).toBe('blocked');
    });

    it('accepting an invite joins the group and refreshes my groups', async () => {
        const { result } = await renderLoaded();

        await act(() =>
            result.current.acceptInvite(result.current.lists.invited[0]!)
        );

        expect(repositoryMocks.joinGroup).toHaveBeenCalledWith({
            groupId: 'grp_invite'
        });
        expect(result.current.lists.invited).toEqual([]);
        expect(useMyGroupsRevisionStore.getState().revision).toBe(1);
    });

    it('declining an invite removes the current user membership record', async () => {
        const { result } = await renderLoaded();

        await act(() =>
            result.current.declineInvite(result.current.lists.invited[0]!)
        );

        expect(commandMocks.appVrchatGroupInviteDecline).toHaveBeenCalledWith({
            groupId: 'grp_invite',
            userId: 'usr_self'
        });
        expect(result.current.lists.invited).toEqual([]);
    });

    it('blocking an invite moves the group into the blocked list', async () => {
        const { result } = await renderLoaded();

        await act(() =>
            result.current.blockGroup(result.current.lists.invited[0]!)
        );

        expect(repositoryMocks.blockGroup).toHaveBeenCalledWith({
            groupId: 'grp_invite'
        });
        expect(result.current.lists.invited).toEqual([]);
        expect(result.current.lists.blocked.map((row) => row.id)).toEqual([
            'grp_invite',
            'grp_blocked'
        ]);
    });
});
