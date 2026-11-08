import { isReservedBadgeIcon } from '@/domain/badges/customBadges';
import { cn } from '@/lib/utils';

import { useBadgeIconCatalog } from './badgeIcons';

export function BadgeIcon({
    name,
    className,
    allowReserved = false
}: {
    name: string;
    className?: string;
    // Built-in global badges may draw reserved icons; custom badges may not.
    allowReserved?: boolean;
}) {
    const catalog = useBadgeIconCatalog();
    const Icon =
        (!allowReserved && isReservedBadgeIcon(name)
            ? null
            : catalog?.icons[name]) ?? catalog?.icons.Star;
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
