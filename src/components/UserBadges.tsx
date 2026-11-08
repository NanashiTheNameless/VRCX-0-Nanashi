import { CodeXmlIcon, DiamondIcon, ShieldCheckIcon } from 'lucide-react';
import {
    useEffect,
    useMemo,
    useRef,
    type ComponentPropsWithRef,
    type CSSProperties,
    type ReactNode
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
import {
    activeAwardsFor,
    awardAnimations,
    awardIcon,
    DEFAULT_AWARD_ICON,
    awardStyle,
    type ActiveAward,
    type AwardAnimation
} from '@/domain/badges/globalBadges';
import type { FavoriteGroupMap } from '@/domain/favorites/types';
import { formatDateFilter } from '@/lib/dateTime';
import { queryClient } from '@/lib/queryClient';
import { useKnownUserFact } from '@/lib/useKnownUser';
import { cn } from '@/lib/utils';
import {
    FORK_DEVELOPER_USER_ID,
    UPSTREAM_DEVELOPER_USER_ID,
    VRCHAT_STAFF_GROUP_ID
} from '@/shared/constants/user';
import {
    ensureCustomBadgesLoaded,
    useCustomBadgeStore
} from '@/state/customBadgeStore';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import {
    ensureGlobalBadgesLoaded,
    useGlobalBadgeStore
} from '@/state/globalBadgeStore';
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
    if (userId === FORK_DEVELOPER_USER_ID) {
        return 'fork';
    }
    if (userId === UPSTREAM_DEVELOPER_USER_ID) {
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

    const forkShortLabel = t('dialog.user.badges.fork_developer_short', {
        defaultValue: 'Dev'
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
                {/* Effect layers: a breathing red rim, and red and white
                    copies of the icon and label that split off while it
                    glitches. */}
                <span aria-hidden="true" className="fork-dev-fx fork-dev-rim" />
                {(['red', 'white'] as const).map((tint) => (
                    <span
                        key={tint}
                        aria-hidden="true"
                        className={`fork-dev-fx fork-dev-ghost fork-dev-ghost--${tint}`}
                    >
                        <CodeXmlIcon />
                        {size === 'full' ? <span>{forkShortLabel}</span> : null}
                    </span>
                ))}
                <CodeXmlIcon aria-hidden="true" />
                {size === 'full' ? (
                    <span aria-hidden="true">{forkShortLabel}</span>
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

function formatAwardDate(seconds: number): string {
    return formatDateFilter(seconds, 'date');
}

// Effects drawn on a layer of their own inside the badge.
const LAYER_EFFECTS: ReadonlySet<AwardAnimation> = new Set([
    'shimmer',
    'flow',
    'sparkle',
    'glow',
    'embers'
]);
// Effects drawn as separate particles get several layers, so each pair of
// particles can keep its own timing instead of moving as one sheet.
const LAYER_COUNTS: Partial<Record<AwardAnimation, number>> = {
    sparkle: 3,
    embers: 3
};
// Effects that move the icon, by the wrapper class each uses. Nested
// wrappers combine, so a wiggling icon can also flip.
const ICON_EFFECTS: Partial<Record<AwardAnimation, string>> = {
    wiggle: 'wiggle',
    flip: 'flip',
    embers: 'flicker'
};
// Effects that draw a little past the badge's edge without changing its size.
const SPILLING_EFFECTS: ReadonlySet<AwardAnimation> = new Set(['glow']);

// Awarded by the maintainer through data/global-badges.jsonc. Built in:
// never collapsed, and their icons are reserved so custom badges cannot
// imitate them.
export function GlobalBadgeChip({
    award,
    size = 'compact',
    className
}: {
    award: ActiveAward;
    size?: BadgeSize;
    className?: string;
}) {
    const { t } = useTranslation();
    const { badge, grant } = award;
    const style = awardStyle(badge.style);
    const effects = awardAnimations(badge.animation);
    // Per-badge colour overrides from the file replace the style's colours.
    const colors: Record<string, string> = {};
    if (badge.colorFrom) {
        colors['--award-from'] = badge.colorFrom;
        colors['--award-glow'] =
            `color-mix(in srgb, ${badge.colorFrom} 60%, transparent)`;
    }
    if (badge.colorTo) colors['--award-to'] = badge.colorTo;
    if (badge.colorBorder) colors['--award-border'] = badge.colorBorder;
    if (badge.colorText) colors['--award-fg'] = badge.colorText;
    const chip = (
        <span
            className={cn(
                'global-badge',
                `global-badge--${style}`,
                effects.map((effect) => `global-badge--anim-${effect}`),
                effects.some((effect) => SPILLING_EFFECTS.has(effect)) &&
                    'global-badge--spill',
                size === 'compact' && 'global-badge--compact',
                className
            )}
            style={colors as CSSProperties}
            role="img"
            aria-label={badge.label}
        >
            {effects
                .filter((effect) => LAYER_EFFECTS.has(effect))
                .flatMap((effect) =>
                    Array.from(
                        { length: LAYER_COUNTS[effect] ?? 1 },
                        (_, index) => (
                            <span
                                key={`${effect}-${index}`}
                                aria-hidden="true"
                                className={`global-badge-fx global-badge-fx--${effect} global-badge-fx--n${index + 1}`}
                            />
                        )
                    )
                )}
            {effects.reduceRight<ReactNode>(
                (icon, effect) =>
                    ICON_EFFECTS[effect] ? (
                        <span
                            aria-hidden="true"
                            className={`global-badge-icon-fx global-badge-icon-fx--${ICON_EFFECTS[effect]}`}
                        >
                            {icon}
                        </span>
                    ) : (
                        icon
                    ),
                <BadgeIcon
                    name={awardIcon(badge.icon)}
                    allowReserved
                    fallback={DEFAULT_AWARD_ICON}
                />
            )}
            {size === 'full' ? (
                <span aria-hidden="true">{badge.label}</span>
            ) : null}
        </span>
    );
    const period =
        grant.since !== null && grant.until !== null
            ? t('dialog.user.badges.award_period', {
                  since: formatAwardDate(grant.since),
                  until: formatAwardDate(grant.until)
              })
            : grant.since !== null
              ? t('dialog.user.badges.award_since', {
                    since: formatAwardDate(grant.since)
                })
              : grant.until !== null
                ? t('dialog.user.badges.award_until', {
                      until: formatAwardDate(grant.until)
                  })
                : '';
    return (
        <Tooltip>
            <TooltipTrigger render={chip} />
            <TooltipContent className="flex max-w-64 flex-col items-start gap-1">
                <div className="font-semibold">{badge.label}</div>
                {badge.description ? <div>{badge.description}</div> : null}
                {grant.reason ? (
                    <div className="opacity-80">{grant.reason}</div>
                ) : null}
                {period ? <div className="opacity-70">{period}</div> : null}
            </TooltipContent>
        </Tooltip>
    );
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
                        defaultValue: 'VRChat Staff'
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

function useActiveAwards(userId: string): ActiveAward[] {
    useEffect(() => {
        ensureGlobalBadgesLoaded();
    }, []);
    const catalog = useGlobalBadgeStore((state) => state.catalog);
    const nowSeconds = useGlobalBadgeStore((state) => state.nowSeconds);
    return useMemo(
        () => activeAwardsFor(catalog, userId, nowSeconds),
        [catalog, userId, nowSeconds]
    );
}

export function UserBadges({
    userId,
    size = 'compact',
    className,
    collapsible = true
}: UserBadgesProps) {
    const normalizedUserId = userId?.trim() ?? '';
    const { isStaff, customBadges } = useUserBadgeState(normalizedUserId);
    const hasDeveloperBadge = developerBadgeKind(normalizedUserId) !== null;
    const awards = useActiveAwards(normalizedUserId);
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

    if (
        !hasDeveloperBadge &&
        !isStaff &&
        !awards.length &&
        !customBadges.length
    ) {
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
            {hasDeveloperBadge || isStaff || awards.length ? (
                <span
                    ref={builtinRef}
                    className="inline-flex items-center gap-1"
                >
                    <DeveloperBadge userId={normalizedUserId} size={size} />
                    {isStaff ? <VrchatStaffBadge size={size} /> : null}
                    {awards.map((award) => (
                        <GlobalBadgeChip
                            key={award.badge.id}
                            award={award}
                            size={size}
                        />
                    ))}
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
