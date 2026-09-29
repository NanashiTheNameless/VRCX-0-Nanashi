import { EyeIcon, EyeOffIcon, UsersRoundIcon, XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MutualGraphBuildHint } from '@/components/mutual-friends/MutualGraphBuildHint';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import type { usePlayerListMutuals } from '../usePlayerListMutuals';

export function PlayerListMutualScan({
    scan
}: {
    scan: ReturnType<typeof usePlayerListMutuals>['scan'];
}) {
    const { t } = useTranslation();
    const { progress, summary } = scan;
    const circlesSuffix = t('view.player_list.mutual_friends.circles_suffix');
    const queryButton = (
        <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!scan.canStart}
            onClick={scan.start}
        >
            <UsersRoundIcon data-icon="inline-start" />
            {scan.completed
                ? t('view.player_list.mutual_friends.requery')
                : t('view.player_list.mutual_friends.query')}
        </Button>
    );
    const showQueryButton = !scan.completed || scan.hasPending;

    return (
        <div className="flex min-w-0 items-center gap-2">
            {scan.needsGraphBuild ? (
                <MutualGraphBuildHint onBeforeNavigate={scan.stop} />
            ) : null}
            {summary && !progress ? (
                <span className="text-muted-foreground flex min-w-0 items-center gap-1 truncate text-xs">
                    <span className="shrink-0">
                        {t('view.player_list.mutual_friends.summary', {
                            count: summary.matchedCount
                        })}
                    </span>
                    {summary.circles.length ? (
                        <>
                            <span className="shrink-0">
                                ·{' '}
                                {t(
                                    'view.player_list.mutual_friends.circles_prefix'
                                )}
                            </span>
                            {summary.circles.map((circle) => (
                                <span
                                    key={circle.index}
                                    className="flex min-w-0 items-center gap-1"
                                >
                                    <span
                                        className="size-2 shrink-0 rounded-full"
                                        style={{
                                            backgroundColor: circle.color
                                        }}
                                    />
                                    <span className="text-foreground/80 truncate">
                                        {circle.label}
                                    </span>
                                </span>
                            ))}
                            {circlesSuffix ? (
                                <span className="shrink-0">
                                    {circlesSuffix}
                                </span>
                            ) : null}
                        </>
                    ) : null}
                </span>
            ) : null}
            {progress ? (
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="tabular-nums"
                    aria-label={t('view.charts.mutual_friend.actions.stop')}
                    onClick={scan.stop}
                >
                    <Spinner data-icon="inline-start" />
                    {progress.done}/{progress.total}
                    <XIcon data-icon="inline-end" />
                </Button>
            ) : (
                <>
                    {showQueryButton && scan.isGraphFetching ? (
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <span className="inline-flex">
                                        {queryButton}
                                    </span>
                                }
                            />
                            <TooltipContent>
                                {t(
                                    'view.player_list.mutual_friends.graph_fetch_running'
                                )}
                            </TooltipContent>
                        </Tooltip>
                    ) : showQueryButton ? (
                        queryButton
                    ) : null}
                    {scan.completed && scan.visible ? (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={scan.hide}
                        >
                            <EyeOffIcon data-icon="inline-start" />
                            {t('view.player_list.mutual_friends.hide')}
                        </Button>
                    ) : null}
                    {scan.completed && !scan.visible && !scan.hasPending ? (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={scan.show}
                        >
                            <EyeIcon data-icon="inline-start" />
                            {t('view.player_list.mutual_friends.show')}
                        </Button>
                    ) : null}
                </>
            )}
        </div>
    );
}
