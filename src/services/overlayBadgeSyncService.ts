import type { LucideIcon } from 'lucide-react';

import { iconNodeOf, iconNodeToPath } from '@/components/badges/badgeIconPath';
import { loadBadgeIcons } from '@/components/badges/badgeIcons';
import {
    badgeRuleGroupIds,
    badgeUserFactsFrom,
    buildCustomBadgeIndex,
    isReservedBadgeIcon,
    isVrchatStaff,
    readableTextColor,
    resolveUserCustomBadges,
    type CustomBadge
} from '@/domain/badges/customBadges';
import {
    activeAwardsFor,
    awardIcon,
    awardAnimations,
    awardStyle,
    DEFAULT_AWARD_ICON,
    type ActiveAward,
    type AwardStyle
} from '@/domain/badges/globalBadges';
import { presenceSection } from '@/domain/friends/presence';
import { normalizeEndpoint, userFactKey } from '@/domain/users/userFacts';
import { queryClient } from '@/lib/queryClient';
import {
    commands,
    type OverlayBadgeStyle,
    type OverlayUserBadges
} from '@/platform/tauri/bindings';
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
    trackLocalModerations,
    useLocalModerationStore
} from '@/state/localModerationStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useUserFactsStore } from '@/state/userFactsStore';
import {
    groupMembership,
    setTrackedGroupIds,
    trackUserGroupMembership,
    useUserGroupMembershipStore
} from '@/state/userGroupMembershipStore';

// Fork: the VR wrist menu, HMD notifications and the Desktop Overlay draw
// user badges themselves. Custom badge rules only run here, so this works
// out every known user's badges the same way the app's own badges do and
// hands the result to the backend whenever it changes. It is a local call;
// nothing leaves the PC.

const SYNC_DELAY_MS = 2000;

type Look = Omit<OverlayBadgeStyle, 'icon'>;

// The app's badge colors from globals.css, flattened to what the overlay can
// draw: a gradient, a border and the icon color.
const FORK_DEVELOPER_LOOK: Look = {
    colorFrom: '#0b0b0c',
    colorTo: '#3a0a0e',
    colorBorder: '#e5202e',
    colorIcon: '#e5202e',
    round: false,
    effects: ['glitch']
};
const UPSTREAM_DEVELOPER_LOOK: Look = {
    colorFrom: '#f4f6f9',
    colorTo: '#9aa3af',
    colorBorder: '#8d96a3',
    colorIcon: '#3b6ea8',
    round: false,
    effects: ['upstream-glint']
};
const VRCHAT_STAFF_LOOK: Look = {
    colorFrom: '#2f7cf6',
    colorTo: '#1557c7',
    colorBorder: '#ffffff',
    colorIcon: '#ffffff',
    round: false
};
const AWARD_LOOKS: Record<AwardStyle, [string, string, string]> = {
    ember: ['#f59e0b', '#db2777', '#c2410c'],
    gold: ['#fcd34d', '#b45309', '#92400e'],
    emerald: ['#34d399', '#047857', '#065f46'],
    sapphire: ['#60a5fa', '#1e40af', '#1e3a8a'],
    amethyst: ['#c084fc', '#6d28d9', '#5b21b6'],
    crimson: ['#fb7185', '#9f1239', '#881337'],
    rose: ['#f9a8d4', '#be185d', '#9d174d'],
    teal: ['#5eead4', '#0f766e', '#115e59'],
    midnight: ['#475569', '#0f172a', '#94a3b8']
};

type IconCatalog = Readonly<Record<string, LucideIcon>>;

const AWARD_GLOWS: Record<AwardStyle, string> = {
    ember: '#ea580c99',
    gold: '#f59e0b8c',
    emerald: '#10b9818c',
    sapphire: '#3b82f68c',
    amethyst: '#9333ea8c',
    crimson: '#e11d488c',
    rose: '#ec489980',
    teal: '#14b8a680',
    midnight: '#94a3b873'
};

class StyleTable {
    readonly styles: OverlayBadgeStyle[] = [];
    private readonly indexes = new Map<string, number>();
    private readonly paths = new Map<string, string>();

    constructor(private readonly icons: IconCatalog) {}

    add(iconName: string, fallback: string, look: Look): number | null {
        const icon = this.path(iconName) || this.path(fallback);
        if (!icon) {
            return null;
        }
        const style = { icon, ...look };
        const key = JSON.stringify(style);
        let index = this.indexes.get(key);
        if (index === undefined) {
            index = this.styles.length;
            this.styles.push(style);
            this.indexes.set(key, index);
        }
        return index;
    }

    private path(name: string): string {
        let path = this.paths.get(name);
        if (path === undefined) {
            const icon = this.icons[name];
            const node = icon ? iconNodeOf(icon) : null;
            path = node ? iconNodeToPath(node) : '';
            this.paths.set(name, path);
        }
        return path;
    }
}

function awardLook(award: ActiveAward): Look {
    const { badge } = award;
    const [from, to, border] = AWARD_LOOKS[awardStyle(badge.style)];
    return {
        colorFrom: badge.colorFrom || from,
        colorTo: badge.colorTo || to,
        colorBorder: badge.colorBorder || border,
        colorIcon: badge.colorText || '#ffffff',
        colorGlow: badge.colorFrom
            ? `${badge.colorFrom}99`
            : AWARD_GLOWS[awardStyle(badge.style)],
        round: false,
        effects: awardAnimations(badge.animation)
    };
}

function customLook(badge: CustomBadge): Look {
    return {
        colorFrom: badge.color,
        colorTo: badge.color,
        colorBorder: badge.color,
        colorIcon: readableTextColor(badge.color),
        round: true
    };
}

/** Every known user's badges, in the order the app shows them. */
export function buildOverlayUserBadges(icons: IconCatalog): OverlayUserBadges {
    const runtime = useRuntimeStore.getState().auth;
    const currentUserId = runtime.currentUserId || '';
    const endpoint = normalizeEndpoint(runtime.currentUserEndpoint);
    const badges = useCustomBadgeStore.getState().badges;
    const favorites = useFavoriteStore.getState();
    const index = buildCustomBadgeIndex(
        badges,
        favorites.groupedFavoriteFriendIdsByGroupKey,
        favorites.localFriendFavorites
    );
    const facts = useUserFactsStore.getState();
    const friendsById = useFriendRosterStore.getState().friendsById;
    const membershipByUser = useUserGroupMembershipStore.getState().byUser;
    const moderationState = useLocalModerationStore.getState();
    const globalState = useGlobalBadgeStore.getState();

    const candidates = new Set<string>([
        FORK_DEVELOPER_USER_ID,
        UPSTREAM_DEVELOPER_USER_ID,
        ...Object.keys(friendsById),
        ...(facts.userIdsByEndpoint[endpoint] ?? []),
        ...index.byUserId.keys(),
        ...membershipByUser.keys(),
        ...(globalState.catalog?.awards.map((grant) => grant.userId) ?? [])
    ]);
    if (currentUserId) {
        candidates.add(currentUserId);
    }

    const table = new StyleTable(icons);
    const users: Record<string, number[]> = {};
    for (const userId of candidates) {
        if (!userId.startsWith('usr_')) {
            continue;
        }
        const fact = (facts.usersByKey[userFactKey(endpoint, userId)] ??
            (userId === currentUserId
                ? runtime.currentUserSnapshot
                : null)) as Record<string, unknown> | null;
        const membership = membershipByUser.get(userId);
        const styles: Array<number | null> = [];

        if (userId === FORK_DEVELOPER_USER_ID) {
            styles.push(table.add('CodeXml', 'CodeXml', FORK_DEVELOPER_LOOK));
        } else if (userId === UPSTREAM_DEVELOPER_USER_ID) {
            styles.push(
                table.add('Diamond', 'Diamond', UPSTREAM_DEVELOPER_LOOK)
            );
        }
        if (
            groupMembership(membership, VRCHAT_STAFF_GROUP_ID) === true ||
            isVrchatStaff(fact)
        ) {
            styles.push(
                table.add('ShieldCheck', 'ShieldCheck', VRCHAT_STAFF_LOOK)
            );
        }
        for (const award of activeAwardsFor(
            globalState.catalog,
            userId,
            globalState.nowSeconds
        )) {
            styles.push(
                table.add(
                    awardIcon(award.badge.icon),
                    DEFAULT_AWARD_ICON,
                    awardLook(award)
                )
            );
        }
        if (index.badgesById.size) {
            const friend = friendsById[userId];
            const custom = resolveUserCustomBadges(
                index,
                userId,
                index.needsFacts
                    ? badgeUserFactsFrom(
                          fact,
                          Boolean(friend) || fact?.isFriend === true,
                          userId,
                          (groupId) => groupMembership(membership, groupId),
                          currentUserId,
                          {
                              friendNumber: friend?.$friendNumber || undefined,
                              presence: friend?.$presence
                                  ? presenceSection(friend.$presence)
                                  : null,
                              moderation:
                                  index.needsModeration &&
                                  moderationState.loaded
                                      ? (moderationState.byUserId.get(
                                            userId
                                        ) ?? { block: false, mute: false })
                                      : null
                          }
                      )
                    : null
            );
            for (const badge of custom) {
                // Custom badges never draw reserved icons, like in the app.
                const icon = isReservedBadgeIcon(badge.icon)
                    ? 'Star'
                    : badge.icon;
                styles.push(table.add(icon, 'Star', customLook(badge)));
            }
        }
        const kept = styles.filter((style): style is number => style !== null);
        if (kept.length) {
            users[userId] = kept;
        }
    }
    return {
        styles: table.styles,
        users,
        animations:
            !usePreferencesStore.getState().reducedMotionAndBlur &&
            (typeof window === 'undefined' ||
                window.matchMedia?.('(prefers-reduced-motion: reduce)')
                    .matches !== true)
    };
}

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastSent = JSON.stringify({ styles: [], users: {} });

async function sync() {
    timer = null;
    try {
        const icons = (await loadBadgeIcons()).icons;
        const badges = useCustomBadgeStore.getState().badges;
        setTrackedGroupIds(badgeRuleGroupIds(badges));
        if (buildCustomBadgeIndex(badges, {}, {}).needsModeration) {
            trackLocalModerations(
                useRuntimeStore.getState().auth.currentUserId
            );
        }
        const table = buildOverlayUserBadges(icons);
        const serialized = JSON.stringify(table);
        if (serialized === lastSent) {
            return;
        }
        await commands.appOverlayUserBadgesSet(table);
        lastSent = serialized;
    } catch (error) {
        console.warn('Could not hand user badges to the overlay.', error);
    }
}

function schedule() {
    timer ??= setTimeout(() => void sync(), SYNC_DELAY_MS);
}

/** Keeps the overlay's copy of everyone's badges current. */
export function startOverlayBadgeSync(): () => void {
    if (started) {
        return () => {};
    }
    started = true;
    ensureCustomBadgesLoaded();
    ensureGlobalBadgesLoaded();
    trackUserGroupMembership(queryClient);
    const reducedMotion =
        typeof window === 'undefined'
            ? undefined
            : window.matchMedia?.('(prefers-reduced-motion: reduce)');
    reducedMotion?.addEventListener('change', schedule);
    const unsubscribers = [
        useCustomBadgeStore.subscribe(schedule),
        useFavoriteStore.subscribe(schedule),
        useFriendRosterStore.subscribe(schedule),
        useGlobalBadgeStore.subscribe(schedule),
        useLocalModerationStore.subscribe(schedule),
        usePreferencesStore.subscribe((state, previous) => {
            if (state.reducedMotionAndBlur !== previous.reducedMotionAndBlur) {
                schedule();
            }
        }),
        useRuntimeStore.subscribe(schedule),
        useUserFactsStore.subscribe(schedule),
        useUserGroupMembershipStore.subscribe(schedule)
    ];
    schedule();
    return () => {
        reducedMotion?.removeEventListener('change', schedule);
        for (const unsubscribe of unsubscribers) {
            unsubscribe();
        }
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        started = false;
    };
}
