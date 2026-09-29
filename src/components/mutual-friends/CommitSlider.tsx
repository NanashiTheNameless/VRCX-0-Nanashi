import type { ReactNode } from 'react';
import { useState } from 'react';

import { Slider } from '@/ui/shadcn/slider';

export function CommitSlider({
    format = String,
    help,
    label,
    max,
    min,
    onCommit,
    step,
    value
}: {
    format?: (value: number) => string;
    help?: ReactNode;
    label: ReactNode;
    max: number;
    min: number;
    onCommit: (value: number) => void;
    step: number;
    value: number;
}) {
    const [draftValue, setDraftValue] = useState<number | null>(null);
    const shownValue = draftValue ?? value;

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <span>{label}</span>
                <span className="text-muted-foreground tabular-nums">
                    {format(shownValue)}
                </span>
            </div>
            <Slider
                min={min}
                max={max}
                step={step}
                value={[shownValue]}
                onValueChange={(next) =>
                    setDraftValue(Array.isArray(next) ? next[0] : next)
                }
                onValueCommitted={(next) => {
                    setDraftValue(null);
                    onCommit(Array.isArray(next) ? next[0] : next);
                }}
            />
            {help ? (
                <p className="text-muted-foreground text-xs">{help}</p>
            ) : null}
        </div>
    );
}
