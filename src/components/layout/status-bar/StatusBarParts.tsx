import type { MouseEventHandler, ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/ui/shadcn/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

export function StatusDot({
    active,
    warn = false,
    className
}: {
    active: boolean;
    warn?: boolean;
    className?: string;
}) {
    let color = 'bg-muted-foreground/40';
    if (warn) {
        color = 'bg-[var(--status-active)]';
    } else if (active) {
        color = 'bg-[var(--status-online)]';
    }

    return (
        <span
            className={cn(
                'inline-block size-2 shrink-0 rounded-full transition-colors duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none',
                color,
                className
            )}
        />
    );
}

export function StatusSegment({
    visible = true,
    active = false,
    warn = false,
    showDot = true,
    dimWhenInactive = false,
    icon,
    label,
    value,
    children,
    className,
    dotClassName,
    labelClassName,
    onClick,
    onContextMenu,
    tooltip,
    valueClassName
}: {
    visible?: boolean;
    active?: boolean;
    warn?: boolean;
    showDot?: boolean;
    dimWhenInactive?: boolean;
    icon?: ReactNode;
    label: ReactNode;
    value?: ReactNode;
    children?: ReactNode;
    className?: string;
    dotClassName?: string;
    labelClassName?: string;
    onClick?: MouseEventHandler<HTMLButtonElement>;
    onContextMenu?: MouseEventHandler<HTMLButtonElement>;
    tooltip?: ReactNode;
    valueClassName?: string;
}) {
    if (!visible) {
        return null;
    }

    const content = (
        <>
            {icon}
            {!icon && showDot ? (
                <StatusDot
                    active={active}
                    className={dotClassName}
                    warn={warn}
                />
            ) : null}
            <span
                className={cn(
                    'shrink-0 text-xs',
                    dimWhenInactive && !active
                        ? 'text-content-tertiary/55'
                        : 'text-content-tertiary',
                    labelClassName
                )}
            >
                {label}
            </span>
            {value ? (
                <span
                    className={cn(
                        'text-content-secondary min-w-0 truncate text-xs',
                        valueClassName
                    )}
                >
                    {value}
                </span>
            ) : null}
            {children}
        </>
    );

    if (typeof onClick === 'function') {
        const segment = (
            <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                    'h-6 min-w-0 shrink-0 justify-start gap-1.5 rounded-none px-2 text-left font-normal',
                    className
                )}
                onClick={onClick}
                onContextMenu={onContextMenu}
            >
                {content}
            </Button>
        );
        if (!tooltip) {
            return segment;
        }
        return (
            <Tooltip>
                <TooltipTrigger render={segment} />
                <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
            </Tooltip>
        );
    }

    const segment = (
        <div
            className={cn(
                'flex h-6 min-w-0 shrink-0 items-center gap-1.5 px-2',
                className
            )}
        >
            {content}
        </div>
    );
    if (!tooltip) {
        return segment;
    }
    return (
        <Tooltip>
            <TooltipTrigger render={segment} />
            <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
        </Tooltip>
    );
}
