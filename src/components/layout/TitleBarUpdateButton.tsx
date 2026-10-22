import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDateFilter } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger
} from '@/ui/shadcn/hover-card';

function formatUpdateReleaseDate(value: string | null | undefined) {
    if (!value) {
        return '-';
    }
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
        return value;
    }
    return formatDateFilter(timestamp, 'date');
}

function clampUpdateProgress(value: number) {
    return Math.max(0, Math.min(100, Math.round(value || 0)));
}

function formatMegabytes(bytes: number) {
    return Math.round(bytes / (1024 * 1024)).toString();
}

function formatUpdateDownloadSize(downloadedBytes: number) {
    if (!Number.isFinite(downloadedBytes) || downloadedBytes <= 0) {
        return '0 MB';
    }
    return `${formatMegabytes(downloadedBytes)} MB`;
}

const DOWNLOAD_PILL_COLLAPSED_WIDTH_PX = 60;
const DOWNLOAD_PILL_EXPANDED_WIDTH_PX = 140;

function useDownloadPillWidth(isDownloading: boolean) {
    const [width, setWidth] = useState(DOWNLOAD_PILL_COLLAPSED_WIDTH_PX);

    useEffect(() => {
        setWidth(DOWNLOAD_PILL_COLLAPSED_WIDTH_PX);
        if (!isDownloading) {
            return undefined;
        }
        let expandFrame = 0;
        const collapsedFrame = requestAnimationFrame(() => {
            expandFrame = requestAnimationFrame(() => {
                setWidth(DOWNLOAD_PILL_EXPANDED_WIDTH_PX);
            });
        });
        return () => {
            cancelAnimationFrame(collapsedFrame);
            cancelAnimationFrame(expandFrame);
        };
    }, [isDownloading]);

    return width;
}

type DownloadPillContentProps = {
    label: string;
    size: string;
    progressPercent: number;
};

function DownloadPillContent({
    label,
    size,
    progressPercent
}: DownloadPillContentProps) {
    return (
        <>
            <span className="flex w-full items-center justify-between gap-2 text-[8px] leading-none whitespace-nowrap">
                <span className="font-medium">{label}</span>
                <span className="text-muted-foreground tabular-nums">
                    {size}
                </span>
            </span>
            <span className="bg-muted/70 block h-[2px] w-full overflow-hidden rounded-full">
                <span
                    className="bg-primary block h-full rounded-full transition-[width] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
                    style={{ width: `${progressPercent}%` }}
                />
            </span>
        </>
    );
}

export function TitleBarUpdateButton({ onClick }: { onClick: () => void }) {
    const { t } = useTranslation();
    const latestUpdaterRelease = useRuntimeStore(
        (state) => state.updateLoop.latestUpdaterRelease
    );
    const autoDownloadState = useRuntimeStore(
        (state) => state.updateLoop.autoDownloadState
    );
    const downloadedVersion = useRuntimeStore(
        (state) => state.updateLoop.downloadedVersion
    );
    const downloadProgress = useRuntimeStore(
        (state) => state.updateLoop.downloadProgress
    );
    const downloadedBytes = useRuntimeStore(
        (state) => state.updateLoop.downloadedBytes
    );
    const latestVersion = latestUpdaterRelease?.canonicalVersion || '';
    const hasMatchingDownloadedVersion =
        Boolean(latestVersion) && downloadedVersion === latestVersion;
    const isDownloaded =
        autoDownloadState === 'downloaded' && hasMatchingDownloadedVersion;
    const isDownloading =
        autoDownloadState === 'downloading' && hasMatchingDownloadedVersion;
    const progressPercent = clampUpdateProgress(downloadProgress);
    const pillWidth = useDownloadPillWidth(isDownloading);

    return (
        <HoverCard>
            <HoverCardTrigger
                delay={150}
                closeDelay={80}
                render={
                    <Button
                        type="button"
                        variant={isDownloaded ? 'default' : 'secondary'}
                        size="sm"
                        className={cn(
                            'h-6 overflow-hidden rounded-md text-xs shadow-none transition-[width] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]',
                            isDownloading
                                ? 'flex-col items-stretch justify-center gap-0.5 px-2 py-0.5'
                                : 'gap-1.5 px-2'
                        )}
                        style={isDownloading ? { width: pillWidth } : undefined}
                        onClick={onClick}
                    >
                        {isDownloading ? (
                            <DownloadPillContent
                                label={t('nav_menu.update')}
                                size={formatUpdateDownloadSize(downloadedBytes)}
                                progressPercent={progressPercent}
                            />
                        ) : (
                            t('nav_menu.update')
                        )}
                    </Button>
                }
            />
            <HoverCardContent side="bottom" align="end" className="w-80 p-3">
                <div className="flex flex-col gap-2">
                    <div className="text-sm font-semibold">
                        {latestUpdaterRelease?.title ||
                            t('dialog.system.label.vrcx_0_update')}
                    </div>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                        <dt className="text-muted-foreground">
                            {t('message.vrcx_updater.current_version')}
                        </dt>
                        <dd className="text-foreground wrap-anywhere tabular-nums">
                            {latestUpdaterRelease?.currentVersion || '-'}
                        </dd>
                        <dt className="text-muted-foreground">
                            {t('message.vrcx_updater.latest_version')}
                        </dt>
                        <dd className="text-foreground wrap-anywhere tabular-nums">
                            {latestUpdaterRelease?.latestVersion || '-'}
                        </dd>
                        <dt className="text-muted-foreground">
                            {t('message.vrcx_updater.released')}
                        </dt>
                        <dd className="text-foreground wrap-anywhere">
                            {formatUpdateReleaseDate(
                                latestUpdaterRelease?.publishedAt
                            )}
                        </dd>
                        {isDownloading ? (
                            <>
                                <dt className="text-muted-foreground">
                                    {t('nav_menu.update')}
                                </dt>
                                <dd className="text-foreground truncate tabular-nums">
                                    {progressPercent}%
                                </dd>
                            </>
                        ) : null}
                    </dl>
                </div>
            </HoverCardContent>
        </HoverCard>
    );
}
