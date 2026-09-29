import { ImageIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FadeInImage } from '@/components/media/FadeInImage';
import { WorldHoverCard } from '@/components/world-hover-card/WorldHoverCard';
import type { WorldHoverCardSeed } from '@/components/world-hover-card/WorldHoverCardContent';
import type {
    ActivityPageWorldRow,
    ActivityPageWorlds
} from '@/platform/tauri/bindings';
import { openWorldDialog } from '@/services/dialogService';

import { useActivityWorldNames } from '../useActivityWorldNames';
import type { ActivityWorldSummary } from '../useActivityWorldNames';
import { Exhibit } from './ActivityExhibit';
import { RankRow } from './ActivityRankRow';
import { OptionToggle } from './ActivityViewOption';

const GRID_THUMBS = 8;

function hours(minutes: number) {
    return (minutes / 60).toFixed(1);
}

function Thumb({ url, className }: { url: string; className: string }) {
    const placeholder = (
        <span
            className={`${className} flex items-center justify-center rounded-md bg-[var(--act-track)]`}
        >
            <ImageIcon className="text-muted-foreground size-4" />
        </span>
    );
    if (!url) {
        return placeholder;
    }
    return (
        <FadeInImage
            src={url}
            alt=""
            loading="lazy"
            decoding="async"
            className={`${className} rounded-md object-cover`}
            fallback={placeholder}
        />
    );
}

export function ActivityWorldsExhibit({
    worlds,
    homeWorldId,
    showHomeWorld,
    onShowHomeWorldChange
}: {
    worlds: ActivityPageWorlds;
    homeWorldId: string;
    showHomeWorld: boolean;
    onShowHomeWorldChange: (next: boolean) => void;
}) {
    const { t } = useTranslation();
    const worldIds = useMemo(
        () => worlds.top.map((row) => row.worldId),
        [worlds.top]
    );
    const summaries = useActivityWorldNames(worldIds);
    const hoursUnit = t('view.activity.unit.hours');
    const ranked =
        homeWorldId && !showHomeWorld
            ? worlds.top.filter((row) => row.worldId !== homeWorldId)
            : worlds.top;
    const [lead, ...rest] = ranked;

    if (!lead) {
        return null;
    }

    const summaryOf = (
        row: ActivityPageWorldRow
    ): ActivityWorldSummary | undefined => summaries.get(row.worldId);
    const nameOf = (row: ActivityPageWorldRow) =>
        summaryOf(row)?.name || row.worldName || row.worldId;
    const seedOf = (row: ActivityPageWorldRow): WorldHoverCardSeed | null => {
        const summary = summaryOf(row);
        return summary
            ? {
                  name: summary.name || row.worldName,
                  imageUrl: summary.imageUrl,
                  authorName: summary.authorName,
                  description: summary.description
              }
            : null;
    };
    const thumbs = rest.slice(0, GRID_THUMBS);

    return (
        <Exhibit
            label={t('view.activity.section.top_worlds')}
            caption={t('view.activity.worlds.total', {
                count: worlds.distinctCount
            })}
            aside={
                homeWorldId ? (
                    <OptionToggle
                        label={t('view.activity.worlds.show_home')}
                        active={showHomeWorld}
                        onToggle={onShowHomeWorldChange}
                    />
                ) : undefined
            }
            detailLabel={t('view.activity.worlds.open_ranking')}
            detail={
                <div className="flex flex-col">
                    {rest.map((row, index) => (
                        <WorldHoverCard key={row.worldId} seed={seedOf(row)}>
                            <RankRow
                                index={index + 1}
                                onClick={() =>
                                    openWorldDialog({
                                        worldId: row.worldId,
                                        title: nameOf(row)
                                    })
                                }
                                leading={
                                    <Thumb
                                        url={summaryOf(row)?.thumbnailUrl ?? ''}
                                        className="size-9 shrink-0"
                                    />
                                }
                                title={nameOf(row)}
                                secondary={t(
                                    'view.activity.worlds.visit_count',
                                    { count: row.visitCount }
                                )}
                                primary={`${hours(row.minutes)}${hoursUnit}`}
                            />
                        </WorldHoverCard>
                    ))}
                </div>
            }
        >
            <WorldHoverCard seed={seedOf(lead)} side="bottom">
                <button
                    type="button"
                    onClick={() =>
                        openWorldDialog({
                            worldId: lead.worldId,
                            title: nameOf(lead)
                        })
                    }
                    className="block w-full text-left transition-opacity duration-100 ease-out hover:opacity-85 active:opacity-70"
                >
                    <Thumb
                        url={summaryOf(lead)?.imageUrl ?? ''}
                        className="block aspect-[16/7] w-full"
                    />
                    <span className="mt-3 flex items-baseline justify-between gap-3">
                        <span className="text-foreground truncate text-xl font-semibold tracking-[-0.015em]">
                            {nameOf(lead)}
                        </span>
                        <span className="text-foreground shrink-0 text-base font-semibold tabular-nums">
                            {hours(lead.minutes)}
                            <span className="text-muted-foreground text-xs font-normal">
                                {hoursUnit}
                            </span>
                        </span>
                    </span>
                    <span className="text-muted-foreground mt-1 block text-xs tabular-nums">
                        {t('view.activity.worlds.visit_count', {
                            count: lead.visitCount
                        })}
                    </span>
                </button>
            </WorldHoverCard>

            {thumbs.length > 0 ? (
                <div className="mt-4 grid grid-cols-4 gap-2 xl:grid-cols-8">
                    {thumbs.map((row) => (
                        <WorldHoverCard key={row.worldId} seed={seedOf(row)}>
                            <button
                                type="button"
                                onClick={() =>
                                    openWorldDialog({
                                        worldId: row.worldId,
                                        title: nameOf(row)
                                    })
                                }
                                className="transition-opacity duration-100 ease-out hover:opacity-80 active:opacity-65"
                            >
                                <Thumb
                                    url={summaryOf(row)?.thumbnailUrl ?? ''}
                                    className="block aspect-square w-full"
                                />
                            </button>
                        </WorldHoverCard>
                    ))}
                </div>
            ) : null}
        </Exhibit>
    );
}
