import { useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function LocationPendingText({
    pending,
    className,
    placeholderClassName = 'w-24',
    children
}: {
    pending: boolean;
    className?: string;
    placeholderClassName?: string;
    children: ReactNode;
}) {
    const [wasPending, setWasPending] = useState(pending);
    if (pending && !wasPending) {
        setWasPending(true);
    }

    if (pending) {
        return (
            <span
                key="pending"
                aria-hidden="true"
                data-slot="location-pending"
                className="animate-in fade-in fill-mode-both inline-block align-middle delay-150 duration-150 motion-reduce:animate-none"
            >
                <span
                    className={cn(
                        'bg-muted inline-block h-3 animate-pulse rounded-sm',
                        placeholderClassName
                    )}
                />
            </span>
        );
    }

    return (
        <span
            key="resolved"
            className={cn(
                wasPending &&
                    'animate-in fade-in duration-150 ease-out motion-reduce:animate-none',
                className
            )}
        >
            {children}
        </span>
    );
}
