import { useTranslation } from 'react-i18next';

import type {
    ActivityPageSeries,
    ActivityPageSummary
} from '@/platform/tauri/bindings';

import { averageMinutesPerDay } from '../activityPageModel';
import { useCountUp } from '../useCountUp';
import { Exhibit } from './ActivityExhibit';
import { ActivitySeriesChart } from './ActivitySeriesChart';

function hours(minutes: number) {
    return minutes / 60;
}

export function ActivityTimeExhibit({
    summary,
    series,
    isDarkMode
}: {
    summary: ActivityPageSummary;
    series: ActivityPageSeries;
    isDarkMode: boolean;
}) {
    const { t } = useTranslation();
    const totalHours = useCountUp(hours(summary.totalMinutes), 1);
    const hoursUnit = t('view.activity.unit.hours');
    const facts = [
        {
            value: `${hours(averageMinutesPerDay(summary)).toFixed(1)}${hoursUnit}`,
            label: t('view.activity.hero.per_day')
        },
        {
            value: String(summary.sessionCount),
            label: t('view.activity.hero.sessions')
        },
        ...(summary.longestSessionMinutes > 0
            ? [
                  {
                      value: `${hours(summary.longestSessionMinutes).toFixed(1)}${hoursUnit}`,
                      label: t('view.activity.hero.longest')
                  }
              ]
            : [])
    ];

    return (
        <Exhibit
            label={t('view.activity.stat.total_time')}
            headline={totalHours.toFixed(1)}
            unit={hoursUnit}
            aside={
                <dl className="flex flex-wrap gap-x-8 gap-y-3">
                    {facts.map((fact) => (
                        <div key={fact.label} className="min-w-0">
                            <dd className="text-foreground text-lg leading-none font-semibold tabular-nums">
                                {fact.value}
                            </dd>
                            <dt className="text-muted-foreground mt-1 text-xs">
                                {fact.label}
                            </dt>
                        </div>
                    ))}
                </dl>
            }
            detailLabel={
                series.bucket === 'week'
                    ? t('view.activity.section.weekly_time')
                    : t('view.activity.section.daily_time')
            }
            detail={
                <ActivitySeriesChart series={series} isDarkMode={isDarkMode} />
            }
        />
    );
}
