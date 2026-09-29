import { safeJsonParse } from '@/shared/utils/json';

export const FRIENDS_LOCATIONS_SEGMENTS = [
    { value: 'online', labelKey: 'view.friends_locations.online' },
    { value: 'favorite', labelKey: 'view.friends_locations.favorite' },
    {
        value: 'same-instance',
        labelKey: 'view.friends_locations.same_instance'
    },
    { value: 'active', labelKey: 'view.friends_locations.active' },
    { value: 'offline', labelKey: 'view.friends_locations.offline' }
] as const;

export type FriendsLocationsSegment =
    (typeof FRIENDS_LOCATIONS_SEGMENTS)[number]['value'];

export function isFriendsLocationsSegment(
    value: string
): value is FriendsLocationsSegment {
    return FRIENDS_LOCATIONS_SEGMENTS.some(
        (segment) => segment.value === value
    );
}

export function buildFriendsLocationsSegmentOptions(
    counts: Record<string, number>
) {
    return FRIENDS_LOCATIONS_SEGMENTS.map((segment) => ({
        ...segment,
        count: counts[segment.value] ?? 0
    }));
}

export function parseConfigArray(value: unknown): string[] {
    const parsed = Array.isArray(value) ? value : safeJsonParse(value);
    return Array.isArray(parsed)
        ? parsed.filter(
              (entry): entry is string =>
                  typeof entry === 'string' && entry.length > 0
          )
        : [];
}
