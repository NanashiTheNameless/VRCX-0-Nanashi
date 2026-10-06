import { useTranslation } from 'react-i18next';

import { formatRelativeTime } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
import type { GroupCalendarEventRecord } from '@/repositories/vrchatToolsRepository';

import { EVENT_SOON_WINDOW_MS, eventStatus } from './groupEventFormat';

export function GroupEventStatusLabel({
    event,
    nowMs,
    hideDistant = false
}: {
    event: GroupCalendarEventRecord;
    nowMs: number;
    hideDistant?: boolean;
}) {
    const { t } = useTranslation();
    const status = eventStatus(event, nowMs);
    if (status === 'live') {
        return (
            <span className="inline-flex items-center gap-1 font-medium text-[var(--status-online)]">
                <span className="size-1.5 rounded-full bg-current" />
                {t('group_event_hover_card.live')}
            </span>
        );
    }
    if (status === 'upcoming') {
        const soon =
            new Date(event.startsAt || '').getTime() - nowMs <=
            EVENT_SOON_WINDOW_MS;
        if (!soon && hideDistant) {
            return null;
        }
        return (
            <span className={cn(soon && 'text-foreground')}>
                {t('group_event_hover_card.starts_in', {
                    time: formatRelativeTime(event.startsAt, { nowMs })
                })}
            </span>
        );
    }
    if (status === 'ended') {
        return <span>{t('group_event_hover_card.ended')}</span>;
    }
    return null;
}
