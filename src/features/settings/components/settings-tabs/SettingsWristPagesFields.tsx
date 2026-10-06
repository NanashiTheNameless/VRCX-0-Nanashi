import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import configRepository from '@/repositories/configRepository';
import { Button } from '@/ui/shadcn/button';
import {
    NumberField,
    NumberFieldDecrement,
    NumberFieldGroup,
    NumberFieldIncrement,
    NumberFieldInput
} from '@/ui/shadcn/number-field';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';

import { Field } from '../SettingsField';

const P = 'view.settings.vr.wrist_overlay.pages';
const PAGES_KEY = 'wristOverlayPages';
const SORT_KEY = 'wristOverlayPlayersSort';
const TIMEOUT_KEY = 'wristOverlayTimeoutSeconds';
const FEED_ORDER_KEY = 'wristOverlayFeedOrder';

export type WristPageId = 'feed' | 'players' | 'notes';
type PageRow = { id: WristPageId; shown: boolean };

const ALL_PAGES: WristPageId[] = ['feed', 'players', 'notes'];
const MIN_TIMEOUT_SECONDS = 5;
const MAX_TIMEOUT_SECONDS = 255;
const SORTS = ['name', 'joined'] as const;
type PlayersSort = (typeof SORTS)[number];
const FEED_ORDERS = ['newestTop', 'newestBottom'] as const;
type FeedOrder = (typeof FEED_ORDERS)[number];

export function clampTimeoutSeconds(value: number): number {
    if (!Number.isFinite(value)) {
        return 15;
    }
    return Math.min(
        MAX_TIMEOUT_SECONDS,
        Math.max(MIN_TIMEOUT_SECONDS, Math.round(value))
    );
}

/** Shown pages in order first, then the hidden ones; mirrors the Rust parser. */
export function parseWristPages(value: string): PageRow[] {
    const shown: WristPageId[] = [];
    for (const part of value.split(',')) {
        const id = part.trim() as WristPageId;
        if (ALL_PAGES.includes(id) && !shown.includes(id)) {
            shown.push(id);
        }
    }
    if (!shown.length) {
        shown.push('feed');
    }
    return [
        ...shown.map((id) => ({ id, shown: true })),
        ...ALL_PAGES.filter((id) => !shown.includes(id)).map((id) => ({
            id,
            shown: false
        }))
    ];
}

export function serializeWristPages(rows: PageRow[]): string {
    return rows
        .filter((row) => row.shown)
        .map((row) => row.id)
        .join(',');
}

// Fork: choose which wrist pages exist, their order, the players order and how
// long the menu stays open before closing due to inactivity.
export function SettingsWristPagesFields({ disabled }: { disabled: boolean }) {
    const { t } = useTranslation();
    const [rows, setRows] = useState<PageRow[]>(() =>
        parseWristPages('feed,players,notes')
    );
    const [sort, setSort] = useState<PlayersSort>('name');
    const [feedOrder, setFeedOrder] = useState<FeedOrder>('newestTop');
    const [timeout, setTimeout] = useState<number>(15);

    useEffect(() => {
        let active = true;
        void Promise.all([
            configRepository.getString(PAGES_KEY, 'feed,players,notes'),
            configRepository.getString(SORT_KEY, 'name'),
            configRepository.getInt(TIMEOUT_KEY, 15),
            configRepository.getString(FEED_ORDER_KEY, 'newestTop')
        ])
            .then(([pages, players, seconds, order]) => {
                if (!active) return;
                setRows(parseWristPages(pages));
                setSort(players === 'joined' ? 'joined' : 'name');
                setFeedOrder(
                    order === 'newestBottom' ? 'newestBottom' : 'newestTop'
                );
                setTimeout(clampTimeoutSeconds(seconds));
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, []);

    async function save(key: string, value: string) {
        await configRepository.setString(key, value);
    }

    async function saveNumber(key: string, value: number) {
        await configRepository.setInt(key, value);
    }

    function updateRows(next: PageRow[]) {
        setRows(next);
        void save(PAGES_KEY, serializeWristPages(next));
    }

    function toggle(index: number, shown: boolean) {
        const next = rows.map((row, i) =>
            i === index ? { ...row, shown } : row
        );
        // At least one page stays shown.
        if (next.some((row) => row.shown)) {
            updateRows(next);
        }
    }

    function move(index: number, offset: -1 | 1) {
        const target = index + offset;
        if (target < 0 || target >= rows.length) return;
        const next = [...rows];
        [next[index], next[target]] = [next[target], next[index]];
        updateRows(next);
    }

    const shownCount = rows.filter((row) => row.shown).length;

    return (
        <>
            <Field
                label={t(`${P}.label`)}
                description={t(`${P}.description`)}
                disabled={disabled}
            >
                <div className="space-y-1">
                    {rows.map((row, index) => (
                        <div key={row.id} className="flex items-center gap-2">
                            <Switch
                                checked={row.shown}
                                disabled={
                                    disabled || (row.shown && shownCount === 1)
                                }
                                aria-label={t(`${P}.names.${row.id}`)}
                                onCheckedChange={(checked) =>
                                    toggle(index, checked === true)
                                }
                            />
                            <span className="w-20 text-sm">
                                {t(`${P}.names.${row.id}`)}
                            </span>
                            <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                aria-label={t(`${P}.move_up`)}
                                disabled={disabled || index === 0}
                                onClick={() => move(index, -1)}
                            >
                                <ArrowUpIcon />
                            </Button>
                            <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                aria-label={t(`${P}.move_down`)}
                                disabled={disabled || index === rows.length - 1}
                                onClick={() => move(index, 1)}
                            >
                                <ArrowDownIcon />
                            </Button>
                        </div>
                    ))}
                </div>
            </Field>

            <Field
                label={t(`${P}.feed_order`)}
                description={t(`${P}.feed_order_description`)}
                controlId="settings-wrist-overlay-feed-order"
                disabled={disabled}
            >
                <Select<FeedOrder>
                    value={feedOrder}
                    items={FEED_ORDERS.map((value) => ({
                        value,
                        label: t(`${P}.feed_orders.${value}`)
                    }))}
                    disabled={disabled}
                    onValueChange={(value) => {
                        if (value) {
                            setFeedOrder(value);
                            void save(FEED_ORDER_KEY, value);
                        }
                    }}
                >
                    <SelectTrigger
                        id="settings-wrist-overlay-feed-order"
                        className="w-56"
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {FEED_ORDERS.map((value) => (
                                <SelectItem key={value} value={value}>
                                    {t(`${P}.feed_orders.${value}`)}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </Field>

            <Field
                label={t(`${P}.players_sort`)}
                controlId="settings-wrist-overlay-players-sort"
                disabled={disabled}
            >
                <Select<PlayersSort>
                    value={sort}
                    items={SORTS.map((value) => ({
                        value,
                        label: t(`${P}.sort.${value}`)
                    }))}
                    disabled={disabled}
                    onValueChange={(value) => {
                        if (value) {
                            setSort(value);
                            void save(SORT_KEY, value);
                        }
                    }}
                >
                    <SelectTrigger
                        id="settings-wrist-overlay-players-sort"
                        className="w-56"
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {SORTS.map((value) => (
                                <SelectItem key={value} value={value}>
                                    {t(`${P}.sort.${value}`)}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </Field>

            <Field
                label={t(`${P}.timeout`)}
                description={t(`${P}.timeout_description`)}
                controlId="settings-wrist-overlay-timeout"
                disabled={disabled}
            >
                <NumberField
                    value={timeout}
                    min={MIN_TIMEOUT_SECONDS}
                    max={MAX_TIMEOUT_SECONDS}
                    step={5}
                    id="settings-wrist-overlay-timeout"
                    className="w-32"
                    onValueChange={(value) => {
                        if (value === null) {
                            return;
                        }
                        const seconds = clampTimeoutSeconds(value);
                        setTimeout(seconds);
                        void saveNumber(TIMEOUT_KEY, seconds);
                    }}
                >
                    <NumberFieldGroup>
                        <NumberFieldDecrement />
                        <NumberFieldInput />
                        <NumberFieldIncrement />
                    </NumberFieldGroup>
                </NumberField>
            </Field>
        </>
    );
}
