import { ImageIcon, StarIcon, UsersIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FadeInImage } from '@/components/media/FadeInImage';
import type {
    GroupCalendarEventRecord,
    GroupCalendarGroupRecord
} from '@/repositories/vrchatToolsRepository';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';

import { eventImageUrl, formatEventRange } from './groupEventFormat';
import { GroupEventStatusLabel } from './GroupEventStatusLabel';

function humanize(value: string | undefined) {
    const text = value?.trim().replaceAll('_', ' ') ?? '';
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

export function GroupEventHoverCardContent({
    event,
    groupName,
    groupProfile,
    isFollowing
}: {
    event: GroupCalendarEventRecord;
    groupName: string;
    groupProfile?: GroupCalendarGroupRecord | null;
    isFollowing: boolean;
}) {
    const { t } = useTranslation();
    const [bannerError, setBannerError] = useState(false);
    const [nowMs] = useState(() => Date.now());
    const bannerUrl = bannerError
        ? ''
        : eventImageUrl(event, groupProfile, 512);
    const iconUrl = convertFileUrlToImageUrl(groupProfile?.iconUrl || '', 64);
    const title =
        event.title?.trim() ||
        t('dialog.group_calendar.event_card.untitled_event');
    const description = event.description?.trim() ?? '';
    const accessLabel =
        event.accessType === 'public'
            ? t('group_event_hover_card.access.public')
            : event.accessType === 'group'
              ? t('group_event_hover_card.access.group')
              : humanize(event.accessType);
    const meta = [
        accessLabel,
        event.category === 'other' ? '' : humanize(event.category)
    ].filter(Boolean);

    return (
        <div className="flex flex-col">
            <div className="bg-muted flex aspect-[16/9] w-full items-center justify-center overflow-hidden">
                {bannerUrl ? (
                    <FadeInImage
                        src={bannerUrl}
                        alt=""
                        className="size-full object-cover"
                        onError={() => setBannerError(true)}
                    />
                ) : (
                    <ImageIcon className="text-muted-foreground size-6" />
                )}
            </div>
            <div className="flex flex-col gap-1.5 p-3">
                <div className="flex min-w-0 items-center gap-1.5">
                    {iconUrl ? (
                        <FadeInImage
                            src={iconUrl}
                            alt=""
                            className="size-4 shrink-0 rounded-sm object-cover"
                        />
                    ) : null}
                    <span className="text-muted-foreground truncate text-xs">
                        {groupName}
                    </span>
                </div>
                <p className="text-foreground line-clamp-2 text-sm font-medium">
                    {title}
                </p>
                <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-xs tabular-nums">
                    <span>{formatEventRange(event)}</span>
                    <GroupEventStatusLabel event={event} nowMs={nowMs} />
                </p>
                <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    {meta.length ? <span>{meta.join(' · ')}</span> : null}
                    <span className="inline-flex items-center gap-1 tabular-nums">
                        <UsersIcon className="size-3" aria-hidden="true" />
                        {t('group_event_hover_card.interested', {
                            count: event.interestedUserCount ?? 0
                        })}
                    </span>
                    {isFollowing ? (
                        <span className="inline-flex items-center gap-1 text-[var(--status-askme)]">
                            <StarIcon
                                className="size-3 fill-current"
                                aria-hidden="true"
                            />
                            {t('group_event_hover_card.following')}
                        </span>
                    ) : null}
                </div>
                {description ? (
                    <p className="text-muted-foreground mt-1 line-clamp-4 text-xs leading-relaxed whitespace-pre-line">
                        {description}
                    </p>
                ) : null}
            </div>
        </div>
    );
}
