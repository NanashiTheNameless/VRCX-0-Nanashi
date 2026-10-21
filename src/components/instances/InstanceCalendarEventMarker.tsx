import { CalendarDaysIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { normalizeGroupEvent } from '@/components/dialogs/group-dialog/groupDialogUtils';
import { GroupEventHoverCardContent } from '@/components/group-event/GroupEventHoverCardContent';
import { commands } from '@/platform/tauri/bindings';
import { unwrapVrchatResponse } from '@/repositories/vrchatRequest';
import type { GroupCalendarEventRecord } from '@/repositories/vrchatToolsRepository';
import { isRecord } from '@/shared/utils/record';
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger
} from '@/ui/shadcn/hover-card';
import { Spinner } from '@/ui/shadcn/spinner';

export function InstanceCalendarEventMarker({
    groupId,
    groupName,
    eventId,
    canLoad
}: {
    groupId: string;
    groupName: string;
    eventId: string;
    canLoad: boolean;
}) {
    const { t } = useTranslation();
    const [event, setEvent] = useState<GroupCalendarEventRecord | null>(null);
    const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle');
    const loadedEvent = event && event.id === eventId ? event : null;

    async function loadEvent() {
        if (!canLoad || loadedEvent || status === 'running') {
            return;
        }
        setStatus('running');
        try {
            const response = unwrapVrchatResponse<unknown>(
                await commands.appVrchatToolsGroupCalendarEventGet({
                    groupId,
                    eventId
                }),
                `calendar/${encodeURIComponent(groupId)}/${encodeURIComponent(eventId)}`
            );
            if (isRecord(response.json)) {
                setEvent(normalizeGroupEvent(response.json, groupId));
            }
            setStatus('idle');
        } catch {
            setStatus('error');
        }
    }

    return (
        <HoverCard
            onOpenChange={(open) => {
                if (open) {
                    void loadEvent();
                }
            }}
        >
            <HoverCardTrigger
                delay={300}
                closeDelay={120}
                render={
                    <span
                        className="inline-flex items-center"
                        aria-label={t(
                            'component.instance_action_bar.calendar_event'
                        )}
                    >
                        <CalendarDaysIcon className="size-3.5" />
                    </span>
                }
            />
            <HoverCardContent
                className={loadedEvent ? 'w-80 overflow-hidden p-0' : 'w-auto'}
                side="top"
                align="start"
                sideOffset={8}
            >
                {loadedEvent ? (
                    <GroupEventHoverCardContent
                        event={loadedEvent}
                        groupName={groupName}
                        isFollowing={
                            loadedEvent.userInterest?.isFollowing === true
                        }
                    />
                ) : status === 'running' ? (
                    <Spinner />
                ) : (
                    <span className="text-xs">
                        {t('component.instance_action_bar.calendar_event')}
                    </span>
                )}
            </HoverCardContent>
        </HoverCard>
    );
}
