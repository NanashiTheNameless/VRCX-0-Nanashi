import { AWARD_ICONS } from '@/domain/badges/globalBadges';
import { collectFavoriteGroupFriendIds } from '@/domain/favorites/favoriteGroupSelection';
import type { FavoriteGroupMap } from '@/domain/favorites/types';
import { TRUST_COLOR_DEFAULTS } from '@/shared/constants/trustColors';
import { resolveTrustColorKey } from '@/shared/utils/trustColors';

type TrustColorKey = keyof typeof TRUST_COLOR_DEFAULTS;

export const CUSTOM_BADGES_CONFIG_KEY = 'customUserBadges';
// Not a limit: Settings shows a warning above this many badges, since every
// name on screen checks them and they all sync as one value.
export const CUSTOM_BADGE_WARN_COUNT = 50;
export const CUSTOM_BADGE_LABEL_MAX = 32;
export const CUSTOM_BADGE_MEMO_MAX = 64;
export const CUSTOM_BADGE_FRIEND_NUMBER_MAX = 1_000_000;
export const CUSTOM_BADGE_GROUP_MEMBER_LIMIT = 5000;
export const DEFAULT_CUSTOM_BADGE_ICON = 'Star';
export const DEFAULT_CUSTOM_BADGE_COLOR = '#3b82f6';
export const CUSTOM_BADGE_GROUP_DEPTH_LIMIT = 8;
export const BADGE_RULE_OPERATORS = [
    'or',
    'and',
    'xor',
    'nand',
    'nor',
    'xnor',
    'xand'
] as const;
export type BadgeRuleOperator = (typeof BADGE_RULE_OPERATORS)[number];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const USER_ID = /^usr_[0-9a-z-]{1,64}$/i;
const GROUP_ID = /^grp_[0-9a-z-]{1,64}$/i;
const ROLE_ID = /^grol_[0-9a-z-]{1,64}$/i;
const ICON_NAME = /^[A-Z][A-Za-z0-9]{0,63}$/;
const LANGUAGE_KEY = /^[a-z]{2,8}$/;

export const BADGE_AGE_LEVELS = ['any', 'adult', 'hidden'] as const;
export type BadgeAgeLevel = (typeof BADGE_AGE_LEVELS)[number];
// VRChat's last_platform values.
export const BADGE_PLATFORMS = ['standalonewindows', 'android', 'ios'] as const;
export type BadgePlatform = (typeof BADGE_PLATFORMS)[number];
// VRChat's own status values, plus "offline". Offline users report
// "offline", so the others only match while a user is online.
export const BADGE_STATUSES = [
    'join me',
    'active',
    'ask me',
    'busy',
    'offline'
] as const;
export type BadgeStatus = (typeof BADGE_STATUSES)[number];
// Conditions that look at a piece of profile text.
export const BADGE_TEXT_RULE_KINDS = [
    'displayName',
    'statusText',
    'memo',
    'bio',
    'pronouns'
] as const;
export type BadgeTextRuleKind = (typeof BADGE_TEXT_RULE_KINDS)[number];
// How a text condition compares. "any" matches any non-empty text and needs
// no value; regular expressions ignore case like the others.
export const BADGE_TEXT_MATCHES = [
    'contains',
    'startsWith',
    'exact',
    'regex',
    'any'
] as const;
export type BadgeTextMatch = (typeof BADGE_TEXT_MATCHES)[number];
export const BADGE_MODERATIONS = ['block', 'mute'] as const;
export type BadgeModeration = (typeof BADGE_MODERATIONS)[number];

// Icons of the built-in badges (fork developer, upstream developer, VRChat
// staff) and of global badges. Custom badges may not use them, so those
// badges cannot be imitated.
export const RESERVED_BADGE_ICONS: ReadonlySet<string> = new Set([
    'CodeXml',
    'Diamond',
    'ShieldCheck',
    ...AWARD_ICONS
]);

// Icon names are made of capitalised words (FileCode, ShieldUser, BugOff).
// A family matches a whole word, so "Code" catches FileCode but not a name
// that merely starts with those letters.
const wordPattern = (words: readonly string[], anchored: boolean) =>
    new RegExp(
        `${anchored ? '^(?:Lab)?' : ''}(?:${[...words]
            .sort((a, b) => b.length - a.length)
            .join('|')})(?![a-z])`
    );

// Code and shield icons are kept wherever the word appears (FileCode,
// SquareCode, UserShield): at list size they all read as the developer or
// VRChat Staff badge. QR codes are a different symbol.
const ANYWHERE_FAMILIES = wordPattern(
    ['Code', 'Braces', 'Brackets', 'Shield'],
    false
);
// Every other built-in and award icon is kept with its variants, which
// start with its name (BugOff, DiamondPlus, ZapOff, Lucide Lab's GemRing).
const LEADING_FAMILIES = wordPattern(
    [...AWARD_ICONS, 'Diamond', 'Flask', 'TestTube', 'Sparkle'],
    true
);

export function isReservedBadgeIcon(icon: string): boolean {
    return (
        RESERVED_BADGE_ICONS.has(icon) ||
        (ANYWHERE_FAMILIES.test(icon) && !icon.includes('QrCode')) ||
        LEADING_FAMILIES.test(icon)
    );
}

export type CustomBadgeRule = (
    | { kind: 'users'; userIds: string[] }
    | { kind: 'self' }
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
    | { kind: 'ageVerified'; level: BadgeAgeLevel }
    | { kind: 'platform'; platform: BadgePlatform }
    | { kind: 'status'; status: BadgeStatus }
    | { kind: BadgeTextRuleKind; contains: string; match?: BadgeTextMatch }
    | { kind: 'language'; language: string }
    // Inclusive range; a max of 0 means no upper limit.
    | { kind: 'friendNumber'; min: number; max: number }
    | { kind: 'moderation'; moderation: BadgeModeration }
    | { kind: 'group'; operator: BadgeRuleOperator; rules: CustomBadgeRule[] }
) & { negated?: boolean; enabled?: boolean };

export type CustomBadgeRuleKind = CustomBadgeRule['kind'];

export type CustomBadge = {
    id: string;
    label: string;
    icon: string;
    color: string;
    enabled: boolean;
    operator?: BadgeRuleOperator;
    assignedUserIds?: string[];
    rules: CustomBadgeRule[];
};

export type BadgeUserFacts = {
    isSelf: boolean;
    isFriend: boolean;
    tags: readonly string[];
    hasTrustData: boolean;
    trustKey: TrustColorKey | null;
    displayName: string;
    statusText: string;
    // The local memo and the VRChat note, each matched on its own.
    memos: readonly string[];
    bio: string;
    pronouns: string;
    languages: readonly string[];
    // 0 when unknown.
    friendNumber: number;
    // From the friend list; null for users who are not friends.
    presence: 'online' | 'active' | 'offline' | null;
    // From the local moderation list; null when it has not been read.
    moderation: { block: boolean; mute: boolean } | null;
    // null when the profile data does not say (friend list data only has the
    // status).
    ageVerified: boolean | null;
    ageVerificationStatus: string;
    platform: string;
    status: string;
    userId: string;
    // From the user's own group list: true, false, or null when not known.
    groupMembership: (groupId: string) => boolean | null;
};

export type CustomBadgeIndex = {
    byUserId: Map<string, string[]>;
    dynamicBadges: CustomBadge[];
    badgesById: Map<string, CustomBadge>;
    needsFacts: boolean;
    needsModeration: boolean;
    staticRuleUserIds: Map<CustomBadgeRule, ReadonlySet<string>>;
};

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function text(value: unknown, max = 256): string {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function oneOf<T extends string>(
    values: readonly T[],
    value: unknown
): value is T {
    return (
        typeof value === 'string' &&
        (values as readonly string[]).includes(value)
    );
}

function isTrustKey(value: unknown): value is TrustColorKey {
    return typeof value === 'string' && value in TRUST_COLOR_DEFAULTS;
}

// Same test as the "VRChat Team" trust color: a developer type other than
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

// Keeps a reserved name instead of replacing it: the badge still draws the
// default icon (BadgeIcon refuses reserved ones), and Settings can tell the
// user why and ask them to pick another.
export function normalizeBadgeIcon(value: unknown): string {
    const icon = text(value, 64);
    return ICON_NAME.test(icon) ? icon : DEFAULT_CUSTOM_BADGE_ICON;
}

export function normalizeBadgeColor(value: unknown): string {
    const color = text(value, 7);
    return HEX_COLOR.test(color)
        ? color.toLowerCase()
        : DEFAULT_CUSTOM_BADGE_COLOR;
}

export function normalizeBadgeRule(
    value: unknown,
    depth = 0
): CustomBadgeRule | null {
    const rule = normalizeBadgeRuleValue(value, depth);
    if (!rule) {
        return null;
    }
    const source = asRecord(value);
    return {
        ...rule,
        ...(source.negated === true ? { negated: true } : {}),
        ...(source.enabled === false ? { enabled: false } : {})
    };
}

// A disabled condition left incomplete is dropped on its own. Any other
// invalid condition makes the whole list invalid, since leaving it out would
// change what the expression means.
function normalizeBadgeRuleList(
    values: readonly unknown[],
    depth: number
): CustomBadgeRule[] | null {
    const rules: CustomBadgeRule[] = [];
    for (const value of values) {
        const rule = normalizeBadgeRule(value, depth);
        if (rule) {
            rules.push(rule);
        } else if (asRecord(value).enabled !== false) {
            return null;
        }
    }
    return rules;
}

function normalizeBadgeRuleValue(
    value: unknown,
    depth: number
): CustomBadgeRule | null {
    const source = asRecord(value);
    switch (source.kind) {
        case 'group': {
            if (
                depth >= CUSTOM_BADGE_GROUP_DEPTH_LIMIT ||
                !oneOf(BADGE_RULE_OPERATORS, source.operator) ||
                !Array.isArray(source.rules)
            ) {
                return null;
            }
            const rules = normalizeBadgeRuleList(source.rules, depth + 1);
            return rules
                ? { kind: 'group', operator: source.operator, rules }
                : null;
        }
        case 'users':
            return {
                kind: 'users',
                userIds: normalizeBadgeUserIds(source.userIds)
            };
        case 'self':
            return { kind: 'self' };
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
        case 'ageVerified':
            return {
                kind: 'ageVerified',
                level: oneOf(BADGE_AGE_LEVELS, source.level)
                    ? source.level
                    : 'any'
            };
        case 'platform':
            return oneOf(BADGE_PLATFORMS, source.platform)
                ? { kind: 'platform', platform: source.platform }
                : null;
        case 'status':
            return oneOf(BADGE_STATUSES, source.status)
                ? { kind: 'status', status: source.status }
                : null;
        case 'displayName':
        case 'statusText':
        case 'memo':
        case 'bio':
        case 'pronouns': {
            const match = oneOf(BADGE_TEXT_MATCHES, source.match)
                ? source.match
                : 'contains';
            const contains =
                match === 'any'
                    ? ''
                    : text(source.contains, CUSTOM_BADGE_MEMO_MAX);
            if (match !== 'any' && !contains) {
                return null;
            }
            return match === 'contains'
                ? { kind: source.kind, contains }
                : { kind: source.kind, contains, match };
        }
        case 'language': {
            const language = text(source.language, 16).toLowerCase();
            return LANGUAGE_KEY.test(language)
                ? { kind: 'language', language }
                : null;
        }
        case 'friendNumber': {
            const min = friendNumberBound(source.min);
            const max = friendNumberBound(source.max);
            if (min === null || max === null || (max > 0 && max < min)) {
                return null;
            }
            return { kind: 'friendNumber', min, max };
        }
        case 'moderation':
            return oneOf(BADGE_MODERATIONS, source.moderation)
                ? { kind: 'moderation', moderation: source.moderation }
                : null;
        default:
            return null;
    }
}

function friendNumberBound(value: unknown): number | null {
    const number = Number(value ?? 0);
    return Number.isInteger(number) &&
        number >= 0 &&
        number <= CUSTOM_BADGE_FRIEND_NUMBER_MAX
        ? number
        : null;
}

export function normalizeCustomBadge(value: unknown): CustomBadge | null {
    const source = asRecord(value);
    const id = text(source.id, 64);
    const label = text(source.label, CUSTOM_BADGE_LABEL_MAX);
    if (!id || !label) {
        return null;
    }
    if (
        source.operator !== undefined &&
        !oneOf(BADGE_RULE_OPERATORS, source.operator)
    ) {
        return null;
    }
    const sourceRules = Array.isArray(source.rules) ? source.rules : [];
    const rules =
        source.operator === undefined
            ? sourceRules
                  .map((rule) => normalizeBadgeRule(rule))
                  .filter((rule): rule is CustomBadgeRule => rule !== null)
            : (normalizeBadgeRuleList(sourceRules, 0) ?? []);
    return {
        id,
        label,
        icon: normalizeBadgeIcon(source.icon),
        color: normalizeBadgeColor(source.color),
        enabled: source.enabled !== false,
        ...(source.operator !== undefined
            ? { operator: source.operator as BadgeRuleOperator }
            : {}),
        ...(Array.isArray(source.assignedUserIds)
            ? { assignedUserIds: normalizeBadgeUserIds(source.assignedUserIds) }
            : {}),
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
    }
    return badges;
}

export function isBadgeRuleEnabled(rule: CustomBadgeRule): boolean {
    return (
        rule.enabled !== false &&
        (rule.kind !== 'group' || rule.rules.some(isBadgeRuleEnabled))
    );
}

export function enabledBadgeRules(
    rules: readonly CustomBadgeRule[]
): CustomBadgeRule[] {
    return rules.filter(isBadgeRuleEnabled);
}

function isDynamicRule(rule: CustomBadgeRule): boolean {
    if (!isBadgeRuleEnabled(rule)) {
        return false;
    }
    return (
        (rule.kind === 'group' && rule.rules.some(isDynamicRule)) ||
        rule.kind === 'self' ||
        rule.kind === 'friends' ||
        rule.kind === 'trust' ||
        rule.kind === 'supporter' ||
        isBadgeTextRule(rule) ||
        rule.kind === 'language' ||
        rule.kind === 'friendNumber' ||
        rule.kind === 'moderation' ||
        rule.kind === 'ageVerified' ||
        rule.kind === 'platform' ||
        rule.kind === 'status' ||
        rule.kind === 'vrchatGroup'
    );
}

export function isBadgeTextRule(
    rule: CustomBadgeRule
): rule is Extract<CustomBadgeRule, { kind: BadgeTextRuleKind }> {
    return (BADGE_TEXT_RULE_KINDS as readonly string[]).includes(rule.kind);
}

function usesModeration(rule: CustomBadgeRule): boolean {
    return (
        isBadgeRuleEnabled(rule) &&
        (rule.kind === 'moderation' ||
            (rule.kind === 'group' && rule.rules.some(usesModeration)))
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
    let needsModeration = false;
    const staticRuleUserIds = new Map<CustomBadgeRule, ReadonlySet<string>>();

    function indexRule(rule: CustomBadgeRule) {
        if (!isBadgeRuleEnabled(rule)) {
            return;
        }
        if (rule.kind === 'group') {
            rule.rules.forEach(indexRule);
        } else if (rule.kind === 'users') {
            staticRuleUserIds.set(rule, new Set(rule.userIds));
        } else if (rule.kind === 'friendGroup') {
            staticRuleUserIds.set(
                rule,
                new Set(
                    collectFavoriteGroupFriendIds(
                        [rule.groupKey],
                        remoteFriendIdsByGroupKey,
                        localFriendFavorites
                    )
                )
            );
        }
    }

    for (const badge of badges) {
        if (!badge.enabled) {
            continue;
        }
        badgesById.set(badge.id, badge);
        const rules = enabledBadgeRules(badge.rules);
        rules.forEach(indexRule);
        const ids = new Set(badge.assignedUserIds ?? []);
        const operator = rules.length < 2 ? 'or' : (badge.operator ?? 'or');
        if (operator === 'or') {
            for (const rule of rules) {
                if (rule.negated) {
                    continue;
                }
                for (const id of staticRuleUserIds.get(rule) ?? []) {
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
        if (
            operator !== 'or' ||
            rules.some(
                (rule) =>
                    rule.negated || rule.kind === 'group' || isDynamicRule(rule)
            )
        ) {
            dynamicBadges.push(badge);
        }
        needsFacts ||= rules.some(isDynamicRule);
        needsModeration ||= rules.some(usesModeration);
    }

    return {
        byUserId,
        dynamicBadges,
        badgesById,
        needsFacts,
        needsModeration,
        staticRuleUserIds
    };
}

const NO_GROUP_KNOWLEDGE = () => null;

function stringField(
    fact: Record<string, unknown> | null | undefined,
    key: string
): string {
    const value = fact?.[key];
    return typeof value === 'string' ? value : '';
}

export type BadgeUserContext = {
    friendNumber?: number;
    presence?: BadgeUserFacts['presence'];
    moderation?: BadgeUserFacts['moderation'];
};

export function badgeUserFactsFrom(
    fact: Record<string, unknown> | null | undefined,
    isFriend: boolean,
    userId = '',
    groupMembership: (groupId: string) => boolean | null = NO_GROUP_KNOWLEDGE,
    currentUserId: string | null = null,
    context: BadgeUserContext = {}
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
        isSelf: Boolean(userId) && userId === currentUserId,
        isFriend,
        tags,
        hasTrustData,
        trustKey: hasTrustData ? resolveTrustColorKey(fact) : null,
        displayName: stringField(fact, 'displayName'),
        statusText: stringField(fact, 'statusDescription'),
        memos: [fact?.memo, fact?.note].filter(
            (value): value is string => typeof value === 'string'
        ),
        bio: stringField(fact, 'bio'),
        pronouns: stringField(fact, 'pronouns'),
        languages: tags
            .filter((tag) => tag.startsWith('language_'))
            .map((tag) => tag.slice('language_'.length).toLowerCase()),
        friendNumber: positiveInteger(
            context.friendNumber ?? fact?.$friendNumber ?? fact?.friendNumber
        ),
        presence: context.presence ?? null,
        moderation: context.moderation ?? null,
        ageVerified:
            typeof fact?.ageVerified === 'boolean' ? fact.ageVerified : null,
        ageVerificationStatus: stringField(fact, 'ageVerificationStatus'),
        platform:
            stringField(fact, 'last_platform') || stringField(fact, 'platform'),
        status: stringField(fact, 'status'),
        userId,
        groupMembership
    };
}

function positiveInteger(value: unknown): number {
    const number = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(number) && number > 0 ? number : 0;
}

const regexCache = new Map<string, RegExp | null>();

/** The pattern as a case-insensitive expression, or null when invalid. */
export function compileBadgeRegex(pattern: string): RegExp | null {
    let compiled = regexCache.get(pattern);
    if (compiled === undefined) {
        try {
            compiled = new RegExp(pattern, 'i');
        } catch {
            compiled = null;
        }
        if (regexCache.size >= 256) {
            regexCache.clear();
        }
        regexCache.set(pattern, compiled);
    }
    return compiled;
}

function textMatches(
    value: string,
    rule: Extract<CustomBadgeRule, { kind: BadgeTextRuleKind }>
): boolean {
    const match = rule.match ?? 'contains';
    if (match === 'any') {
        return value.trim().length > 0;
    }
    if (!value) {
        return false;
    }
    if (match === 'regex') {
        return compileBadgeRegex(rule.contains)?.test(value) === true;
    }
    const haystack = value.toLowerCase();
    const needle = rule.contains.toLowerCase();
    switch (match) {
        case 'startsWith':
            return haystack.trimStart().startsWith(needle);
        case 'exact':
            return haystack.trim() === needle;
        default:
            return haystack.includes(needle);
    }
}

function textValues(kind: BadgeTextRuleKind, facts: BadgeUserFacts) {
    switch (kind) {
        case 'memo':
            return facts.memos;
        case 'displayName':
            return [facts.displayName];
        case 'statusText':
            return [facts.statusText];
        case 'bio':
            return [facts.bio];
        case 'pronouns':
            return [facts.pronouns];
    }
}

function friendNumberMatches(
    rule: Extract<CustomBadgeRule, { kind: 'friendNumber' }>,
    number: number
): boolean {
    return (
        number > 0 &&
        number >= rule.min &&
        (rule.max === 0 || number <= rule.max)
    );
}

const memberSets = new WeakMap<object, ReadonlySet<string>>();

function memberSetOf(
    rule: Extract<CustomBadgeRule, { kind: 'vrchatGroup' }>
): ReadonlySet<string> {
    let set = memberSets.get(rule);
    if (!set) {
        set = new Set(rule.memberIds);
        memberSets.set(rule, set);
    }
    return set;
}

// The user's own group list is trusted over the stored member list, which is
// often private, partial or out of date. A role can only be checked against
// the member list, since group lists do not say which roles a user has.
function vrchatGroupRuleMatches(
    rule: Extract<CustomBadgeRule, { kind: 'vrchatGroup' }>,
    facts: BadgeUserFacts
): boolean {
    const inStoredList = memberSetOf(rule).has(facts.userId);
    const fromOwnList = facts.groupMembership(rule.groupId);
    if (fromOwnList === false) {
        return false;
    }
    if (rule.roleId) {
        return inStoredList;
    }
    return fromOwnList === true || inStoredList;
}

// VRChat shows age verification as a status: "18+" or "verified" when shown,
// "hidden" when the user hides it. Friend list data carries only the status,
// so visible statuses decide on their own. Hidden verification also requires
// ageVerified to be true; a profile that says it is false never matches.
function ageRuleMatches(level: BadgeAgeLevel, facts: BadgeUserFacts): boolean {
    const status = facts.ageVerificationStatus;
    if (level === 'hidden') {
        return status === 'hidden' && facts.ageVerified === true;
    }
    if (
        facts.ageVerified === false ||
        (status !== '18+' && status !== 'verified')
    ) {
        return false;
    }
    return level === 'any' || status === '18+';
}

/** Groups referenced by the badges' group rules. */
export function badgeRuleGroupIds(badges: readonly CustomBadge[]): string[] {
    const ids = new Set<string>();
    function visit(rule: CustomBadgeRule) {
        if (!isBadgeRuleEnabled(rule)) {
            return;
        }
        if (rule.kind === 'group') {
            rule.rules.forEach(visit);
        } else if (rule.kind === 'vrchatGroup') {
            ids.add(rule.groupId);
        }
    }
    for (const badge of badges) {
        badge.rules.forEach(visit);
    }
    return [...ids];
}

function dynamicRuleMatches(
    rule: CustomBadgeRule,
    facts: BadgeUserFacts
): boolean {
    switch (rule.kind) {
        case 'self':
            return facts.isSelf;
        case 'friends':
            return facts.isFriend;
        case 'supporter':
            return facts.tags.includes('system_supporter');
        case 'trust':
            return facts.hasTrustData && facts.trustKey === rule.trustKey;
        case 'displayName':
        case 'statusText':
        case 'memo':
        case 'bio':
        case 'pronouns':
            return textValues(rule.kind, facts).some((value) =>
                textMatches(value, rule)
            );
        case 'language':
            return facts.languages.includes(rule.language);
        case 'friendNumber':
            return friendNumberMatches(rule, facts.friendNumber);
        case 'moderation':
            return facts.moderation?.[rule.moderation] === true;
        case 'ageVerified':
            return ageRuleMatches(rule.level, facts);
        case 'platform':
            return facts.platform === rule.platform;
        case 'status':
            return rule.status === 'offline'
                ? facts.presence === 'offline' || facts.status === 'offline'
                : facts.presence !== 'offline' && facts.status === rule.status;
        case 'vrchatGroup':
            return vrchatGroupRuleMatches(rule, facts);
        default:
            return false;
    }
}

export function combineBadgeRules(
    operator: BadgeRuleOperator,
    matches: readonly boolean[]
): boolean {
    if (!matches.length) {
        return false;
    }
    if (matches.length === 1) {
        return matches[0];
    }
    const count = matches.filter(Boolean).length;
    switch (operator) {
        case 'or':
            return count > 0;
        case 'and':
            return count === matches.length;
        case 'xor':
            return count % 2 === 1;
        case 'nand':
            return count !== matches.length;
        case 'nor':
            return count === 0;
        case 'xnor':
        case 'xand':
            return count % 2 === 0;
    }
}

function ruleMatches(
    rule: CustomBadgeRule,
    index: CustomBadgeIndex,
    userId: string,
    facts: BadgeUserFacts | null
): boolean {
    if (!isBadgeRuleEnabled(rule)) {
        return false;
    }
    const matched =
        rule.kind === 'group'
            ? combineBadgeRules(
                  rule.operator,
                  enabledBadgeRules(rule.rules).map((child) =>
                      ruleMatches(child, index, userId, facts)
                  )
              )
            : rule.kind === 'users' || rule.kind === 'friendGroup'
              ? index.staticRuleUserIds.get(rule)?.has(userId) === true
              : facts !== null && dynamicRuleMatches(rule, facts);
    return rule.negated ? !matched : matched;
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
    for (const badge of index.dynamicBadges) {
        if (
            !matched.has(badge.id) &&
            combineBadgeRules(
                badge.operator ?? 'or',
                enabledBadgeRules(badge.rules).map((rule) =>
                    ruleMatches(rule, index, userId, facts)
                )
            )
        ) {
            matched.add(badge.id);
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
    return (
        badge.assignedUserIds?.includes(userId) === true ||
        ((badge.operator ?? 'or') === 'or' &&
            badge.rules.some(
                (rule) =>
                    rule.kind === 'users' &&
                    isBadgeRuleEnabled(rule) &&
                    !rule.negated &&
                    rule.userIds.includes(userId)
            ))
    );
}

// Adds or removes a user from a badge's explicit user list. Other rules are
// left alone, so a user can still match the badge through them.
export function setUserListedOnBadge(
    badge: CustomBadge,
    userId: string,
    listed: boolean
): CustomBadge {
    if (badge.assignedUserIds || (badge.operator ?? 'or') !== 'or') {
        if (!listed) {
            const next = {
                ...badge,
                assignedUserIds: badge.assignedUserIds?.filter(
                    (id) => id !== userId
                )
            };
            if ((badge.operator ?? 'or') !== 'or') {
                return next;
            }
            badge = next;
        } else {
            return isUserListedOnBadge(badge, userId)
                ? badge
                : {
                      ...badge,
                      assignedUserIds: [
                          ...(badge.assignedUserIds ?? []),
                          userId
                      ]
                  };
        }
    }
    if (listed) {
        if (isUserListedOnBadge(badge, userId)) {
            return badge;
        }
        const index = badge.rules.findIndex(
            (rule) =>
                rule.kind === 'users' &&
                isBadgeRuleEnabled(rule) &&
                !rule.negated
        );
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
                rule.kind === 'users' &&
                isBadgeRuleEnabled(rule) &&
                !rule.negated
                    ? {
                          ...rule,
                          userIds: rule.userIds.filter((id) => id !== userId)
                      }
                    : rule
            )
            .filter(
                (rule) =>
                    rule.kind !== 'users' ||
                    rule.negated ||
                    rule.userIds.length > 0
            )
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
