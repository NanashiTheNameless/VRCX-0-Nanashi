// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GroupProfileRecord } from '@/domain/entities/group';
import type { EntityRecord } from '@/domain/entities/shared';

const mocks = vi.hoisted(() => ({
    appVrchatGroupDelete: vi.fn(),
    appVrchatGroupUpdate: vi.fn(),
    closeDialog: vi.fn(),
    confirm: vi.fn(),
    toastAdd: vi.fn(),
    enrichEntityDialogHistory: vi.fn(),
    getGroupProfile: vi.fn(),
    joinGroup: vi.fn(),
    leaveGroup: vi.fn(),
    setGroupMemberProps: vi.fn(),
    setGroupRepresentation: vi.fn(),
    getPreviousInstancesByGroupId: vi.fn(),
    normalize: vi.fn(),
    recordLocationHintsFromInstances: vi.fn(),
    updateEntityDialogMetadata: vi.fn()
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: mocks.toastAdd }
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appVrchatGroupDelete: mocks.appVrchatGroupDelete,
        appVrchatGroupUpdate: mocks.appVrchatGroupUpdate
    }
}));

vi.mock('@/repositories/gameLogRepository', () => ({
    default: {
        getPreviousInstancesByGroupId: mocks.getPreviousInstancesByGroupId
    }
}));

vi.mock('@/repositories/groupProfileRepository', () => ({
    default: {
        getGroupProfile: mocks.getGroupProfile,
        joinGroup: mocks.joinGroup,
        leaveGroup: mocks.leaveGroup,
        setGroupMemberProps: mocks.setGroupMemberProps,
        setGroupRepresentation: mocks.setGroupRepresentation,
        normalize: mocks.normalize
    }
}));

vi.mock('@/services/dialogService', () => ({
    enrichEntityDialogHistory: mocks.enrichEntityDialogHistory
}));

vi.mock('@/services/domainIngestionService', () => ({
    recordLocationHintsFromInstances: mocks.recordLocationHintsFromInstances
}));

vi.mock('@/services/entityMediaService', () => ({
    convertFileUrlToImageUrl: (url: string) => url
}));

vi.mock('@/state/dialogStore', () => ({
    useDialogStore: <T,>(
        selector: (state: {
            closeDialog: typeof mocks.closeDialog;
            updateEntityDialogMetadata: typeof mocks.updateEntityDialogMetadata;
        }) => T
    ): T =>
        selector({
            closeDialog: mocks.closeDialog,
            updateEntityDialogMetadata: mocks.updateEntityDialogMetadata
        })
}));

vi.mock('@/state/friendRosterStore', () => ({
    useFriendRosterStore: <T,>(
        selector: (state: { friendsById: Record<string, never> }) => T
    ): T => selector({ friendsById: {} })
}));

vi.mock('@/state/modalStore', () => ({
    useModalStore: <T,>(
        selector: (state: { confirm: typeof mocks.confirm }) => T
    ): T => selector({ confirm: mocks.confirm })
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: <T,>(
        selector: (state: {
            auth: {
                currentUserEndpoint: string;
                currentUserId: string;
                currentUserSnapshot: null;
            };
            gameState: { currentLocation: string };
            groupInstances: {
                endpoint: string;
                instances: Array<Record<string, unknown>>;
                userId: string;
            };
        }) => T
    ): T =>
        selector({
            auth: {
                currentUserEndpoint: 'https://api.example.test',
                currentUserId: 'usr_current',
                currentUserSnapshot: null
            },
            gameState: { currentLocation: '' },
            groupInstances: {
                endpoint: 'https://api.example.test',
                instances: [
                    {
                        group: { id: 'grp_test' },
                        instance: {
                            capacity: 60,
                            location: 'wrld_open:1~group(grp_test)',
                            userCount: 0
                        }
                    },
                    {
                        active: false,
                        group: { id: 'grp_test' },
                        location: 'wrld_closed:1~group(grp_test)'
                    },
                    {
                        group: { id: 'grp_other' },
                        location: 'wrld_other:1~group(grp_other)'
                    }
                ],
                userId: 'usr_current'
            }
        })
}));

import { useMyGroupsRevisionStore } from '@/state/myGroupsRevisionStore';

import { useGroupDialogState } from './useGroupDialogState';

const baseGroup: GroupProfileRecord = {
    bannerUrl: '',
    description: '',
    discriminator: '',
    displayName: 'Seed group',
    iconUrl: '',
    id: 'grp_test',
    languages: [],
    links: [],
    memberCount: 1,
    membershipStatus: 'member',
    name: 'Seed group',
    onlineMemberCount: 0,
    ownerDisplayName: 'Owner',
    ownerId: 'usr_owner',
    privacy: 'default',
    roles: [],
    rules: '',
    shortCode: 'TEST',
    tags: [],
    url: ''
};

describe('useGroupDialogState instance loading', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.normalize.mockImplementation(
            (value: EntityRecord): GroupProfileRecord => ({
                ...baseGroup,
                ...value
            })
        );
        mocks.getGroupProfile.mockResolvedValue({
            ...baseGroup,
            displayName: 'Remote group',
            name: 'Remote group'
        });
        mocks.getPreviousInstancesByGroupId.mockResolvedValue(new Map());
    });

    it('uses the shared runtime group instance projection', async () => {
        const { result } = renderHook(() =>
            useGroupDialogState({
                groupId: 'grp_test',
                seedData: baseGroup
            })
        );

        await waitFor(() => {
            expect(mocks.getGroupProfile).toHaveBeenCalledOnce();
            expect(mocks.updateEntityDialogMetadata).toHaveBeenCalledWith(
                expect.objectContaining({ title: 'Remote group' })
            );
        });

        expect(result.current).toMatchObject({
            activeInstances: [
                {
                    capacity: 60,
                    location: 'wrld_open:1~group(grp_test)',
                    userCount: 0
                }
            ]
        });
    });
});

describe('useGroupDialogState profile updates', () => {
    const params = {
        name: 'Renamed group',
        shortCode: 'TEST',
        description: '',
        joinState: 'open' as const,
        languages: [],
        rules: '',
        links: [],
        iconId: 'file_icon',
        bannerId: null,
        allowGroupJoinPrompt: false
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.normalize.mockImplementation(
            (value: EntityRecord): GroupProfileRecord => ({
                ...baseGroup,
                ...value
            })
        );
        mocks.getGroupProfile.mockResolvedValue(baseGroup);
        mocks.getPreviousInstancesByGroupId.mockResolvedValue(new Map());
    });

    async function renderLoadedGroup() {
        const rendered = renderHook(() =>
            useGroupDialogState({ groupId: 'grp_test', seedData: baseGroup })
        );
        await waitFor(() => {
            expect(mocks.getGroupProfile).toHaveBeenCalledOnce();
        });
        return rendered;
    }

    it('saves the whole profile and shows the refreshed group', async () => {
        mocks.appVrchatGroupUpdate.mockResolvedValue({
            status: 200,
            data: '{"id":"grp_test"}'
        });
        const { result } = await renderLoadedGroup();
        mocks.getGroupProfile.mockResolvedValue({
            ...baseGroup,
            name: 'Renamed group'
        });

        const revision = useMyGroupsRevisionStore.getState().revision;
        let saved = false;
        await act(async () => {
            const { actions } = result.current;
            if (!actions) {
                throw new Error('Group dialog actions are unavailable.');
            }
            saved = await actions.updateGroupProfile(params);
        });

        expect(saved).toBe(true);
        expect(mocks.appVrchatGroupUpdate).toHaveBeenCalledWith({
            groupId: 'grp_test',
            params
        });
        expect(mocks.getGroupProfile).toHaveBeenLastCalledWith({
            groupId: 'grp_test',
            force: true
        });
        expect(result.current.group?.name).toBe('Renamed group');
        expect(useMyGroupsRevisionStore.getState().revision).toBe(revision + 1);
        expect(result.current.actionStatus).toBe('idle');
    });

    it('reports a rejected save and keeps the current group', async () => {
        mocks.appVrchatGroupUpdate.mockResolvedValue({
            status: 403,
            data: '{"error":{"message":"Missing permission","status_code":403}}'
        });
        const { result } = await renderLoadedGroup();

        let saved = true;
        await act(async () => {
            const { actions } = result.current;
            if (!actions) {
                throw new Error('Group dialog actions are unavailable.');
            }
            saved = await actions.updateGroupProfile(params);
        });

        expect(saved).toBe(false);
        expect(mocks.getGroupProfile).toHaveBeenCalledOnce();
        expect(mocks.toastAdd).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'error' })
        );
        expect(result.current.actionStatus).toBe('idle');
    });
});

describe('useGroupDialogState group deletion', () => {
    const ownedGroup: GroupProfileRecord = {
        ...baseGroup,
        ownerId: 'usr_current',
        memberCount: 1
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.normalize.mockImplementation(
            (value: EntityRecord): GroupProfileRecord => ({
                ...baseGroup,
                ...value
            })
        );
        mocks.getGroupProfile.mockResolvedValue(ownedGroup);
        mocks.getPreviousInstancesByGroupId.mockResolvedValue(new Map());
        mocks.appVrchatGroupDelete.mockResolvedValue({
            status: 200,
            data: '{"success":{"message":"Group deleted","status_code":200}}'
        });
    });

    async function deleteOwnedGroup() {
        const { result } = renderHook(() =>
            useGroupDialogState({ groupId: 'grp_test', seedData: ownedGroup })
        );
        await waitFor(() => {
            expect(mocks.getGroupProfile).toHaveBeenCalledOnce();
        });
        await act(async () => {
            const { actions } = result.current;
            if (!actions) {
                throw new Error('Group dialog actions are unavailable.');
            }
            await actions.deleteGroup();
        });
        return result;
    }

    it('deletes the group after the last member confirms and closes the dialog', async () => {
        mocks.confirm.mockResolvedValue({ ok: true });
        const revision = useMyGroupsRevisionStore.getState().revision;

        await deleteOwnedGroup();

        expect(mocks.confirm).toHaveBeenCalledWith(
            expect.objectContaining({ destructive: true })
        );
        expect(mocks.appVrchatGroupDelete).toHaveBeenCalledWith({
            groupId: 'grp_test'
        });
        expect(mocks.closeDialog).toHaveBeenCalledOnce();
        expect(useMyGroupsRevisionStore.getState().revision).toBe(revision + 1);
    });

    it('keeps the group when the owner cancels', async () => {
        mocks.confirm.mockResolvedValue({ ok: false });
        const revision = useMyGroupsRevisionStore.getState().revision;

        const result = await deleteOwnedGroup();

        expect(mocks.appVrchatGroupDelete).not.toHaveBeenCalled();
        expect(mocks.closeDialog).not.toHaveBeenCalled();
        expect(result.current.actionStatus).toBe('idle');
        expect(useMyGroupsRevisionStore.getState().revision).toBe(revision);
    });
});

describe('useGroupDialogState My Groups sync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.normalize.mockImplementation(
            (value: EntityRecord): GroupProfileRecord => ({
                ...baseGroup,
                ...value
            })
        );
        mocks.getPreviousInstancesByGroupId.mockResolvedValue(new Map());
        mocks.confirm.mockResolvedValue({ ok: true });
        mocks.joinGroup.mockResolvedValue({
            json: { membershipStatus: 'member' },
            status: 200
        });
        mocks.leaveGroup.mockResolvedValue({ json: {}, status: 200 });
        mocks.setGroupRepresentation.mockResolvedValue({ json: {} });
        mocks.setGroupMemberProps.mockResolvedValue({ json: {} });
    });

    async function runAction(
        group: GroupProfileRecord,
        action: (
            actions: NonNullable<
                ReturnType<typeof useGroupDialogState>['actions']
            >
        ) => Promise<unknown>
    ) {
        mocks.getGroupProfile.mockResolvedValue(group);
        const { result } = renderHook(() =>
            useGroupDialogState({ groupId: 'grp_test', seedData: group })
        );
        await waitFor(() => {
            expect(mocks.getGroupProfile).toHaveBeenCalledOnce();
        });
        const revision = useMyGroupsRevisionStore.getState().revision;
        await act(async () => {
            const { actions } = result.current;
            if (!actions) {
                throw new Error('Group dialog actions are unavailable.');
            }
            await action(actions);
        });
        return useMyGroupsRevisionStore.getState().revision - revision;
    }

    it('updates My Groups after a member leaves', async () => {
        expect(
            await runAction(baseGroup, (actions) => actions.leaveGroup())
        ).toBe(1);
        expect(mocks.leaveGroup).toHaveBeenCalledWith({ groupId: 'grp_test' });
    });

    it('updates My Groups after joining an open group', async () => {
        expect(
            await runAction(
                {
                    ...baseGroup,
                    joinState: 'open',
                    membershipStatus: 'inactive'
                },
                (actions) => actions.joinGroup()
            )
        ).toBe(1);
        expect(mocks.joinGroup).toHaveBeenCalledWith({ groupId: 'grp_test' });
    });

    it('updates My Groups after representing the group', async () => {
        expect(
            await runAction(baseGroup, (actions) =>
                actions.updateGroupRepresentation(true)
            )
        ).toBe(1);
    });

    it('updates My Groups after changing member visibility', async () => {
        expect(
            await runAction(baseGroup, (actions) =>
                actions.updateGroupMemberProps(
                    { visibility: 'friends' },
                    'visibility updated'
                )
            )
        ).toBe(1);
    });
});
