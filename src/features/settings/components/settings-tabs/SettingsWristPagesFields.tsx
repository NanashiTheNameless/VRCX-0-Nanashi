import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import configRepository from '@/repositories/configRepository';
import { Button } from '@/ui/shadcn/button';
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
const FLIP_KEY = 'wristOverlayPageFlipSeconds';

export type WristPageId = 'feed' | 'players' | 'notes';
type PageRow = { id: WristPageId; shown: boolean };

const ALL_PAGES: WristPageId[] = ['feed', 'players', 'notes'];
const FLIP_SECONDS = ['1', '2', '3', '4', '5', '6', '8', '10'];
const SORTS = ['name', 'joined'] as const;
type PlayersSort = (typeof SORTS)[number];

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
// fast a hide-then-show must be to switch pages.
export function SettingsWristPagesFields({ disabled }: { disabled: boolean }) {
    const { t } = useTranslation();
    const [rows, setRows] = useState<PageRow[]>(() =>
        parseWristPages('feed,players,notes')
    );
    const [sort, setSort] = useState<PlayersSort>('name');
    const [flip, setFlip] = useState('3');

    useEffect(() => {
        let active = true;
        void Promise.all([
            configRepository.getString(PAGES_KEY, 'feed,players,notes'),
            configRepository.getString(SORT_KEY, 'name'),
            configRepository.getString(FLIP_KEY, '3')
        ])
            .then(([pages, players, seconds]) => {
                if (!active) return;
                setRows(parseWristPages(pages));
                setSort(players === 'joined' ? 'joined' : 'name');
                setFlip(FLIP_SECONDS.includes(seconds) ? seconds : '3');
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, []);

    async function save(key: string, value: string) {
        await configRepository.setString(key, value);
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
                label={t(`${P}.flip_window`)}
                description={t(`${P}.flip_window_description`)}
                controlId="settings-wrist-overlay-page-flip"
                disabled={disabled || shownCount < 2}
            >
                <Select<string>
                    value={flip}
                    items={FLIP_SECONDS.map((value) => ({
                        value,
                        label: t(`${P}.seconds`, { count: Number(value) })
                    }))}
                    disabled={disabled || shownCount < 2}
                    onValueChange={(value) => {
                        if (value) {
                            setFlip(value);
                            void save(FLIP_KEY, value);
                        }
                    }}
                >
                    <SelectTrigger
                        id="settings-wrist-overlay-page-flip"
                        className="w-56"
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {FLIP_SECONDS.map((value) => (
                                <SelectItem key={value} value={value}>
                                    {t(`${P}.seconds`, {
                                        count: Number(value)
                                    })}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </Field>
        </>
    );
}
