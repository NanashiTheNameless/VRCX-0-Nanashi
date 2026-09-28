import { CheckIcon, ImageIcon } from 'lucide-react';
import type { ComponentType, CSSProperties } from 'react';

import { FadeInImage } from '@/components/media/FadeInImage';
import { cn } from '@/lib/utils';
import {
    TILE_BADGE,
    TILE_BUSY_OVERLAY,
    TILE_CHECK,
    TILE_CHECK_ANCHOR,
    TILE_LABEL,
    TILE_LOCKED,
    TILE_MOTION,
    TILE_SURFACE
} from '@/shared/constants/selectableTile';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';

import { TileShell } from './TileShell';

export function SelectableTile({
    label,
    showLabel = false,
    hint,
    badge,
    imageUrl,
    imageClassName = 'max-h-full max-w-full object-contain',
    previewStyle,
    icon: Icon,
    fallbackIcon = true,
    isCurrent,
    locked,
    busy,
    inert,
    aspectClassName = 'aspect-square',
    surfaceClassName,
    onClick
}: {
    label: string;
    showLabel?: boolean;
    hint?: string;
    badge?: string;
    imageUrl?: string;
    imageClassName?: string;
    previewStyle?: CSSProperties;
    icon?: ComponentType<{ className?: string }>;
    fallbackIcon?: boolean;
    isCurrent: boolean;
    locked?: boolean;
    busy?: boolean;
    inert: boolean;
    aspectClassName?: string;
    surfaceClassName?: string;
    onClick: () => void;
}) {
    return (
        <TileShell
            selected={isCurrent}
            className={cn(
                'group/tile h-auto w-full p-0 aria-disabled:cursor-not-allowed',
                TILE_MOTION,
                aspectClassName,
                locked && TILE_LOCKED
            )}
            render={
                <Button
                    type="button"
                    variant="ghost"
                    aria-disabled={inert || undefined}
                    aria-label={hint ? `${label}. ${hint}` : label}
                    aria-pressed={isCurrent}
                    title={hint ? `${label} - ${hint}` : label}
                    onClick={inert ? undefined : onClick}
                />
            }
        >
            <div
                className={cn(TILE_SURFACE, surfaceClassName)}
                style={previewStyle}
            >
                {Icon ? (
                    <Icon className="size-6" />
                ) : imageUrl ? (
                    <FadeInImage
                        src={imageUrl}
                        alt=""
                        loading="lazy"
                        className={imageClassName}
                        fallback={<ImageIcon className="size-6" />}
                    />
                ) : fallbackIcon ? (
                    <ImageIcon className="size-6" />
                ) : null}
            </div>
            {showLabel ? <span className={TILE_LABEL}>{label}</span> : null}
            {badge ? <span className={TILE_BADGE}>{badge}</span> : null}
            {isCurrent ? (
                <span className={cn(TILE_CHECK, TILE_CHECK_ANCHOR)}>
                    <CheckIcon className="size-3" />
                </span>
            ) : null}
            {busy ? (
                <span className={TILE_BUSY_OVERLAY}>
                    <Spinner className="size-5" />
                </span>
            ) : null}
        </TileShell>
    );
}
