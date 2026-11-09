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

export type FriendProfileLoadKind = 'load' | 'refresh';

// Loading only fetches friends whose profile was never loaded, so a short
// cooldown is enough to stop repeated clicks; a full refresh fetches every
// friend again and keeps the longer one.
const COOLDOWN_MS: Record<FriendProfileLoadKind, number> = {
    load: 60 * SECOND_MS,
    refresh: 300 * SECOND_MS
};

const TEXT_KEYS: Record<
    FriendProfileLoadKind,
    {
        title: string;
        description: string;
        confirm: string;
        cooldown: string;
    }
> = {
    load: {
        title: 'view.friend_list.load',
        description: 'view.friend_list.load_confirm_description',
        confirm: 'view.friend_list.load_confirm',
        cooldown: 'view.friend_list.load_cooldown'
    },
    refresh: {
        title: 'view.friend_list.refresh_all',
        description: 'view.friend_list.refresh_all_confirm_description',
        confirm: 'view.friend_list.refresh_all_confirm',
        cooldown: 'view.friend_list.refresh_all_cooldown'
    }
};

export const useFriendProfileRefreshStore = create<{
    cooldowns: Record<string, number>;
    pending: boolean;
    now: number;
}>(() => ({ cooldowns: {}, pending: false, now: Date.now() }));

export function friendProfileRefreshScopeKey(
    userId: string | null,
    endpoint: string | null,
    kind: FriendProfileLoadKind = 'refresh'
): string {
    return kind === 'refresh'
        ? JSON.stringify([userId || '', endpoint || ''])
        : JSON.stringify([userId || '', endpoint || '', kind]);
}

const cooldownRuns = new Map<
    number,
    { scope: string; kind: FriendProfileLoadKind }
>();
let cooldownTimer: ReturnType<typeof setInterval> | null = null;

function startRefreshCooldown(runId: number): void {
    const run = cooldownRuns.get(runId);
    if (run === undefined) return;
    cooldownRuns.delete(runId);
    const now = Date.now();
    useFriendProfileRefreshStore.setState((state) => ({
        now,
        cooldowns: {
            ...state.cooldowns,
            [run.scope]: now + COOLDOWN_MS[run.kind]
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
    const kind: FriendProfileLoadKind = refreshAll ? 'refresh' : 'load';
    const text = TEXT_KEYS[kind];
    const auth = useRuntimeStore.getState().auth;
    const scope = friendProfileRefreshScopeKey(
        auth.currentUserId,
        auth.currentUserEndpoint,
        kind
    );
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
            title: i18n.t(text.cooldown, {
                count: Math.ceil(remaining / SECOND_MS)
            })
        });
        return;
    }
    useFriendProfileRefreshStore.setState({ pending: true });
    try {
        const result = await useModalStore.getState().confirm({
            title: i18n.t(text.title),
            description: i18n.t(text.description),
            confirmText: i18n.t(text.confirm),
            cancelText: i18n.t('common.actions.cancel')
        });
        const currentAuth = useRuntimeStore.getState().auth;
        if (
            !result.ok ||
            scope !==
                friendProfileRefreshScopeKey(
                    currentAuth.currentUserId,
                    currentAuth.currentUserEndpoint,
                    kind
                )
        )
            return;
        clearResetTimer();
        useRuntimeStore
            .getState()
            .setFriendProfileLoadState({ dialogOpen: true });
        const payload = refreshAll
            ? await commands.appFriendProfileRefreshAll()
            : await commands.appFriendProfileLoadStart();
        cooldownRuns.set(payload.runId, { scope, kind });
        if (
            payload.runId === latestRunId &&
            isFriendProfileLoadTerminalStatus(latestStatus)
        ) {
            startRefreshCooldown(payload.runId);
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
        useFriendProfileRefreshStore.setState({ pending: false });
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
    cooldownRuns.clear();
    if (cooldownTimer !== null) clearInterval(cooldownTimer);
    cooldownTimer = null;
    useFriendProfileRefreshStore.setState({
        cooldowns: {},
        pending: false,
        now: Date.now()
    });
    useRuntimeStore.getState().resetFriendProfileLoadState();
}
