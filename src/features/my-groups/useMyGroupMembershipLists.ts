import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { groupIdForRow } from '@/components/dialogs/user-dialog/userDialogGroupRows';
import type { GroupProfileRecord } from '@/domain/entities/group';
import type { LoadStatus } from '@/domain/shared/types';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import {
    commands,
    type GroupMembershipListStatus
} from '@/platform/tauri/bindings';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import { unwrapVrchatResponse } from '@/repositories/vrchatRequest';
import { toast } from '@/services/toastService';
import { isRecord } from '@/shared/utils/record';
import { useModalStore } from '@/state/modalStore';
import { useMyGroupsRevisionStore } from '@/state/myGroupsRevisionStore';

export type MyGroupMembershipKind = 'invited' | 'requested' | 'blocked';

export type MyGroupMembershipRow = GroupProfileRecord & {
    membershipKind: MyGroupMembershipKind;
};

type MembershipLists = Record<MyGroupMembershipKind, MyGroupMembershipRow[]>;

const emptyLists: MembershipLists = { invited: [], requested: [], blocked: [] };

const listStatusByKind: Record<
    MyGroupMembershipKind,
    GroupMembershipListStatus
> = {
    invited: 'invited',
    requested: 'requested',
    blocked: 'userblocked'
};

async function fetchMembershipList(
    userId: string,
    kind: MyGroupMembershipKind
): Promise<MyGroupMembershipRow[]> {
    const status = listStatusByKind[kind];
    const response = unwrapVrchatResponse<unknown>(
        await commands.appVrchatGroupMembershipListGet({ userId, status }),
        `users/${encodeURIComponent(userId)}/groups/${status}`
    );
    const rows = Array.isArray(response.json) ? response.json : [];
    return rows.filter(isRecord).map((row) => ({
        ...groupProfileRepository.normalize(row),
        membershipKind: kind
    }));
}

export function useMyGroupMembershipLists(currentUserId: string | null) {
    const { t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const bumpMyGroupsRevision = useMyGroupsRevisionStore(
        (state) => state.bumpRevision
    );
    const [lists, setLists] = useState<MembershipLists>(emptyLists);
    const [status, setStatus] = useState<LoadStatus>('idle');
    const [busyGroupId, setBusyGroupId] = useState('');
    const loadSequenceRef = useRef(0);

    const load = useCallback(async () => {
        const sequence = loadSequenceRef.current + 1;
        loadSequenceRef.current = sequence;
        if (!currentUserId) {
            setLists(emptyLists);
            setStatus('idle');
            return;
        }
        setStatus('running');
        try {
            const [invited, requested, blocked] = await Promise.all([
                fetchMembershipList(currentUserId, 'invited'),
                fetchMembershipList(currentUserId, 'requested'),
                fetchMembershipList(currentUserId, 'blocked')
            ]);
            if (loadSequenceRef.current === sequence) {
                setLists({ invited, requested, blocked });
                setStatus('ready');
            }
        } catch (error) {
            if (loadSequenceRef.current === sequence) {
                setStatus('error');
                toast.add({
                    type: 'error',
                    title: userFacingErrorMessage(
                        error,
                        t('view.my_groups.membership_load_failed')
                    )
                });
            }
        }
    }, [currentUserId, t]);

    useEffect(() => {
        void load();
    }, [load]);

    function removeRow(kind: MyGroupMembershipKind, groupId: string) {
        setLists((current) => ({
            ...current,
            [kind]: current[kind].filter(
                (row) => groupIdForRow(row) !== groupId
            )
        }));
    }

    async function runAction(
        row: MyGroupMembershipRow,
        action: (groupId: string) => Promise<unknown>,
        onDone: (groupId: string) => void,
        successMessage?: string
    ) {
        const groupId = groupIdForRow(row);
        if (!groupId || busyGroupId) {
            return;
        }
        setBusyGroupId(groupId);
        try {
            await action(groupId);
            onDone(groupId);
            if (successMessage) {
                toast.add({ type: 'success', title: successMessage });
            }
        } catch (error) {
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(
                    error,
                    t('view.my_groups.membership_action_failed')
                )
            });
        } finally {
            setBusyGroupId('');
        }
    }

    function acceptInvite(row: MyGroupMembershipRow) {
        return runAction(
            row,
            (groupId) => groupProfileRepository.joinGroup({ groupId }),
            (groupId) => {
                removeRow('invited', groupId);
                bumpMyGroupsRevision();
            },
            t('view.my_groups.invite_accepted')
        );
    }

    function declineInvite(row: MyGroupMembershipRow) {
        if (!currentUserId) {
            return Promise.resolve();
        }
        return runAction(
            row,
            async (groupId) => {
                unwrapVrchatResponse(
                    await commands.appVrchatGroupInviteDecline({
                        groupId,
                        userId: currentUserId
                    }),
                    `groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(currentUserId)}`
                );
            },
            (groupId) => removeRow('invited', groupId)
        );
    }

    function cancelRequest(row: MyGroupMembershipRow) {
        return runAction(
            row,
            (groupId) => groupProfileRepository.cancelGroupRequest({ groupId }),
            (groupId) => removeRow('requested', groupId)
        );
    }

    async function blockGroup(row: MyGroupMembershipRow) {
        const result = await confirm({
            title: t('view.my_groups.confirm_block_title'),
            description: row.name || groupIdForRow(row),
            confirmText: t('view.my_groups.block'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }
        await runAction(
            row,
            (groupId) => groupProfileRepository.blockGroup({ groupId }),
            (groupId) => {
                removeRow(row.membershipKind, groupId);
                setLists((current) => ({
                    ...current,
                    blocked: [
                        { ...row, membershipKind: 'blocked' },
                        ...current.blocked
                    ]
                }));
            }
        );
    }

    async function unblockGroup(row: MyGroupMembershipRow) {
        if (!currentUserId) {
            return;
        }
        await runAction(
            row,
            (groupId) =>
                groupProfileRepository.unblockGroup({
                    groupId,
                    userId: currentUserId
                }),
            (groupId) => removeRow('blocked', groupId)
        );
    }

    return {
        acceptInvite,
        blockGroup,
        busyGroupId,
        cancelRequest,
        declineInvite,
        lists,
        load,
        status,
        unblockGroup
    };
}
