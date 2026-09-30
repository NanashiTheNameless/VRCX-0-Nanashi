import type { ReactNode } from 'react';

import { Separator } from '@/ui/shadcn/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    formatWidgetDate,
    formatWidgetExactTime,
    formatWidgetTime,
    getWidgetDayKey
} from './dashboardWidgetUtils';

type DashboardWidgetTimestamp = string | null | undefined;

function DashboardWidgetDayDivider({
    value
}: {
    value: DashboardWidgetTimestamp;
}) {
    return (
        <div
            className="bg-card sticky top-0 z-[2] flex h-7 items-center gap-2 px-2"
            data-dashboard-widget-day={getWidgetDayKey(value)}
        >
            <span className="text-muted-foreground shrink-0 text-xs font-medium tracking-wide tabular-nums">
                {formatWidgetDate(value)}
            </span>
            <Separator className="flex-1 opacity-60" />
        </div>
    );
}

function DashboardWidgetTime({ value }: { value: DashboardWidgetTimestamp }) {
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                        {formatWidgetTime(value)}
                    </span>
                }
            />
            <TooltipContent>{formatWidgetExactTime(value)}</TooltipContent>
        </Tooltip>
    );
}

export function DashboardWidgetTimelineRow({
    value,
    previousValue,
    isFirst,
    children
}: {
    value: DashboardWidgetTimestamp;
    previousValue: DashboardWidgetTimestamp;
    isFirst: boolean;
    children: ReactNode;
}) {
    const startsDay =
        isFirst || getWidgetDayKey(value) !== getWidgetDayKey(previousValue);

    return (
        <>
            {startsDay ? <DashboardWidgetDayDivider value={value} /> : null}
            <div className="grid min-h-8 grid-cols-[4.75rem_minmax(0,1fr)] items-center gap-2 px-2 py-1 text-sm hover:bg-(--state-hover-surface)">
                <DashboardWidgetTime value={value} />
                {children}
            </div>
        </>
    );
}
