import { create } from 'zustand';

import { commands } from '@/platform/tauri/bindings';
import type { FriendProfileLoadStatusPayload } from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { SECOND_MS } from '@/shared/constants/time';
import { useModalStore } from '@/state/modalStore';
import {
    type FriendProfileLoadState,
    useRuntimeStore
} from '@/state/runtimeStore';

import i18n from './i18nService';

const TERMINAL_RESET_DELAY_MS = 5000;
const REFRESH_COOLDOWN_MS = 300 * SECOND_MS;

export const useFriendProfileRefreshStore = create<{
    cooldowns: Record<string, number>;
    pending: boolean;
    now: number;
}>(() => ({ cooldowns: {}, pending: false, now: Date.now() }));

export function friendProfileRefreshScopeKey(
    userId: string | null,
    endpoint: string | null
): string {
    return JSON.stringify([userId || '', endpoint || '']);
}

const refreshRuns = new Map<number, string>();
let cooldownTimer: ReturnType<typeof setInterval> | null = null;

function startRefreshCooldown(runId: number): void {
    const scope = refreshRuns.get(runId);
    if (scope === undefined) return;
    refreshRuns.delete(runId);
    const now = Date.now();
    useFriendProfileRefreshStore.setState((state) => ({
        now,
        cooldowns: {
            ...state.cooldowns,
            [scope]: now + REFRESH_COOLDOWN_MS
        }
    }));
    if (cooldownTimer === null) {
        cooldownTimer = setInterval(() => {
            const now = Date.now();
            useFriendProfileRefreshStore.setState({ now });
            const { cooldowns } = useFriendProfileRefreshStore.getState();
            if (Object.values(cooldowns).every((until) => until <= now)) {
                if (cooldownTimer !== null) clearInterval(cooldownTimer);
                cooldownTimer = null;
            }
        }, SECOND_MS);
    }
}
const TERMINAL_STATUSES = new Set<FriendProfileLoadState['status']>([
    'completed',
    'cancelled'
]);
const STATUS_PHASE: Record<FriendProfileLoadState['status'], number> = {
    idle: 0,
    running: 1,
    cancelling: 2,
    completed: 3,
    cancelled: 3
};

let resetTimer: ReturnType<typeof setTimeout> | null = null;
let latestRunId = 0;
let latestStatus: FriendProfileLoadState['status'] = 'idle';

function clearResetTimer(): void {
    if (resetTimer !== null) {
        clearTimeout(resetTimer);
        resetTimer = null;
    }
}

function scheduleTerminalReset(runId: number): void {
    clearResetTimer();
    resetTimer = setTimeout(() => {
        resetTimer = null;
        const runtime = useRuntimeStore.getState();
        if (runtime.friendProfileLoad.runId === runId) {
            runtime.resetFriendProfileLoadState();
        }
    }, TERMINAL_RESET_DELAY_MS);
}

function isFriendProfileLoadTerminalStatus(
    status: FriendProfileLoadState['status']
): boolean {
    return TERMINAL_STATUSES.has(status);
}

function toFriendProfileLoadPatch(
    payload: FriendProfileLoadStatusPayload,
    current: FriendProfileLoadState
): Partial<FriendProfileLoadState> {
    const sameRun = current.runId === payload.runId;
    return {
        runId: payload.runId,
        status: payload.status,
        totalFriends: payload.total,
        processedFriends: sameRun
            ? Math.max(current.processedFriends, payload.processed)
            : payload.processed,
        loadedFriends: sameRun
            ? Math.max(current.loadedFriends, payload.loaded)
            : payload.loaded,
        failedFriends: sameRun
            ? Math.max(current.failedFriends, payload.failed)
            : payload.failed,
        cancelRequested: payload.status === 'cancelling',
        startedAt: payload.startedAt,
        finishedAt: payload.finishedAt ?? null
    };
}

function shouldApplyFriendProfileLoadStatusPayload(
    payload: FriendProfileLoadStatusPayload
): boolean {
    if (payload.runId < latestRunId) {
        return false;
    }
    if (payload.runId > latestRunId) {
        return true;
    }
    if (isFriendProfileLoadTerminalStatus(latestStatus)) {
        return false;
    }
    return STATUS_PHASE[payload.status] >= STATUS_PHASE[latestStatus];
}

export function applyFriendProfileLoadStatusPayload(
    payload: FriendProfileLoadStatusPayload
): void {
    if (!shouldApplyFriendProfileLoadStatusPayload(payload)) {
        return;
    }
    clearResetTimer();
    const runtime = useRuntimeStore.getState();
    latestRunId = payload.runId;
    latestStatus = payload.status;
    runtime.setFriendProfileLoadState(
        toFriendProfileLoadPatch(payload, runtime.friendProfileLoad)
    );
    if (isFriendProfileLoadTerminalStatus(payload.status)) {
        startRefreshCooldown(payload.runId);
        scheduleTerminalReset(payload.runId);
    }
}

export async function startFriendProfileLoad(
    refreshAll = false
): Promise<void> {
    const auth = useRuntimeStore.getState().auth;
    const scope = friendProfileRefreshScopeKey(
        auth.currentUserId,
        auth.currentUserEndpoint
    );
    if (refreshAll) {
        const state = useFriendProfileRefreshStore.getState();
        if (state.pending) return;
        const { status } = useRuntimeStore.getState().friendProfileLoad;
        if (status === 'running' || status === 'cancelling') {
            openFriendProfileLoadDialog();
            return;
        }
        const remaining = (state.cooldowns[scope] ?? 0) - Date.now();
        if (remaining > 0) {
            toast.add({
                type: 'info',
                title: i18n.t('view.friend_list.refresh_all_cooldown', {
                    count: Math.ceil(remaining / SECOND_MS)
                })
            });
            return;
        }
        useFriendProfileRefreshStore.setState({ pending: true });
    }
    try {
        if (refreshAll) {
            const result = await useModalStore.getState().confirm({
                title: i18n.t('view.friend_list.refresh_all'),
                description: i18n.t(
                    'view.friend_list.refresh_all_confirm_description'
                ),
                confirmText: i18n.t('view.friend_list.refresh_all_confirm'),
                cancelText: i18n.t('common.actions.cancel')
            });
            const currentAuth = useRuntimeStore.getState().auth;
            if (
                !result.ok ||
                scope !==
                    friendProfileRefreshScopeKey(
                        currentAuth.currentUserId,
                        currentAuth.currentUserEndpoint
                    )
            )
                return;
        }
        clearResetTimer();
        useRuntimeStore
            .getState()
            .setFriendProfileLoadState({ dialogOpen: true });
        const payload = refreshAll
            ? await commands.appFriendProfileRefreshAll()
            : await commands.appFriendProfileLoadStart();
        if (refreshAll) {
            refreshRuns.set(payload.runId, scope);
            if (
                payload.runId === latestRunId &&
                isFriendProfileLoadTerminalStatus(latestStatus)
            ) {
                startRefreshCooldown(payload.runId);
            }
        }
        applyFriendProfileLoadStatusPayload(payload);
        if (
            !refreshAll &&
            payload.status === 'completed' &&
            payload.processed === payload.total &&
            payload.loaded === 0 &&
            payload.failed === 0
        ) {
            toast.add({
                type: 'success',
                title: i18n.t(
                    'view.friend_list.label.friend_details_are_already_loaded'
                )
            });
        }
    } finally {
        if (refreshAll) {
            useFriendProfileRefreshStore.setState({ pending: false });
        }
    }
}

export async function cancelFriendProfileLoad(): Promise<void> {
    const current = useRuntimeStore.getState().friendProfileLoad;
    if (current.status !== 'running') {
        return;
    }
    latestRunId = current.runId;
    latestStatus = 'cancelling';
    useRuntimeStore.getState().setFriendProfileLoadState({
        status: 'cancelling',
        cancelRequested: true,
        dialogOpen: false
    });
    try {
        const payload = await commands.appFriendProfileLoadCancel();
        applyFriendProfileLoadStatusPayload(payload);
    } catch {
        const latest = useRuntimeStore.getState().friendProfileLoad;
        if (latest.runId === current.runId && latest.status === 'cancelling') {
            latestStatus = 'running';
            useRuntimeStore.getState().setFriendProfileLoadState({
                status: 'running',
                cancelRequested: false,
                dialogOpen: true
            });
        }
    }
}

export function minimizeFriendProfileLoadDialog(): void {
    useRuntimeStore.getState().setFriendProfileLoadState({ dialogOpen: false });
}

export function openFriendProfileLoadDialog(): void {
    useRuntimeStore.getState().setFriendProfileLoadState({ dialogOpen: true });
}

export function resetFriendProfileLoadService(): void {
    clearResetTimer();
    latestRunId = 0;
    latestStatus = 'idle';
    refreshRuns.clear();
    if (cooldownTimer !== null) clearInterval(cooldownTimer);
    cooldownTimer = null;
    useFriendProfileRefreshStore.setState({
        cooldowns: {},
        pending: false,
        now: Date.now()
    });
    useRuntimeStore.getState().resetFriendProfileLoadState();
}
