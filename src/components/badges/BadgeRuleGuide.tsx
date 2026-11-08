import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    BADGE_RULE_OPERATORS,
    combineBadgeRules
} from '@/domain/badges/customBadges';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';

const T = 'view.settings.appearance.user_badges';
const OPERATORS = [...BADGE_RULE_OPERATORS, 'not'] as const;
const INPUTS = [
    [false, false],
    [false, true],
    [true, false],
    [true, true]
] as const;

export function BadgeRuleGuide() {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [a, setA] = useState(true);
    const [b, setB] = useState(false);
    const resultLabel = (matches: boolean) =>
        t(`${T}.guide.${matches ? 'matches' : 'no_match'}`);
    const signalColor = (matches: boolean) =>
        matches ? 'var(--color-emerald-500)' : 'var(--color-slate-400)';

    return (
        <div className="rounded-md border p-2">
            <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
            >
                {t(`${T}.guide.title`)}
            </Button>
            {open ? (
                <div className="mt-2 flex flex-col gap-3">
                    <p className="text-muted-foreground text-xs">
                        {t(`${T}.guide.intro`)}
                    </p>
                    <div className="flex flex-wrap gap-4">
                        <label className="flex items-center gap-2 text-sm">
                            <Checkbox checked={a} onCheckedChange={setA} />
                            {t(`${T}.guide.input_a`)}
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                            <Checkbox checked={b} onCheckedChange={setB} />
                            {t(`${T}.guide.input_b`)}
                        </label>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                        {OPERATORS.map((operator) => {
                            const matches =
                                operator === 'not'
                                    ? !a
                                    : combineBadgeRules(operator, [a, b]);
                            const unary = operator === 'not';
                            return (
                                <div
                                    key={operator}
                                    className="rounded border p-2"
                                >
                                    <p className="text-sm font-medium">
                                        {operator.toUpperCase()}
                                    </p>
                                    <svg
                                        viewBox="0 0 280 90"
                                        className="w-full"
                                        role="img"
                                        aria-label={`${operator.toUpperCase()}: A ${resultLabel(a)}${unary ? '' : `, B ${resultLabel(b)}`}, ${resultLabel(matches)}`}
                                    >
                                        <path
                                            d={
                                                unary
                                                    ? 'M35 45 H100'
                                                    : 'M35 25 H70 V45 H100 M35 65 H70 V45'
                                            }
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                        />
                                        <path
                                            d="M170 45 H235"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                        />
                                        <circle
                                            cx="35"
                                            cy={unary ? 45 : 25}
                                            r="10"
                                            fill={signalColor(a)}
                                        />
                                        <text
                                            x="12"
                                            y={unary ? 49 : 29}
                                            fill="currentColor"
                                            fontSize="12"
                                        >
                                            A
                                        </text>
                                        {!unary ? (
                                            <>
                                                <circle
                                                    cx="35"
                                                    cy="65"
                                                    r="10"
                                                    fill={signalColor(b)}
                                                />
                                                <text
                                                    x="12"
                                                    y="69"
                                                    fill="currentColor"
                                                    fontSize="12"
                                                >
                                                    B
                                                </text>
                                            </>
                                        ) : null}
                                        <rect
                                            x="100"
                                            y="27"
                                            width="70"
                                            height="36"
                                            rx="8"
                                            fill="none"
                                            stroke="currentColor"
                                        />
                                        <text
                                            x="135"
                                            y="49"
                                            textAnchor="middle"
                                            fill="currentColor"
                                            fontSize="13"
                                        >
                                            {operator.toUpperCase()}
                                        </text>
                                        <circle
                                            cx="235"
                                            cy="45"
                                            r="12"
                                            fill={signalColor(matches)}
                                        />
                                    </svg>
                                    <p className="text-xs font-medium">
                                        {resultLabel(matches)}
                                    </p>
                                    <p className="text-muted-foreground mt-1 text-xs">
                                        {t(
                                            `${T}.operator_description.${operator}`
                                        )}
                                    </p>
                                </div>
                            );
                        })}
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-center text-xs">
                            <caption className="mb-2 text-left font-medium">
                                {t(`${T}.guide.truth_table`)}
                            </caption>
                            <thead>
                                <tr>
                                    <th scope="col" className="p-1">
                                        A
                                    </th>
                                    <th scope="col" className="p-1">
                                        B
                                    </th>
                                    {OPERATORS.map((operator) => (
                                        <th
                                            scope="col"
                                            className="p-1"
                                            key={operator}
                                        >
                                            {operator === 'not'
                                                ? 'NOT A'
                                                : operator.toUpperCase()}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {INPUTS.map(([first, second], index) => (
                                    <tr
                                        key={index}
                                        className={
                                            a === first && b === second
                                                ? 'bg-muted'
                                                : ''
                                        }
                                    >
                                        <th scope="row" className="p-1">
                                            {Number(first)}
                                        </th>
                                        <td className="p-1">
                                            {Number(second)}
                                        </td>
                                        {OPERATORS.map((operator) => {
                                            const matches =
                                                operator === 'not'
                                                    ? !first
                                                    : combineBadgeRules(
                                                          operator,
                                                          [first, second]
                                                      );
                                            return (
                                                <td
                                                    key={operator}
                                                    className="p-1"
                                                >
                                                    <span
                                                        className={
                                                            matches
                                                                ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                                                                : 'text-muted-foreground'
                                                        }
                                                    >
                                                        {Number(matches)}
                                                    </span>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p className="text-muted-foreground text-xs">
                        {t(`${T}.guide.legend`)}
                    </p>
                    <p className="text-muted-foreground text-xs">
                        {t(`${T}.guide.groups`)}
                    </p>
                    <p className="text-muted-foreground text-xs">
                        {t(`${T}.guide.missing`)}
                    </p>
                </div>
            ) : null}
        </div>
    );
}
