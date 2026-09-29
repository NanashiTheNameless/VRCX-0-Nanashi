import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    readPersistedNotificationTableState,
    resolveNotificationPageSize,
    sanitizeNotificationFilters,
    writePersistedNotificationTableState
} from './notificationTableState';

function installLocalStorage(initial: Record<string, unknown> = {}) {
    const values = new Map(
        Object.entries(initial).map(([key, value]) => [key, String(value)])
    );
    const localStorage = {
        getItem: vi.fn((key: string) => values.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
            values.set(key, String(value));
        })
    };
    vi.stubGlobal('localStorage', localStorage);
    return { localStorage, values };
}

describe('notification table state helpers', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-02T03:04:05Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('reads and writes persisted table state without dropping existing keys', () => {
        const { localStorage, values } = installLocalStorage({
            'vrcx-0:table:notifications': JSON.stringify({
                pageSize: 25,
                filters: ['invite']
            })
        });

        expect(readPersistedNotificationTableState()).toEqual({
            pageSize: 25,
            filters: ['invite']
        });
        writePersistedNotificationTableState({ pageSize: 50 });

        expect(localStorage.setItem).toHaveBeenCalledWith(
            'vrcx-0:table:notifications',
            expect.any(String)
        );
        expect(
            JSON.parse(values.get('vrcx-0:table:notifications') ?? '')
        ).toEqual({
            pageSize: 50,
            filters: ['invite'],
            updatedAt: new Date('2026-01-02T03:04:05Z').getTime()
        });
    });

    it('sanitizes filters and page size', () => {
        const allowedTypes = ['invite', 'message'];

        expect(
            sanitizeNotificationFilters(
                ['invite', 'unknown', 'message'],
                allowedTypes
            )
        ).toEqual(['invite', 'message']);
        expect(resolveNotificationPageSize(50)).toBe(50);
        expect(resolveNotificationPageSize('bad')).toBe(20);
    });
});
