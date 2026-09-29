import {
    getDataTableStorageKey,
    readPersistedTableState,
    writePersistedTableState
} from '@/components/data-table/dataTablePersistence';

export const NOTIFICATION_TABLE_DEFAULT_PAGE_SIZES = [10, 15, 20, 25, 50, 100];

const STORAGE_KEY = getDataTableStorageKey('notifications');

export function readPersistedNotificationTableState() {
    return readPersistedTableState(STORAGE_KEY);
}

export function writePersistedNotificationTableState(
    patch: Record<string, unknown>
) {
    writePersistedTableState(STORAGE_KEY, patch);
}

export function sanitizeNotificationFilters(
    value: unknown,
    allowedTypes: readonly string[]
): string[] {
    const allowedTypeSet = new Set(
        Array.isArray(allowedTypes) ? allowedTypes : []
    );
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter(
        (type): type is string =>
            typeof type === 'string' && allowedTypeSet.has(type)
    );
}

export function sanitizeNotificationPageSizes(value: unknown): number[] {
    if (!Array.isArray(value)) {
        return NOTIFICATION_TABLE_DEFAULT_PAGE_SIZES;
    }

    const normalized = Array.from(
        new Set(
            value
                .map((entry) => Number.parseInt(String(entry), 10))
                .filter(
                    (entry) =>
                        Number.isFinite(entry) && entry > 0 && entry <= 1000
                )
        )
    ).sort((left, right) => left - right);

    return normalized.length
        ? normalized
        : NOTIFICATION_TABLE_DEFAULT_PAGE_SIZES;
}

export function resolveNotificationPageSize(
    candidate: unknown,
    pageSizes: readonly number[] = NOTIFICATION_TABLE_DEFAULT_PAGE_SIZES,
    fallback: number = 20
) {
    const fallbackPageSize = pageSizes.length
        ? pageSizes[0]
        : NOTIFICATION_TABLE_DEFAULT_PAGE_SIZES[0];
    const nearestPageSize = (value: number) =>
        pageSizes.length
            ? pageSizes.reduce((previous, size) =>
                  Math.abs(size - value) < Math.abs(previous - value)
                      ? size
                      : previous
              )
            : fallbackPageSize;
    const parsed = Number.parseInt(String(candidate), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return pageSizes.includes(parsed) ? parsed : nearestPageSize(parsed);
    }
    return pageSizes.includes(fallback) ? fallback : nearestPageSize(fallback);
}
