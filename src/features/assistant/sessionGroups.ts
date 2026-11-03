import type { SessionSummary } from '@/domain/assistant/types';
import { displayDayKey } from '@/shared/utils/displayTimeZone';

export type SessionGroupKey =
    | 'pinned'
    | 'today'
    | 'yesterday'
    | 'week'
    | 'older';

const DAY_MS = 86_400_000;
const GROUP_ORDER: SessionGroupKey[] = [
    'pinned',
    'today',
    'yesterday',
    'week',
    'older'
];

function dayNumber(value: Date): number {
    return Date.parse(`${displayDayKey(value)}T00:00:00Z`) / DAY_MS;
}

function groupOf(session: SessionSummary, today: number): SessionGroupKey {
    if (session.pinned) {
        return 'pinned';
    }
    const age = today - dayNumber(new Date(session.updatedAt * 1000));
    if (age <= 0) {
        return 'today';
    }
    if (age === 1) {
        return 'yesterday';
    }
    if (age <= 6) {
        return 'week';
    }
    return 'older';
}

export function groupSessions(
    sessions: readonly SessionSummary[],
    now: Date
): Array<{ key: SessionGroupKey; sessions: SessionSummary[] }> {
    const today = dayNumber(now);
    const grouped = new Map<SessionGroupKey, SessionSummary[]>();
    for (const session of sessions) {
        const key = groupOf(session, today);
        grouped.set(key, [...(grouped.get(key) ?? []), session]);
    }
    return GROUP_ORDER.flatMap((key) => {
        const members = grouped.get(key);
        return members ? [{ key, sessions: members }] : [];
    });
}
