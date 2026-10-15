import { FlagIcon, Undo2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState, LoadingState } from '@/components/layout/PageScaffold';
import { FadeInImage } from '@/components/media/FadeInImage';
import { formatDateFilter } from '@/lib/dateTime';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { cn } from '@/lib/utils';
import vrchatToolsRepository, {
    type ModerationReportRecord
} from '@/repositories/vrchatToolsRepository';
import {
    openAvatarDialog,
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService';
import { toast } from '@/services/toastService';
import { useModalStore } from '@/state/modalStore';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { getCurrentUserId } from './toolsDialogUtils';

type ReportTab = 'open' | 'closed';

type LoadState =
    | { status: 'loading' }
    | {
          status: 'ready';
          reports: ModerationReportRecord[];
          hasNext: boolean;
      }
    | { status: 'error'; error: unknown };

const contentTypeLabelKeys: Record<string, string> = {
    user: 'view.search.user.header',
    avatar: 'view.search.avatar.header',
    world: 'view.search.world.header',
    group: 'view.search.group.header'
};

const contentDialogOpeners: Record<string, (contentId: string) => void> = {
    user: (userId) => openUserDialog({ userId }),
    avatar: (avatarId) => openAvatarDialog({ avatarId }),
    world: (worldId) => openWorldDialog({ worldId }),
    group: (groupId) => openGroupDialog({ groupId })
};

function mergeReports(
    current: ModerationReportRecord[],
    next: ModerationReportRecord[]
) {
    const seen = new Set(current.map((report) => report.id));
    return [...current, ...next.filter((report) => !seen.has(report.id))];
}

export function ModerationReportsDialog({
    open,
    onOpenChange
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-xl">
                {open ? <ModerationReportsDialogBody /> : null}
            </DialogContent>
        </Dialog>
    );
}

function ModerationReportsDialogBody() {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<ReportTab>('open');

    return (
        <>
            <DialogHeader>
                <DialogTitle>
                    {t('dialog.moderation_reports.header')}
                </DialogTitle>
                <DialogDescription>
                    {t('dialog.moderation_reports.description')}
                </DialogDescription>
            </DialogHeader>
            <Tabs
                value={activeTab}
                onValueChange={(value) => {
                    if (value === 'open' || value === 'closed') {
                        setActiveTab(value);
                    }
                }}
                className="min-h-0"
            >
                <TabsList>
                    <TabsTrigger value="open">
                        {t('dialog.moderation_reports.status_open')}
                    </TabsTrigger>
                    <TabsTrigger value="closed">
                        {t('dialog.moderation_reports.status_closed')}
                    </TabsTrigger>
                </TabsList>
                <TabsContent
                    value={activeTab}
                    className="flex min-h-0 flex-col"
                >
                    <ModerationReportList
                        key={activeTab}
                        closedOnly={activeTab === 'closed'}
                    />
                </TabsContent>
            </Tabs>
        </>
    );
}

function ModerationReportList({ closedOnly }: { closedOnly: boolean }) {
    const { t } = useTranslation();
    const [loadState, setLoadState] = useState<LoadState>({
        status: 'loading'
    });
    const [loadingMore, setLoadingMore] = useState(false);
    const [withdrawingId, setWithdrawingId] = useState('');

    useEffect(() => {
        let active = true;
        vrchatToolsRepository
            .getModerationReports({
                currentUserId: getCurrentUserId(),
                offset: 0,
                closedOnly
            })
            .then((page) => {
                if (active) {
                    setLoadState({
                        status: 'ready',
                        reports: page.results ?? [],
                        hasNext: page.hasNext === true
                    });
                }
            })
            .catch((error: unknown) => {
                if (active) {
                    setLoadState({ status: 'error', error });
                }
            });
        return () => {
            active = false;
        };
    }, [closedOnly]);

    async function handleLoadMore() {
        if (loadState.status !== 'ready') {
            return;
        }
        setLoadingMore(true);
        try {
            const page = await vrchatToolsRepository.getModerationReports({
                currentUserId: getCurrentUserId(),
                offset: loadState.reports.length,
                closedOnly
            });
            setLoadState((current) =>
                current.status === 'ready'
                    ? {
                          status: 'ready',
                          reports: mergeReports(
                              current.reports,
                              page.results ?? []
                          ),
                          hasNext: page.hasNext === true
                      }
                    : current
            );
        } catch (error) {
            toast.add({
                type: 'error',
                title: t('dialog.moderation_reports.failed_to_load'),
                description: userFacingErrorMessage(error)
            });
        } finally {
            setLoadingMore(false);
        }
    }

    async function handleWithdraw(report: ModerationReportRecord) {
        const reportId = report.id;
        if (!reportId) {
            return;
        }
        const result = await useModalStore.getState().confirm({
            title: t('dialog.moderation_reports.withdraw_title', {
                value: report.contentName || report.contentId || reportId
            }),
            description: t('dialog.moderation_reports.withdraw_description'),
            confirmText: t('dialog.moderation_reports.withdraw'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }

        setWithdrawingId(reportId);
        try {
            await vrchatToolsRepository.deleteModerationReport({ reportId });
            setLoadState((current) =>
                current.status === 'ready'
                    ? {
                          ...current,
                          reports: current.reports.filter(
                              (item) => item.id !== reportId
                          )
                      }
                    : current
            );
        } catch (error) {
            toast.add({
                type: 'error',
                title: t('dialog.moderation_reports.failed_to_withdraw'),
                description: userFacingErrorMessage(error)
            });
        } finally {
            setWithdrawingId('');
        }
    }

    if (loadState.status === 'loading') {
        return <LoadingState variant="panel" />;
    }
    if (loadState.status === 'error') {
        return (
            <EmptyState
                variant="panel"
                title={t('dialog.moderation_reports.failed_to_load')}
                description={userFacingErrorMessage(loadState.error)}
            />
        );
    }
    if (loadState.reports.length === 0) {
        return (
            <EmptyState
                variant="panel"
                icon={FlagIcon}
                title={
                    closedOnly
                        ? t('dialog.moderation_reports.empty_closed')
                        : t('dialog.moderation_reports.empty_open')
                }
            />
        );
    }

    return (
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
            <ul className="divide-stroke-subtle divide-y overflow-hidden rounded-lg border">
                {loadState.reports.map((report) => (
                    <ModerationReportRow
                        key={report.id}
                        report={report}
                        withdrawing={withdrawingId === report.id}
                        disabled={Boolean(withdrawingId)}
                        onWithdraw={() => {
                            void handleWithdraw(report);
                        }}
                    />
                ))}
            </ul>
            {loadState.hasNext ? (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="self-center"
                    disabled={loadingMore}
                    onClick={() => {
                        void handleLoadMore();
                    }}
                >
                    {loadingMore ? <Spinner data-icon="inline-start" /> : null}
                    {t('common.load_more')}
                </Button>
            ) : null}
        </div>
    );
}

function ModerationReportRow({
    report,
    withdrawing,
    disabled,
    onWithdraw
}: {
    report: ModerationReportRecord;
    withdrawing: boolean;
    disabled: boolean;
    onWithdraw: () => void;
}) {
    const { t } = useTranslation();
    const type = report.type ?? '';
    const contentId = report.contentId ?? '';
    const name = report.contentName || contentId;
    const typeLabelKey = contentTypeLabelKeys[type];
    const openContent = contentId ? contentDialogOpeners[type] : undefined;
    const thumbnailUrl = report.contentThumbnailImageUrl || '';
    const thumbnailFallback = (
        <FlagIcon className="text-muted-foreground size-4" />
    );
    const withdrawLabel = t('dialog.moderation_reports.withdraw');

    return (
        <li className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-(--state-hover-surface)">
            <div
                className={cn(
                    'bg-muted flex size-10 shrink-0 items-center justify-center overflow-hidden',
                    type === 'user' ? 'rounded-full' : 'rounded-md'
                )}
            >
                {thumbnailUrl ? (
                    <FadeInImage
                        src={thumbnailUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                        fallback={thumbnailFallback}
                    />
                ) : (
                    thumbnailFallback
                )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-w-0 items-baseline gap-3">
                    {openContent ? (
                        <button
                            type="button"
                            className="hover:text-foreground min-w-0 cursor-pointer truncate text-left text-sm font-medium"
                            onClick={() => openContent(contentId)}
                        >
                            {name}
                        </button>
                    ) : (
                        <span className="min-w-0 truncate text-sm font-medium">
                            {name}
                        </span>
                    )}
                    {report.created ? (
                        <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                            {formatDateFilter(report.created, 'long')}
                        </span>
                    ) : null}
                </div>
                <span className="text-muted-foreground truncate text-xs">
                    {[typeLabelKey ? t(typeLabelKey) : type, report.reason]
                        .filter(Boolean)
                        .join(' · ')}
                </span>
                {report.description ? (
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <span className="text-muted-foreground/80 truncate text-xs">
                                    {report.description}
                                </span>
                            }
                        />
                        <TooltipContent className="whitespace-pre-wrap">
                            {report.description}
                        </TooltipContent>
                    </Tooltip>
                ) : null}
            </div>
            <Tooltip>
                <TooltipTrigger
                    render={
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={withdrawLabel}
                            className={cn(
                                'shrink-0',
                                !withdrawing &&
                                    'transition-opacity duration-150 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100'
                            )}
                            disabled={disabled}
                            onClick={onWithdraw}
                        >
                            {withdrawing ? <Spinner /> : <Undo2Icon />}
                        </Button>
                    }
                />
                <TooltipContent>{withdrawLabel}</TooltipContent>
            </Tooltip>
        </li>
    );
}
