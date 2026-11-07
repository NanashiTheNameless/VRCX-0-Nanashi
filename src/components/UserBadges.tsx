import { CodeXmlIcon, DiamondIcon, ShieldCheckIcon } from 'lucide-react';
import {
    useEffect,
    useRef,
    type ComponentPropsWithRef,
    type CSSProperties
} from 'react';
import { useTranslation } from 'react-i18next';

import {
    useCustomBadgeLevel,
    type CustomBadgeLevel
} from '@/components/badges/badgeFit';
import { BadgeIcon } from '@/components/badges/BadgeIcon';
import {
    badgeRuleGroupIds,
    badgeUserFactsFrom,
    buildCustomBadgeIndex,
    isVrchatStaff,
    readableTextColor,
    resolveUserCustomBadges,
    type CustomBadge,
    type CustomBadgeIndex
} from '@/domain/badges/customBadges';
import type { FavoriteGroupMap } from '@/domain/favorites/types';
import { queryClient } from '@/lib/queryClient';
import { useKnownUserFact } from '@/lib/useKnownUser';
import { cn } from '@/lib/utils';
import {
    FORK_MAINTAINER_USER_ID,
    OWNER_USER_ID,
    VRCHAT_STAFF_GROUP_ID
} from '@/shared/constants/user';
import {
    ensureCustomBadgesLoaded,
    useCustomBadgeStore
} from '@/state/customBadgeStore';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import {
    groupMembership,
    setTrackedGroupIds,
    trackUserGroupMembership,
    useUserGroupMembershipStore
} from '@/state/userGroupMembershipStore';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

export type DeveloperBadgeKind = 'fork' | 'upstream';
type BadgeSize = 'full' | 'compact';

export function developerBadgeKind(
    userId: string | null | undefined
): DeveloperBadgeKind | null {
    if (!userId) {
        return null;
    }
    if (userId === FORK_MAINTAINER_USER_ID) {
        return 'fork';
    }
    if (userId === OWNER_USER_ID) {
        return 'upstream';
    }
    return null;
}

type DeveloperBadgeProps = {
    userId: string | null | undefined;
    // `full` adds the text label to the fork badge; `compact` fits table rows.
    size?: BadgeSize;
    className?: string;
};

// Built in and unconditional: no setting, rule or preference can hide these.
export function DeveloperBadge({
    userId,
    size = 'compact',
    className
}: DeveloperBadgeProps) {
    const { t } = useTranslation();
    const kind = developerBadgeKind(userId);
    if (!kind) {
        return null;
    }

    const label =
        kind === 'fork'
            ? t('dialog.user.badges.fork_developer', {
                  defaultValue: 'VRCX-0-Nanashi Developer'
              })
            : t('dialog.user.badges.upstream_developer', {
                  defaultValue: 'Upstream VRCX-0 Developer'
              });

    const badge =
        kind === 'fork' ? (
            <span
                className={cn(
                    'fork-dev-badge',
                    size === 'compact' && 'fork-dev-badge--compact',
                    className
                )}
                role="img"
                aria-label={label}
            >
                <CodeXmlIcon aria-hidden="true" />
                {size === 'full' ? (
                    <span aria-hidden="true">
                        {t('dialog.user.badges.fork_developer_short', {
                            defaultValue: 'Dev'
                        })}
                    </span>
                ) : null}
            </span>
        ) : (
            <span
                className={cn(
                    'upstream-dev-badge',
                    size === 'compact' && 'upstream-dev-badge--compact',
                    className
                )}
                role="img"
                aria-label={label}
            >
                <DiamondIcon aria-hidden="true" />
                {size === 'full' ? (
                    <span aria-hidden="true">
                        {t('dialog.user.badges.upstream_developer_short', {
                            defaultValue: 'Upstream'
                        })}
                    </span>
                ) : null}
            </span>
        );

    return (
        <Tooltip>
            <TooltipTrigger render={badge} />
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

let cachedIndex: {
    badges: readonly CustomBadge[];
    remote: Readonly<Record<string, readonly string[]>>;
    local: FavoriteGroupMap;
    index: CustomBadgeIndex;
} | null = null;

// Every name on screen asks for the index, so build it once per input change
// instead of once per row.
function customBadgeIndexFor(
    badges: readonly CustomBadge[],
    remote: Readonly<Record<string, readonly string[]>>,
    local: FavoriteGroupMap
): CustomBadgeIndex {
    if (
        !cachedIndex ||
        cachedIndex.badges !== badges ||
        cachedIndex.remote !== remote ||
        cachedIndex.local !== local
    ) {
        cachedIndex = {
            badges,
            remote,
            local,
            index: buildCustomBadgeIndex(badges, remote, local)
        };
    }
    return cachedIndex.index;
}

type UserBadgeState = {
    isStaff: boolean;
    customBadges: CustomBadge[];
};

function useUserBadgeState(userId: string): UserBadgeState {
    useEffect(() => {
        ensureCustomBadgesLoaded();
    }, []);
    useEffect(() => {
        trackUserGroupMembership(queryClient);
    }, []);
    const membership = useUserGroupMembershipStore((state) =>
        userId ? state.byUser.get(userId) : undefined
    );
    const badges = useCustomBadgeStore((state) => state.badges);
    useEffect(() => {
        setTrackedGroupIds(badgeRuleGroupIds(badges));
    }, [badges]);
    const remote = useFavoriteStore(
        (state) => state.groupedFavoriteFriendIdsByGroupKey
    );
    const local = useFavoriteStore((state) => state.localFriendFavorites);
    const index = customBadgeIndexFor(badges, remote, local);
    const fact = useKnownUserFact(userId || null) as Record<
        string,
        unknown
    > | null;
    const isFriend = useFriendRosterStore((state) =>
        index.needsFacts && userId ? Boolean(state.friendsById[userId]) : false
    );
    if (!userId) {
        return { isStaff: false, customBadges: [] };
    }
    return {
        isStaff:
            groupMembership(membership, VRCHAT_STAFF_GROUP_ID) === true ||
            isVrchatStaff(fact),
        customBadges: index.badgesById.size
            ? resolveUserCustomBadges(
                  index,
                  userId,
                  index.needsFacts
                      ? badgeUserFactsFrom(
                            fact,
                            isFriend || fact?.isFriend === true,
                            userId,
                            (groupId) => groupMembership(membership, groupId)
                        )
                      : null
              )
            : []
    };
}

// Built in like the developer badges: shown for every VRChat staff account and
// impossible to hide or imitate.
export function VrchatStaffBadge({
    size = 'compact',
    className
}: {
    size?: BadgeSize;
    className?: string;
}) {
    const { t } = useTranslation();
    const label = t('dialog.user.badges.vrchat_staff', {
        defaultValue: 'VRChat Staff'
    });
    const badge = (
        <span
            className={cn(
                'vrchat-staff-badge',
                size === 'compact' && 'vrchat-staff-badge--compact',
                className
            )}
            role="img"
            aria-label={label}
        >
            <ShieldCheckIcon aria-hidden="true" />
            {size === 'full' ? (
                <span aria-hidden="true">
                    {t('dialog.user.badges.vrchat_staff_short', {
                        defaultValue: 'Staff'
                    })}
                </span>
            ) : null}
        </span>
    );
    return (
        <Tooltip>
            <TooltipTrigger render={badge} />
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

function CustomBadgeVisual({
    badge,
    size
}: {
    badge: Pick<CustomBadge, 'label' | 'icon' | 'color'>;
    size: BadgeSize;
}) {
    const style = {
        '--custom-badge-color': badge.color,
        '--custom-badge-fg': readableTextColor(badge.color)
    } as CSSProperties;
    return (
        <span
            className={cn(
                'custom-user-badge',
                size === 'compact' && 'custom-user-badge--compact'
            )}
            style={style}
        >
            <BadgeIcon name={badge.icon} />
            {size === 'full' ? (
                <span className="truncate">{badge.label}</span>
            ) : null}
        </span>
    );
}

export function CustomBadgeChip({
    badge,
    size = 'compact',
    className
}: {
    badge: Pick<CustomBadge, 'label' | 'icon' | 'color'>;
    size?: BadgeSize;
    className?: string;
}) {
    const style = {
        '--custom-badge-color': badge.color,
        '--custom-badge-fg': readableTextColor(badge.color)
    } as CSSProperties;
    const chip = (
        <span
            className={cn(
                'custom-user-badge',
                size === 'compact' && 'custom-user-badge--compact',
                className
            )}
            style={style}
            role="img"
            aria-label={badge.label}
        >
            <BadgeIcon name={badge.icon} />
            {size === 'full' ? (
                <span aria-hidden="true" className="truncate">
                    {badge.label}
                </span>
            ) : null}
        </span>
    );
    return (
        <Tooltip>
            <TooltipTrigger render={chip} />
            <TooltipContent>{badge.label}</TooltipContent>
        </Tooltip>
    );
}

const FOLDER_SLOTS = 4;

// Rest props and ref come from the tooltip trigger, which renders this tile
// and needs its hover, focus and position handlers on the element itself.
function CustomBadgeFolderVisual({
    badges,
    size,
    label,
    className,
    ref,
    ...rest
}: Omit<ComponentPropsWithRef<'span'>, 'children'> & {
    badges: readonly CustomBadge[];
    size: BadgeSize;
    label?: string;
}) {
    return (
        <span
            {...rest}
            ref={ref}
            className={cn(
                'custom-user-badge-folder',
                size === 'full' && 'custom-user-badge-folder--full',
                className
            )}
            role={label ? 'img' : undefined}
            aria-label={label}
        >
            {badges.slice(0, FOLDER_SLOTS).map((badge) => (
                <span
                    key={badge.id}
                    className="custom-user-badge-folder__cell"
                    style={
                        {
                            '--custom-badge-color': badge.color,
                            '--custom-badge-fg': readableTextColor(badge.color)
                        } as CSSProperties
                    }
                >
                    <BadgeIcon name={badge.icon} />
                </span>
            ))}
        </span>
    );
}

// Collapsed custom badges: one small tile holding mini versions of up to four
// badge icons, like an app folder. The tooltip lists every badge.
export function CustomBadgeFolder({
    badges,
    size = 'compact'
}: {
    badges: readonly CustomBadge[];
    size?: BadgeSize;
}) {
    const label = badges.map((badge) => badge.label).join(', ');
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <CustomBadgeFolderVisual
                        badges={badges}
                        size={size}
                        label={label}
                    />
                }
            />
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

type UserBadgesProps = DeveloperBadgeProps & {
    // Off where the name never truncates (the user dialog header shrinks its
    // font instead, the hover card puts badges on their own line).
    collapsible?: boolean;
};

export function UserBadges({
    userId,
    size = 'compact',
    className,
    collapsible = true
}: UserBadgesProps) {
    const normalizedUserId = userId?.trim() ?? '';
    const { isStaff, customBadges } = useUserBadgeState(normalizedUserId);
    const hasDeveloperBadge = developerBadgeKind(normalizedUserId) !== null;
    const wrapperRef = useRef<HTMLSpanElement>(null);
    const builtinRef = useRef<HTMLSpanElement>(null);
    const measureRef = useRef<HTMLSpanElement>(null);
    const levels: CustomBadgeLevel[] =
        size === 'full' ? ['full', 'icons', 'folder'] : ['icons', 'folder'];
    const level = useCustomBadgeLevel({
        enabled: collapsible && customBadges.length > 1,
        levels,
        wrapperRef,
        builtinRef,
        measureRef,
        contentKey: customBadges.map((badge) => badge.id).join(',')
    });

    if (!hasDeveloperBadge && !isStaff && !customBadges.length) {
        return null;
    }

    return (
        <span
            ref={wrapperRef}
            className={cn(
                'relative inline-flex shrink-0 items-center gap-1 align-middle',
                className
            )}
        >
            {hasDeveloperBadge || isStaff ? (
                <span
                    ref={builtinRef}
                    className="inline-flex items-center gap-1"
                >
                    <DeveloperBadge userId={normalizedUserId} size={size} />
                    {isStaff ? <VrchatStaffBadge size={size} /> : null}
                </span>
            ) : null}
            {customBadges.length ? (
                level === 'folder' ? (
                    <CustomBadgeFolder badges={customBadges} size={size} />
                ) : (
                    customBadges.map((badge) => (
                        <CustomBadgeChip
                            key={badge.id}
                            badge={badge}
                            size={level === 'full' ? 'full' : 'compact'}
                        />
                    ))
                )
            ) : null}
            {collapsible && customBadges.length > 1 ? (
                <span
                    ref={measureRef}
                    aria-hidden="true"
                    className="pointer-events-none invisible absolute top-0 left-0 flex flex-col items-start"
                >
                    {levels.map((entry) => (
                        <span
                            key={entry}
                            data-badge-level={entry}
                            className="inline-flex items-center gap-1 whitespace-nowrap"
                        >
                            {entry === 'folder' ? (
                                <CustomBadgeFolderVisual
                                    badges={customBadges}
                                    size={size}
                                />
                            ) : (
                                customBadges.map((badge) => (
                                    <CustomBadgeVisual
                                        key={badge.id}
                                        badge={badge}
                                        size={
                                            entry === 'full'
                                                ? 'full'
                                                : 'compact'
                                        }
                                    />
                                ))
                            )}
                        </span>
                    ))}
                </span>
            ) : null}
        </span>
    );
}
