import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import {
    commands,
    type GroupMemberVisibility,
    type GroupMembershipBatchAction
} from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { resolveMyGroupsBatchProgress } from './myGroupsBatchProgress';

const CONFIRM_NAME_LIMIT = 8;

export type MyGroupsBatchTarget = {
    groupId: string;
    name: string;
};

export type MyGroupsBatchProgress = {
    current: number;
    total: number;
};

export function useMyGroupsBatchController({
    onCompleted
}: {
    onCompleted: () => void;
}) {
    const { i18n, t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentAuthEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const batchProgressEvent = useRuntimeStore(
        (state) => state.runtimeEvents.groupMembershipBatchProgress
    );
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState<MyGroupsBatchProgress | null>(
        null
    );
    const progressEventCountRef = useRef(0);
    const runSequenceRef = useRef(0);

    useEffect(() => {
        const nextProgress = resolveMyGroupsBatchProgress({
            busy,
            currentAuthEndpoint,
            currentUserId,
            event: batchProgressEvent,
            previousEventCount: progressEventCountRef.current
        });
        if (nextProgress) {
            setProgress(nextProgress);
        }
    }, [batchProgressEvent, busy, currentAuthEndpoint, currentUserId]);

    function describeTargets(targets: MyGroupsBatchTarget[]) {
        const listFormatter = new Intl.ListFormat(i18n.language, {
            style: 'narrow',
            type: 'unit'
        });
        const names = listFormatter.format(
            targets
                .slice(0, CONFIRM_NAME_LIMIT)
                .map((target) => target.name || target.groupId)
        );
        if (targets.length <= CONFIRM_NAME_LIMIT) {
            return names;
        }
        return t('view.my_groups.confirm_more_groups', {
            names,
            count: targets.length - CONFIRM_NAME_LIMIT
        });
    }

    async function runBatch({
        action,
        targets,
        confirmation,
        successMessage
    }: {
        action: GroupMembershipBatchAction;
        targets: MyGroupsBatchTarget[];
        confirmation?: {
            title: string;
            description: string;
            confirmText: string;
        };
        successMessage: (count: number) => string;
    }) {
        if (busy || !targets.length) {
            return;
        }
        if (confirmation) {
            const result = await confirm({
                ...confirmation,
                cancelText: t('common.actions.cancel'),
                destructive: true
            });
            if (!result.ok) {
                return;
            }
        }

        const auth = useRuntimeStore.getState().auth;
        const batchOwnerUserId = auth.currentUserId;
        const batchEndpoint = auth.currentUserEndpoint;
        if (
            !batchOwnerUserId ||
            batchOwnerUserId !== currentUserId ||
            batchEndpoint !== currentAuthEndpoint
        ) {
            return;
        }

        const batchRunSequence = runSequenceRef.current + 1;
        runSequenceRef.current = batchRunSequence;
        const isCurrentBatchRun = () => {
            const current = useRuntimeStore.getState().auth;
            return (
                runSequenceRef.current === batchRunSequence &&
                current.currentUserId === batchOwnerUserId &&
                current.currentUserEndpoint === batchEndpoint
            );
        };

        setBusy(true);
        progressEventCountRef.current = batchProgressEvent?.count ?? 0;
        setProgress({ current: 0, total: targets.length });
        try {
            const batchResult = await commands.appGroupMembershipBatch({
                action,
                expectedEndpoint: batchEndpoint,
                expectedOwnerUserId: batchOwnerUserId,
                groupIds: targets.map((target) => target.groupId)
            });
            if (
                !isCurrentBatchRun() ||
                batchResult.ownerUserId !== batchOwnerUserId ||
                batchResult.endpoint !== batchEndpoint
            ) {
                return;
            }
            setProgress({
                current: batchResult.total,
                total: batchResult.total
            });
            const namesByGroupId = new Map(
                targets.map((target) => [target.groupId, target.name])
            );
            for (const item of batchResult.items) {
                if (item.state === 'applied') {
                    continue;
                }
                const name = namesByGroupId.get(item.groupId) || item.groupId;
                toast.add({
                    type: 'error',
                    title: `${name}: ${userFacingErrorMessage(
                        item.message,
                        t('view.my_groups.batch_item_failed')
                    )}`
                });
            }
            if (batchResult.succeeded) {
                toast.add({
                    type: 'success',
                    title: successMessage(batchResult.succeeded)
                });
            }
        } catch (batchError) {
            if (isCurrentBatchRun()) {
                toast.add({
                    type: 'error',
                    title: userFacingErrorMessage(
                        batchError,
                        t('view.my_groups.batch_failed')
                    )
                });
            }
        } finally {
            if (runSequenceRef.current === batchRunSequence) {
                setBusy(false);
                setProgress(null);
                if (isCurrentBatchRun()) {
                    onCompleted();
                }
            }
        }
    }

    return {
        busy,
        progress,
        leaveGroups: (targets: MyGroupsBatchTarget[]) =>
            runBatch({
                action: { type: 'leave' },
                targets,
                confirmation: {
                    title: t('view.my_groups.confirm_leave_title', {
                        count: targets.length
                    }),
                    description: `${describeTargets(targets)} - ${t(
                        'view.my_groups.confirm_leave_warning'
                    )}`,
                    confirmText: t('view.my_groups.leave')
                },
                successMessage: (count) =>
                    t('view.my_groups.leave_completed', { count })
            }),
        setVisibility: (
            targets: MyGroupsBatchTarget[],
            visibility: GroupMemberVisibility
        ) =>
            runBatch({
                action: { type: 'setVisibility', visibility },
                targets,
                successMessage: (count) =>
                    t('view.my_groups.visibility_completed', { count })
            })
    };
}
