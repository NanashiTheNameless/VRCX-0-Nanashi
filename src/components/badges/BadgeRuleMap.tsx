import { ArrowRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
    enabledBadgeRules,
    isBadgeRuleEnabled,
    type BadgeRuleOperator,
    type CustomBadgeRule
} from '@/domain/badges/customBadges';

import { badgeRuleValueText, type BadgeRuleTextOptions } from './badgeRuleText';

const T = 'view.settings.appearance.user_badges';

function Pill({
    children,
    tone
}: {
    children: ReactNode;
    tone: 'gate' | 'not' | 'off';
}) {
    const toneClass =
        tone === 'gate'
            ? 'bg-primary text-primary-foreground'
            : tone === 'not'
              ? 'bg-destructive text-white'
              : 'bg-muted text-muted-foreground';
    return (
        <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${toneClass}`}
        >
            {children}
        </span>
    );
}

function MapNode({
    rule,
    options,
    active
}: {
    rule: CustomBadgeRule;
    options: BadgeRuleTextOptions;
    active: boolean;
}) {
    const { t } = useTranslation();
    const on = active && isBadgeRuleEnabled(rule);
    return (
        <div
            className={`flex min-w-0 items-center gap-1.5 ${on ? '' : 'opacity-50'}`}
            data-rule-off={on ? undefined : 'true'}
        >
            {on ? null : <Pill tone="off">{t(`${T}.map.off`)}</Pill>}
            {rule.negated ? <Pill tone="not">{t(`${T}.map.not`)}</Pill> : null}
            {rule.kind === 'group' ? (
                <MapList
                    rules={rule.rules}
                    operator={rule.operator}
                    options={options}
                    active={on}
                />
            ) : (
                <span className="bg-background min-w-0 truncate rounded border px-2 py-0.5 text-xs">
                    {t(`${T}.rule.${rule.kind}`)}
                    {rule.kind === 'users'
                        ? ` (${rule.userIds.length})`
                        : badgeRuleValueText(rule, t, options)
                          ? `: ${badgeRuleValueText(rule, t, options)}`
                          : ''}
                </span>
            )}
        </div>
    );
}

function MapList({
    rules,
    operator,
    options,
    active
}: {
    rules: readonly CustomBadgeRule[];
    operator: BadgeRuleOperator;
    options: BadgeRuleTextOptions;
    active: boolean;
}) {
    const { t } = useTranslation();
    const showGate = active && enabledBadgeRules(rules).length >= 2;
    if (!rules.length) {
        return <Pill tone="off">{t(`${T}.no_rules`)}</Pill>;
    }
    return (
        <div className="flex min-w-0 items-center gap-1.5">
            {showGate ? (
                <Pill tone="gate">{t(`${T}.match.${operator}`)}</Pill>
            ) : null}
            <ul
                className={`flex min-w-0 flex-col gap-1 ${rules.length > 1 ? 'border-l-2 pl-2' : ''}`}
            >
                {rules.map((rule, index) => (
                    <li key={index} className="min-w-0">
                        <MapNode
                            rule={rule}
                            options={options}
                            active={active}
                        />
                    </li>
                ))}
            </ul>
        </div>
    );
}

/** A diagram of the conditions as entered, ending in the badge. */
export function BadgeRuleMap({
    rules,
    operator,
    badge,
    options = {}
}: {
    rules: readonly CustomBadgeRule[];
    operator: BadgeRuleOperator;
    badge: ReactNode;
    options?: BadgeRuleTextOptions;
}) {
    const { t } = useTranslation();
    return (
        <figure
            className="bg-muted/40 flex min-w-0 flex-col gap-1 rounded-md border p-2"
            aria-label={t(`${T}.map.title`)}
        >
            <figcaption className="text-muted-foreground text-xs font-medium">
                {t(`${T}.map.title`)}
            </figcaption>
            <div className="flex min-w-0 flex-wrap items-center gap-2 overflow-x-auto">
                <MapList
                    rules={rules}
                    operator={operator}
                    options={options}
                    active
                />
                <ArrowRightIcon className="text-muted-foreground size-4 shrink-0" />
                {badge}
            </div>
        </figure>
    );
}
