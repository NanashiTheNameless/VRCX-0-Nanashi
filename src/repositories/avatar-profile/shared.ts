import type {
    HttpApiExecuteResponse,
    VrchatAvatarIdInput as IpcVrchatAvatarIdInput
} from '@/platform/tauri/bindings';
import { epochSecondsFromValue } from '@/shared/utils/displayTimeZone';
import { isRecord } from '@/shared/utils/record';

import { unwrapVrchatResponse } from '../vrchatRequest';

export function normalizeEntityId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

export function normalizeTimestamp(value: unknown): number {
    return epochSecondsFromValue(value) ?? 0;
}

export function normalizeMemoString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

export function normalizeArray(values: unknown): string[] {
    if (!Array.isArray(values)) {
        return [];
    }

    return values
        .map((value) =>
            typeof value === 'string'
                ? value.trim()
                : String(value ?? '').trim()
        )
        .filter(Boolean);
}

export { isRecord };

export function parseInteger(value: unknown): number {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function avatarIdInput(avatarId: string): IpcVrchatAvatarIdInput {
    return { avatarId };
}

export function unwrapVrchatAvatarResponse<TJson = unknown>(
    response: HttpApiExecuteResponse,
    path: string
) {
    return unwrapVrchatResponse<TJson>(response, path, {
        fallbackMessage: 'VRChat avatar request failed'
    });
}

export { collectPages } from '../pagination';
