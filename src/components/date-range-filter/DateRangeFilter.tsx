import { CalendarRangeIcon } from 'lucide-react';
import { useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { useTranslation } from 'react-i18next';

import { parseDateInput, toDateInputValue } from '@/lib/dateRange';
import { useTodayDate } from '@/lib/useTodayDate';
import { usePreferencesStore } from '@/state/preferencesStore';
import { Button } from '@/ui/shadcn/button';
import { Calendar } from '@/ui/shadcn/calendar';
import { InputGroupButton } from '@/ui/shadcn/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

export function DateRangeFilter({
    dateFrom,
    dateTo,
    onChange,
    label: rangeLabel
}: {
    dateFrom: string;
    dateTo: string;
    onChange(from: string, to: string): void;
    label: string;
}) {
    const todayDate = useTodayDate();
    const [dateFilterOpen, setDateFilterOpen] = useState(false);
    const [dateDraftRange, setDateDraftRange] = useState<DateRange>();
    const dateDraftFrom = toDateInputValue(dateDraftRange?.from);
    const dateDraftTo = toDateInputValue(dateDraftRange?.to);
    function onDateFilterOpenChange(open: boolean) {
        if (open) {
            const from = parseDateInput(dateFrom);
            const to = parseDateInput(dateTo);
            setDateDraftRange(from || to ? { from, to } : undefined);
        }
        setDateFilterOpen(open);
    }
    function onApplyDateFilter() {
        if (dateDraftFrom && dateDraftTo && dateDraftFrom > dateDraftTo) {
            onChange(dateDraftTo, dateDraftFrom);
        } else {
            onChange(dateDraftFrom, dateDraftTo);
        }
        setDateFilterOpen(false);
    }
    function onClearDateFilter() {
        setDateDraftRange(undefined);
        onChange('', '');
        setDateFilterOpen(false);
    }
    const { t } = useTranslation();
    const weekStartsOn = usePreferencesStore((state) => state.weekStartsOn);
    const hasRange = Boolean(dateFrom || dateTo);
    const label = hasRange
        ? [dateFrom || '...', dateTo || '...'].join(' - ')
        : rangeLabel;

    return (
        <Popover open={dateFilterOpen} onOpenChange={onDateFilterOpenChange}>
            <Tooltip>
                <TooltipTrigger
                    render={
                        <PopoverTrigger
                            render={
                                <InputGroupButton
                                    variant={hasRange ? 'secondary' : 'ghost'}
                                    size="icon-xs"
                                />
                            }
                            aria-label={
                                hasRange ? `${rangeLabel}: ${label}` : label
                            }
                        />
                    }
                >
                    <CalendarRangeIcon data-icon="icon" />
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
            </Tooltip>
            <PopoverContent
                className="w-auto"
                align="end"
                aria-label={rangeLabel}
            >
                <Calendar
                    mode="range"
                    numberOfMonths={2}
                    defaultMonth={dateDraftRange?.from ?? todayDate}
                    selected={dateDraftRange}
                    disabled={{ after: todayDate }}
                    weekStartsOn={weekStartsOn}
                    onSelect={setDateDraftRange}
                />
                <div className="flex items-center justify-between gap-4 px-3 pb-3">
                    <div className="text-muted-foreground min-w-0 text-xs">
                        {[dateDraftFrom || '...', dateDraftTo || '...'].join(
                            ' - '
                        )}
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onClearDateFilter}
                        >
                            {t('common.actions.clear')}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            onClick={onApplyDateFilter}
                        >
                            {t('common.actions.confirm')}
                        </Button>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
