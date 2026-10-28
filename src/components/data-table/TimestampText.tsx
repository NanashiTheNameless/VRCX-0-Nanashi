import { formatDateFilter } from '@/lib/dateTime';
import type { DateFilterFormat } from '@/shared/utils/dateTime';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useShellStore } from '@/state/shellStore';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

export function useDateFormatPreferenceKey() {
    const timeZone = usePreferencesStore((state) => state.dtTimeZone);
    const shellKey = useShellStore(
        (state) =>
            `${state.locale}|${state.dateCulture}|${state.dateIsoFormat}|${state.dateHour12}|${state.dateFormat}`
    );
    return `${shellKey}|${timeZone}`;
}

export function TimestampText({
    value,
    format = 'short',
    tooltip = true,
    tooltipSide,
    emptyText,
    className
}: {
    value: unknown;
    format?: DateFilterFormat;
    tooltip?: boolean;
    tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
    emptyText?: string;
    className?: string;
}) {
    useDateFormatPreferenceKey();
    const formatted = formatDateFilter(value, format);
    const text = formatted === '-' && emptyText ? emptyText : formatted;

    if (!tooltip || formatted === '-') {
        return <span className={className}>{text}</span>;
    }

    return (
        <Tooltip>
            <TooltipTrigger
                render={<span className={className}>{text}</span>}
            />
            <TooltipContent side={tooltipSide}>
                {formatDateFilter(value, 'long')}
            </TooltipContent>
        </Tooltip>
    );
}
