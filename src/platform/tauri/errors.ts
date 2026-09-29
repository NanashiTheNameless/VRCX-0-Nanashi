import { isRecord } from '@/shared/utils/record';

import type {
    AppErrorCode,
    AppErrorPayload,
    SqliteErrorCategory
} from './bindings';

export class PlatformCommandError extends Error {
    readonly code: AppErrorCode;
    readonly sqliteCategory?: SqliteErrorCategory;
    readonly statusCode?: number;
    readonly port?: number;

    constructor(payload: AppErrorPayload, cause?: unknown) {
        super(payload.message);
        this.name = 'PlatformCommandError';
        this.code = payload.code;
        this.sqliteCategory = payload.sqliteCategory ?? undefined;
        this.statusCode = payload.statusCode ?? undefined;
        this.port = payload.port ?? undefined;
        this.cause = cause;
    }
}

function appErrorCode(value: unknown): AppErrorCode | null {
    switch (value) {
        case 'database':
        case 'io':
        case 'json':
        case 'persistence_invalid_data':
        case 'registry_policy_invalid':
        case 'web_client':
        case 'update_artifact_invalid':
        case 'vrchat_api':
        case 'auth_interaction_required':
        case 'auth_session_invalidated':
        case 'integration_api_port_in_use':
        case 'integration_api_bind':
        case 'custom':
            return value;
        default:
            return null;
    }
}

function vrchatApiStatusCode(value: unknown): number | undefined {
    return typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 100 &&
        value <= 599
        ? value
        : undefined;
}

function sqliteErrorCategory(value: unknown): SqliteErrorCategory | undefined {
    switch (value) {
        case 'malformed':
        case 'disk_full':
        case 'locked':
        case 'io_error':
            return value;
        default:
            return undefined;
    }
}

function structuredPlatformError(error: unknown): AppErrorPayload | null {
    if (!isRecord(error)) {
        return null;
    }
    const code = appErrorCode(error.code);
    if (!code || typeof error.message !== 'string') {
        return null;
    }
    const statusCode = vrchatApiStatusCode(error.statusCode);
    if (code === 'vrchat_api' && statusCode === undefined) {
        return null;
    }
    return {
        code,
        message: error.message,
        sqliteCategory: sqliteErrorCategory(error.sqliteCategory),
        statusCode,
        port: typeof error.port === 'number' ? error.port : undefined
    };
}

function withFallback(message: string, fallbackMessage?: string): string {
    if (!message) {
        return fallbackMessage || 'Platform command failed';
    }
    if (
        !fallbackMessage ||
        message === fallbackMessage ||
        message.startsWith(`${fallbackMessage}:`)
    ) {
        return message;
    }
    return `${fallbackMessage}: ${message}`;
}

export function normalizePlatformError(
    error: unknown,
    fallbackMessage?: string
): Error {
    if (error instanceof PlatformCommandError && !fallbackMessage) {
        return error;
    }
    const fallback = fallbackMessage || 'Platform command failed';
    const structuredError = structuredPlatformError(error);
    if (structuredError) {
        return new PlatformCommandError(
            {
                ...structuredError,
                message: withFallback(structuredError.message, fallbackMessage)
            },
            error
        );
    }
    if (error instanceof Error) {
        const details = error.message || String(error);
        if (
            !fallbackMessage ||
            details === fallback ||
            details.startsWith(`${fallback}:`)
        ) {
            return error;
        }

        const normalizedError = new Error(withFallback(details, fallback));
        normalizedError.name = error.name;
        normalizedError.cause = error;
        return normalizedError;
    }

    if (error === undefined || error === null) {
        return new Error(fallback);
    }

    const details =
        typeof error === 'string'
            ? error
            : (() => {
                  try {
                      return JSON.stringify(error);
                  } catch {
                      return String(error);
                  }
              })();

    return new Error(details ? `${fallback}: ${details}` : fallback);
}
