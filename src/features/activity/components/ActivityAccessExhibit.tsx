import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import type { ActivityPageAccessSlice } from '@/platform/tauri/bindings';

import {
    accessBucketLabelKey,
    accessShare,
    visibleAccessSlices
} from '../activityPageModel';
import { Exhibit } from './ActivityExhibit';

const RANK_TINTS = [
    'var(--act-heat-4)',
    'var(--act-heat-3)',
    'var(--act-heat-2)',
    'var(--act-heat-1)',
    'var(--act-heat-0)',
    'var(--act-heat-min)'
];

function rankTint(index: number) {
    return RANK_TINTS[Math.min(index, RANK_TINTS.length - 1)];
}

export function ActivityAccessExhibit({
    slices
}: {
    slices: ActivityPageAccessSlice[];
}) {
    const { t } = useTranslation();
    const totalMinutes = slices.reduce((sum, slice) => sum + slice.minutes, 0);
    const visible = visibleAccessSlices(slices);
    const [lead] = visible;

    if (totalMinutes <= 0 || !lead) {
        return null;
    }

    const hoursUnit = t('view.activity.unit.hours');

    return (
        <Exhibit
            label={t('view.activity.section.instance_types')}
            headline={t(accessBucketLabelKey(lead.access))}
        >
            <div className="flex flex-col gap-2.5">
                {visible.map((slice, index) => {
                    const share = accessShare(slice.minutes, totalMinutes);
                    return (
                        <div
                            key={slice.access}
                            className="flex items-center gap-3"
                        >
                            <span
                                className={cn(
                                    'w-20 shrink-0 truncate text-xs',
                                    index === 0
                                        ? 'text-foreground font-medium'
                                        : 'text-muted-foreground'
                                )}
                            >
                                {t(accessBucketLabelKey(slice.access))}
                            </span>
                            <span className="h-1.5 min-w-0 flex-1 bg-[var(--act-track)]">
                                <span
                                    className="block h-full"
                                    style={{
                                        width: `${Math.max(share, 1)}%`,
                                        backgroundColor: rankTint(index)
                                    }}
                                />
                            </span>
                            <span className="text-foreground w-8 shrink-0 text-right text-xs tabular-nums">
                                {share}%
                            </span>
                            <span className="text-muted-foreground w-20 shrink-0 text-right text-xs tabular-nums">
                                {(slice.minutes / 60).toFixed(1)}
                                {hoursUnit}
                            </span>
                        </div>
                    );
                })}
            </div>
        </Exhibit>
    );
}
