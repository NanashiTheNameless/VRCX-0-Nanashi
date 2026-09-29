import type { EChartsType } from 'echarts/core';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { echarts } from '@/lib/echarts';
import type { ActivityPageSeries } from '@/platform/tauri/bindings';

import {
    useActivityPalette,
    type ActivityPalette
} from '../useActivityPalette';

const CHART_HEIGHT = 210;

function buildOption({
    series,
    palette,
    hoursLabel
}: {
    series: ActivityPageSeries;
    palette: ActivityPalette;
    hoursLabel: string;
}) {
    return {
        backgroundColor: 'transparent',
        animationDuration: 700,
        animationDelay: (index: number) => index * 8,
        animationEasing: 'cubicOut' as const,
        tooltip: {
            confine: true,
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            borderWidth: 0,
            formatter: (params: unknown) => {
                const entries = Array.isArray(params) ? params : [params];
                const first = entries[0] as { dataIndex?: number } | undefined;
                const point = series.points[first?.dataIndex ?? -1];
                if (!point) {
                    return '';
                }
                const hours = (point.minutes / 60).toFixed(1);
                return `${point.startDate}<br/><b>${hours}</b>${hoursLabel}`;
            }
        },
        grid: { top: 10, left: 38, right: 6, bottom: 24 },
        xAxis: {
            type: 'category',
            data: series.points.map((point) => point.startDate),
            axisTick: { show: false },
            axisLine: { lineStyle: { color: palette['act-edge'] } },
            axisLabel: {
                color: palette['act-axis'],
                fontSize: 10,
                hideOverlap: true,
                formatter: (value: string) => value.slice(5)
            }
        },
        yAxis: {
            type: 'value',
            splitNumber: 3,
            axisLabel: {
                color: palette['act-axis'],
                fontSize: 10,
                formatter: (value: number) =>
                    `${Math.round(value / 60)}${hoursLabel}`
            },
            splitLine: {
                lineStyle: { color: palette['act-edge'], type: 'dashed' }
            }
        },
        series: [
            {
                type: 'bar',
                data: series.points.map((point) => point.minutes),
                barMaxWidth: 18,
                itemStyle: {
                    borderRadius: 3,
                    color: palette['act-mark']
                },
                emphasis: { itemStyle: { opacity: 0.75 } }
            }
        ]
    };
}

export function ActivitySeriesChart({
    series,
    isDarkMode
}: {
    series: ActivityPageSeries;
    isDarkMode: boolean;
}) {
    const { t } = useTranslation();
    const [chartElement, setChartElement] = useState<HTMLDivElement | null>(
        null
    );
    const chartRef = useRef<EChartsType | null>(null);
    const themeRef = useRef<string | null>(null);
    const observerRef = useRef<ResizeObserver | null>(null);
    const palette = useActivityPalette(chartElement, isDarkMode);

    useEffect(
        () => () => {
            observerRef.current?.disconnect();
            chartRef.current?.dispose();
            observerRef.current = null;
            chartRef.current = null;
            themeRef.current = null;
        },
        []
    );

    const hoursLabel = t('view.activity.unit.hours');

    useEffect(() => {
        if (!chartElement || !palette || series.points.length === 0) {
            return;
        }
        const themeName = isDarkMode ? 'dark' : null;
        let chart = chartRef.current;

        if (!chart || themeRef.current !== themeName) {
            observerRef.current?.disconnect();
            chart?.dispose();
            const next = echarts.init(chartElement, themeName || undefined, {
                height: CHART_HEIGHT
            });
            chart = next;
            chartRef.current = next;
            themeRef.current = themeName;
            observerRef.current = new ResizeObserver(() => {
                next.resize();
            });
            observerRef.current.observe(chartElement);
        }

        chart.setOption(buildOption({ series, palette, hoursLabel }), {
            replaceMerge: ['series', 'xAxis']
        });
    }, [chartElement, hoursLabel, isDarkMode, palette, series]);

    if (series.points.length === 0) {
        return null;
    }

    return (
        <div
            ref={setChartElement}
            className="min-w-0 shrink-0 overflow-hidden"
            style={{ width: '100%', height: CHART_HEIGHT }}
        />
    );
}
