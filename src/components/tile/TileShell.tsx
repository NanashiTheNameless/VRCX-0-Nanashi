import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';

import { cn } from '@/lib/utils';

const TILE_SHELL_BASE =
    'rounded-object border-object-border bg-object-surface hover:border-object-border-hover hover:bg-object-surface-hover relative min-w-0 overflow-hidden border ring-0 focus-visible:ring-2 transition-[background-color,border-color,box-shadow] duration-(--motion-fast) ease-(--ease-out-ui)';

const TILE_SHELL_SELECTED =
    'border-object-selected-border bg-object-selected-surface ring-object-selected-border hover:border-object-selected-border hover:bg-object-selected-surface ring-2';

export function TileShell({
    selected = false,
    className,
    render,
    children,
    ...props
}: useRender.ComponentProps<'div'> & { selected?: boolean }) {
    return useRender({
        defaultTagName: 'div',
        render,
        props: mergeProps<'div'>(
            {
                className: cn(
                    TILE_SHELL_BASE,
                    selected && TILE_SHELL_SELECTED,
                    className
                ),
                children
            },
            props
        )
    });
}
