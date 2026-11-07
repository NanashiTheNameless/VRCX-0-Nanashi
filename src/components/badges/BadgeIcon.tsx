import { isReservedBadgeIcon } from '@/domain/badges/customBadges';
import { cn } from '@/lib/utils';

import { useBadgeIconCatalog } from './badgeIcons';

export function BadgeIcon({
    name,
    className
}: {
    name: string;
    className?: string;
}) {
    const catalog = useBadgeIconCatalog();
    const Icon =
        (isReservedBadgeIcon(name) ? null : catalog?.icons[name]) ??
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
