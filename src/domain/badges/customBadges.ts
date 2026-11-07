import { collectFavoriteGroupFriendIds } from '@/domain/favorites/favoriteGroupSelection';
import type { FavoriteGroupMap } from '@/domain/favorites/types';
import { TRUST_COLOR_DEFAULTS } from '@/shared/constants/trustColors';
import { resolveTrustColorKey } from '@/shared/utils/trustColors';

type TrustColorKey = keyof typeof TRUST_COLOR_DEFAULTS;

export const CUSTOM_BADGES_CONFIG_KEY = 'customUserBadges';
export const CUSTOM_BADGE_LIMIT = 50;
export const CUSTOM_BADGE_LABEL_MAX = 32;
export const CUSTOM_BADGE_MEMO_MAX = 64;
export const CUSTOM_BADGE_GROUP_MEMBER_LIMIT = 5000;
export const DEFAULT_CUSTOM_BADGE_ICON = 'Star';
export const DEFAULT_CUSTOM_BADGE_COLOR = '#3b82f6';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const USER_ID = /^usr_[0-9a-z-]{1,64}$/i;
const GROUP_ID = /^grp_[0-9a-z-]{1,64}$/i;
const ROLE_ID = /^grol_[0-9a-z-]{1,64}$/i;
const ICON_NAME = /^[A-Z][A-Za-z0-9]{0,63}$/;

// Icons of the built-in badges (fork developer, upstream developer, VRChat
// staff). Custom badges may not use them, so those badges cannot be imitated.
export const RESERVED_BADGE_ICONS: ReadonlySet<string> = new Set([
    'CodeXml',
    'Diamond',
    'ShieldCheck'
]);

export function isReservedBadgeIcon(icon: string): boolean {
    return RESERVED_BADGE_ICONS.has(icon);
}

export type CustomBadgeRule =
    | { kind: 'users'; userIds: string[] }
    | { kind: 'friends' }
    | { kind: 'friendGroup'; groupKey: string }
    | {
          kind: 'vrchatGroup';
          groupId: string;
          groupName: string;
          roleId: string;
          roleName: string;
          memberIds: string[];
          refreshedAt: number;
          truncated: boolean;
      }
    | { kind: 'trust'; trustKey: TrustColorKey }
    | { kind: 'supporter' }
    | { kind: 'memo'; contains: string };

export type CustomBadgeRuleKind = CustomBadgeRule['kind'];

export type CustomBadge = {
    id: string;
    label: string;
    icon: string;
    color: string;
    enabled: boolean;
    rules: CustomBadgeRule[];
};

export type BadgeUserFacts = {
    isFriend: boolean;
    tags: readonly string[];
    hasTrustData: boolean;
    trustKey: TrustColorKey | null;
    memo: string;
};

export type CustomBadgeIndex = {
    byUserId: Map<string, string[]>;
    dynamicBadges: CustomBadge[];
    badgesById: Map<string, CustomBadge>;
    needsFacts: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function text(value: unknown, max = 256): string {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function isTrustKey(value: unknown): value is TrustColorKey {
    return typeof value === 'string' && value in TRUST_COLOR_DEFAULTS;
}

// Same test as the "VRChat Team" trust colour: a developer type other than
// none, or the moderator tag.
export function isVrchatStaff(
    fact: Record<string, unknown> | null | undefined
): boolean {
    if (!fact) {
        return false;
    }
    if (fact.$isModerator === true) {
        return true;
    }
    const developerType =
        typeof fact.developerType === 'string' ? fact.developerType : '';
    if (developerType && developerType !== 'none') {
        return true;
    }
    return Array.isArray(fact.tags) && fact.tags.includes('admin_moderator');
}

export function normalizeBadgeUserIds(value: unknown, limit = 1000): string[] {
    const ids = new Set<string>();
    for (const entry of Array.isArray(value) ? value : []) {
        const id = text(entry, 80);
        if (USER_ID.test(id)) {
            ids.add(id);
        }
        if (ids.size >= limit) {
            break;
        }
    }
    return [...ids];
}

// Accepts ids, profile links or any pasted text and keeps the user ids in it.
export function extractBadgeUserIds(value: string): string[] {
    return normalizeBadgeUserIds(
        value.match(
            /usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
        ) ?? []
    );
}

export function normalizeBadgeIcon(value: unknown): string {
    const icon = text(value, 64);
    return ICON_NAME.test(icon) && !isReservedBadgeIcon(icon)
        ? icon
        : DEFAULT_CUSTOM_BADGE_ICON;
}

export function normalizeBadgeColor(value: unknown): string {
    const color = text(value, 7);
    return HEX_COLOR.test(color)
        ? color.toLowerCase()
        : DEFAULT_CUSTOM_BADGE_COLOR;
}

export function normalizeBadgeRule(value: unknown): CustomBadgeRule | null {
    const source = asRecord(value);
    switch (source.kind) {
        case 'users':
            return {
                kind: 'users',
                userIds: normalizeBadgeUserIds(source.userIds)
            };
        case 'friends':
            return { kind: 'friends' };
        case 'supporter':
            return { kind: 'supporter' };
        case 'friendGroup': {
            const groupKey = text(source.groupKey, 128);
            return groupKey ? { kind: 'friendGroup', groupKey } : null;
        }
        case 'vrchatGroup': {
            const groupId = text(source.groupId, 80);
            if (!GROUP_ID.test(groupId)) {
                return null;
            }
            const roleId = text(source.roleId, 80);
            const refreshedAt = Number(source.refreshedAt);
            return {
                kind: 'vrchatGroup',
                groupId,
                groupName: text(source.groupName, 128),
                roleId: ROLE_ID.test(roleId) ? roleId : '',
                roleName: ROLE_ID.test(roleId)
                    ? text(source.roleName, 128)
                    : '',
                memberIds: normalizeBadgeUserIds(
                    source.memberIds,
                    CUSTOM_BADGE_GROUP_MEMBER_LIMIT
                ),
                refreshedAt:
                    Number.isFinite(refreshedAt) && refreshedAt > 0
                        ? Math.floor(refreshedAt)
                        : 0,
                truncated: source.truncated === true
            };
        }
        case 'trust':
            return isTrustKey(source.trustKey)
                ? { kind: 'trust', trustKey: source.trustKey }
                : null;
        case 'memo': {
            const contains = text(source.contains, CUSTOM_BADGE_MEMO_MAX);
            return contains ? { kind: 'memo', contains } : null;
        }
        default:
            return null;
    }
}

export function normalizeCustomBadge(value: unknown): CustomBadge | null {
    const source = asRecord(value);
    const id = text(source.id, 64);
    const label = text(source.label, CUSTOM_BADGE_LABEL_MAX);
    if (!id || !label) {
        return null;
    }
    const rules = (Array.isArray(source.rules) ? source.rules : [])
        .map(normalizeBadgeRule)
        .filter((rule): rule is CustomBadgeRule => rule !== null);
    return {
        id,
        label,
        icon: normalizeBadgeIcon(source.icon),
        color: normalizeBadgeColor(source.color),
        enabled: source.enabled !== false,
        rules
    };
}

export function normalizeCustomBadges(value: unknown): CustomBadge[] {
    let parsed = value;
    if (typeof value === 'string') {
        try {
            parsed = JSON.parse(value);
        } catch {
            return [];
        }
    }
    const seen = new Set<string>();
    const badges: CustomBadge[] = [];
    for (const entry of Array.isArray(parsed) ? parsed : []) {
        const badge = normalizeCustomBadge(entry);
        if (badge && !seen.has(badge.id)) {
            seen.add(badge.id);
            badges.push(badge);
        }
        if (badges.length >= CUSTOM_BADGE_LIMIT) {
            break;
        }
    }
    return badges;
}

function isDynamicRule(rule: CustomBadgeRule): boolean {
    return (
        rule.kind === 'friends' ||
        rule.kind === 'trust' ||
        rule.kind === 'supporter' ||
        rule.kind === 'memo'
    );
}

export function buildCustomBadgeIndex(
    badges: readonly CustomBadge[],
    remoteFriendIdsByGroupKey: Readonly<Record<string, readonly string[]>>,
    localFriendFavorites: FavoriteGroupMap
): CustomBadgeIndex {
    const byUserId = new Map<string, string[]>();
    const dynamicBadges: CustomBadge[] = [];
    const badgesById = new Map<string, CustomBadge>();
    let needsFacts = false;

    for (const badge of badges) {
        if (!badge.enabled) {
            continue;
        }
        badgesById.set(badge.id, badge);
        const ids = new Set<string>();
        for (const rule of badge.rules) {
            if (rule.kind === 'users' || rule.kind === 'vrchatGroup') {
                const list =
                    rule.kind === 'users' ? rule.userIds : rule.memberIds;
                for (const id of list) {
                    ids.add(id);
                }
            } else if (rule.kind === 'friendGroup') {
                for (const id of collectFavoriteGroupFriendIds(
                    [rule.groupKey],
                    remoteFriendIdsByGroupKey,
                    localFriendFavorites
                )) {
                    ids.add(id);
                }
            }
        }
        for (const id of ids) {
            const list = byUserId.get(id);
            if (list) {
                list.push(badge.id);
            } else {
                byUserId.set(id, [badge.id]);
            }
        }
        if (badge.rules.some(isDynamicRule)) {
            dynamicBadges.push(badge);
            needsFacts = true;
        }
    }

    return { byUserId, dynamicBadges, badgesById, needsFacts };
}

export function badgeUserFactsFrom(
    fact: Record<string, unknown> | null | undefined,
    isFriend: boolean
): BadgeUserFacts {
    const tags = Array.isArray(fact?.tags)
        ? fact.tags.filter((tag): tag is string => typeof tag === 'string')
        : [];
    const hasTrustData = Boolean(
        fact &&
        (tags.length ||
            fact.$trustClass ||
            fact.$isModerator ||
            fact.$isTroll ||
            fact.$isProbableTroll)
    );
    return {
        isFriend,
        tags,
        hasTrustData,
        trustKey: hasTrustData ? resolveTrustColorKey(fact) : null,
        memo: [fact?.memo, fact?.note]
            .filter((value): value is string => typeof value === 'string')
            .join('\n')
    };
}

function dynamicRuleMatches(
    rule: CustomBadgeRule,
    facts: BadgeUserFacts
): boolean {
    switch (rule.kind) {
        case 'friends':
            return facts.isFriend;
        case 'supporter':
            return facts.tags.includes('system_supporter');
        case 'trust':
            return facts.hasTrustData && facts.trustKey === rule.trustKey;
        case 'memo':
            return (
                facts.memo.length > 0 &&
                facts.memo.toLowerCase().includes(rule.contains.toLowerCase())
            );
        default:
            return false;
    }
}

export function resolveUserCustomBadges(
    index: CustomBadgeIndex,
    userId: string,
    facts: BadgeUserFacts | null
): CustomBadge[] {
    if (!userId) {
        return [];
    }
    const matched = new Set(index.byUserId.get(userId) ?? []);
    if (facts) {
        for (const badge of index.dynamicBadges) {
            if (
                !matched.has(badge.id) &&
                badge.rules.some((rule) => dynamicRuleMatches(rule, facts))
            ) {
                matched.add(badge.id);
            }
        }
    }
    const result: CustomBadge[] = [];
    for (const badge of index.badgesById.values()) {
        if (matched.has(badge.id)) {
            result.push(badge);
        }
    }
    return result;
}

export function readableTextColor(hex: string): string {
    const value = Number.parseInt(hex.slice(1), 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111111' : '#ffffff';
}

export function createCustomBadgeId(): string {
    return `badge_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;
}

export function isUserListedOnBadge(
    badge: CustomBadge,
    userId: string
): boolean {
    return badge.rules.some(
        (rule) => rule.kind === 'users' && rule.userIds.includes(userId)
    );
}

// Adds or removes a user from a badge's explicit user list. Other rules are
// left alone, so a user can still match the badge through them.
export function setUserListedOnBadge(
    badge: CustomBadge,
    userId: string,
    listed: boolean
): CustomBadge {
    if (listed) {
        if (isUserListedOnBadge(badge, userId)) {
            return badge;
        }
        const index = badge.rules.findIndex((rule) => rule.kind === 'users');
        if (index < 0) {
            return {
                ...badge,
                rules: [...badge.rules, { kind: 'users', userIds: [userId] }]
            };
        }
        return {
            ...badge,
            rules: badge.rules.map((rule, i) =>
                i === index && rule.kind === 'users'
                    ? { ...rule, userIds: [...rule.userIds, userId] }
                    : rule
            )
        };
    }
    return {
        ...badge,
        rules: badge.rules
            .map((rule) =>
                rule.kind === 'users'
                    ? {
                          ...rule,
                          userIds: rule.userIds.filter((id) => id !== userId)
                      }
                    : rule
            )
            .filter((rule) => rule.kind !== 'users' || rule.userIds.length > 0)
    };
}

// The member list fetch stops at the limit, so reaching it means the group may
// be bigger. A total over the limit (only known for the whole group, not for a
// single role) confirms it.
export function isGroupMemberListTruncated(
    fetched: number,
    groupMemberCount: number,
    roleFiltered: boolean
): boolean {
    return (
        fetched >= CUSTOM_BADGE_GROUP_MEMBER_LIMIT ||
        (!roleFiltered && groupMemberCount > CUSTOM_BADGE_GROUP_MEMBER_LIMIT)
    );
}
