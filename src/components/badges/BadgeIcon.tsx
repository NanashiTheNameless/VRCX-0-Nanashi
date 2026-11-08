import { isReservedBadgeIcon } from '@/domain/badges/customBadges';
import { cn } from '@/lib/utils';
import { useGlobalBadgeIcons } from '@/state/globalBadgeStore';

import { useBadgeIconCatalog } from './badgeIcons';

export function BadgeIcon({
    name,
    className,
    allowReserved = false,
    fallback = 'Star'
}: {
    name: string;
    className?: string;
    // Built-in global badges may draw reserved icons; custom badges may not.
    allowReserved?: boolean;
    // Drawn when the icon set has no icon by that name.
    fallback?: string;
}) {
    const catalog = useBadgeIconCatalog();
    const globalIcons = useGlobalBadgeIcons();
    const Icon =
        (!allowReserved && isReservedBadgeIcon(name, globalIcons)
            ? null
            : catalog?.icons[name]) ??
        catalog?.icons[fallback] ??
        catalog?.icons.Star;
    if (!Icon) {
        return (
            <span
                aria-hidden="true"
                className={cn('inline-block size-3 shrink-0', className)}
            />
        );
    }
    return <Icon aria-hidden="true" className={className} />;
}
