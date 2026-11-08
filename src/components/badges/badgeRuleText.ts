import type { TFunction } from 'i18next';

import {
    enabledBadgeRules,
    type BadgeRuleOperator,
    type CustomBadge,
    type CustomBadgeRule
} from '@/domain/badges/customBadges';
import { TRUST_COLOR_ENTRIES } from '@/shared/constants/trustColors';

const T = 'view.settings.appearance.user_badges';

export const SIMPLE_BADGE_OPERATORS = ['and', 'or', 'nor'] as const;

export function isSimpleBadgeOperator(operator: BadgeRuleOperator): boolean {
    return (SIMPLE_BADGE_OPERATORS as readonly string[]).includes(operator);
}

export function usesAdvancedBadgeLogic(
    operator: BadgeRuleOperator,
    rules: readonly CustomBadgeRule[]
): boolean {
    return (
        !isSimpleBadgeOperator(operator) ||
        rules.some(
            (rule) =>
                rule.kind === 'group' &&
                usesAdvancedBadgeLogic(rule.operator, rule.rules)
        )
    );
}

export type BadgeRuleTextOptions = {
    friendGroupLabel?: (groupKey: string) => string;
};

const optionKey = (value: string) => value.replace(/\W+/g, '_');

/** The value part of a condition, such as "PC" or "Join Me". */
export function badgeRuleValueText(
    rule: CustomBadgeRule,
    t: TFunction,
    options: BadgeRuleTextOptions = {}
): string {
    const unset = t(`${T}.summary.unset`);
    switch (rule.kind) {
        case 'friendGroup':
            return rule.groupKey
                ? `"${options.friendGroupLabel?.(rule.groupKey) || rule.groupKey}"`
                : unset;
        case 'vrchatGroup': {
            if (!rule.groupId) {
                return unset;
            }
            const name = `"${rule.groupName || rule.groupId}"`;
            return rule.roleName ? `${name} (${rule.roleName})` : name;
        }
        case 'trust': {
            const entry = TRUST_COLOR_ENTRIES.find(
                (item) => item.key === rule.trustKey
            );
            return entry ? t(entry.labelKey) : rule.trustKey;
        }
        case 'ageVerified':
            return `(${t(`${T}.age_level.${rule.level}`)})`;
        case 'platform':
            return t(`${T}.platform_option.${optionKey(rule.platform)}`);
        case 'status':
            return t(`${T}.status_option.${optionKey(rule.status)}`);
        case 'memo':
        case 'bio':
        case 'pronouns':
            return rule.contains ? `"${rule.contains}"` : unset;
        default:
            return '';
    }
}

/** One condition as it follows "users who". */
export function badgeRulePhrase(
    rule: CustomBadgeRule,
    t: TFunction,
    options: BadgeRuleTextOptions = {}
): string {
    const negated = rule.negated === true;
    if (rule.kind === 'users') {
        return t(`${T}.summary.${negated ? 'users_not' : 'users'}`, {
            count: rule.userIds.length
        });
    }
    if (rule.kind === 'group') {
        const text = describeBadgeRuleList(
            rule.rules,
            rule.operator,
            t,
            options
        );
        return negated ? t(`${T}.summary.not_group`, { item: text }) : text;
    }
    const value = badgeRuleValueText(rule, t, options);
    const phrase = t(`${T}.${negated ? 'phrase_not' : 'phrase'}.${rule.kind}`);
    return value ? `${phrase} ${value}` : phrase;
}

function describeRule(
    rule: CustomBadgeRule,
    t: TFunction,
    options: BadgeRuleTextOptions,
    nested: boolean
): string {
    const text = badgeRulePhrase(rule, t, options);
    return rule.kind === 'group' &&
        nested &&
        !rule.negated &&
        enabledBadgeRules(rule.rules).length > 1
        ? `(${text})`
        : text;
}

/**
 * The enabled conditions of a list, joined the way the badge evaluates them.
 * A gate only applies with two or more enabled conditions. Empty when none
 * are enabled.
 */
export function describeBadgeRuleList(
    rules: readonly CustomBadgeRule[],
    operator: BadgeRuleOperator,
    t: TFunction,
    options: BadgeRuleTextOptions = {}
): string {
    const enabled = enabledBadgeRules(rules);
    if (enabled.length === 1) {
        return describeRule(enabled[0], t, options, false);
    }
    const items = enabled.map((rule) => describeRule(rule, t, options, true));
    if (!items.length) {
        return '';
    }
    if (operator === 'and' || operator === 'or') {
        return items.join(t(`${T}.summary.${operator}`));
    }
    return t(`${T}.summary.wrap.${operator}`, { items: items.join(', ') });
}

export function describeCustomBadge(
    badge: Pick<CustomBadge, 'rules' | 'operator' | 'assignedUserIds'>,
    t: TFunction,
    options: BadgeRuleTextOptions = {}
): string {
    const expression = describeBadgeRuleList(
        badge.rules,
        badge.operator ?? 'or',
        t,
        options
    );
    const assigned = badge.assignedUserIds?.length ?? 0;
    if (assigned) {
        return expression
            ? t(`${T}.summary.assigned`, { count: assigned, expression })
            : t(`${T}.summary.users`, { count: assigned });
    }
    return expression
        ? t(`${T}.summary.lead`, { expression })
        : t(`${T}.summary.nobody`);
}
