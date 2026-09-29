import { SearchIcon, XIcon } from 'lucide-react';
import { useEffect, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { useNavigationCacheStore } from '@/state/navigationCacheStore';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput
} from '@/ui/shadcn/input-group';

import { useSettingsPageSection } from '../SettingsPageStateContext';
import { useSettingsSearchStore } from '../settingsSearchStore';

// Fork: search across every settings tab by what is actually rendered, so
// results never drift from the UI.

export type SettingsSearchMatch = {
    key: string;
    tab: string;
    cardId: string | null;
    cardTitle: string;
    label: string;
    description: string;
    element: HTMLElement;
};

const HIGHLIGHT_CLASS = 'vrcx-0-settings-search-hit';

function readText(element: Element | null | undefined): string {
    return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Settings fields and cards under `root` whose text contains every word. */
export function findSettingsMatches(
    root: ParentNode,
    query: string
): SettingsSearchMatch[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) {
        return [];
    }
    const matchesAll = (text: string) =>
        words.every((word) => text.toLowerCase().includes(word));
    const ranked: Array<{ match: SettingsSearchMatch; rank: number }> = [];

    root.querySelectorAll<HTMLElement>('[data-settings-card-id]').forEach(
        (card) => {
            const title = readText(
                card.querySelector('[data-settings-card-title]')
            );
            if (!title || !matchesAll(title)) {
                return;
            }
            ranked.push({
                rank: 1,
                match: {
                    key: `card:${card.dataset.settingsCardId}`,
                    tab:
                        card.closest<HTMLElement>('[data-settings-tab]')
                            ?.dataset.settingsTab ?? '',
                    cardId: card.dataset.settingsCardId ?? null,
                    cardTitle: title,
                    label: title,
                    description: '',
                    element: card
                }
            });
        }
    );

    root.querySelectorAll<HTMLElement>('[data-settings-search-item]').forEach(
        (item, index) => {
            const label = readText(
                item.querySelector('[data-slot=field-label]')
            );
            if (!label) {
                return;
            }
            const description = readText(
                item.querySelector('[data-slot=field-description]')
            );
            const card = item.closest<HTMLElement>('[data-settings-card-id]');
            const cardTitle = readText(
                card?.querySelector('[data-settings-card-title]')
            );
            if (!matchesAll(`${label} ${description} ${cardTitle}`)) {
                return;
            }
            ranked.push({
                // Label hits first, then card title / description hits.
                rank: matchesAll(label) ? 0 : 2,
                match: {
                    key: `field:${index}`,
                    tab:
                        item.closest<HTMLElement>('[data-settings-tab]')
                            ?.dataset.settingsTab ?? '',
                    cardId: card?.dataset.settingsCardId ?? null,
                    cardTitle,
                    label,
                    description,
                    element: item
                }
            });
        }
    );

    return ranked
        .map((entry, order) => ({ ...entry, order }))
        .sort((a, b) => a.rank - b.rank || a.order - b.order)
        .map((entry) => entry.match);
}

export function SettingsSearchInput() {
    const { t } = useTranslation();
    const query = useSettingsSearchStore((state) => state.query);
    const setQuery = useSettingsSearchStore((state) => state.setQuery);

    // Start empty each time the settings page opens.
    useEffect(() => () => setQuery(''), [setQuery]);

    return (
        <InputGroup className="mb-2">
            <InputGroupAddon>
                <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
                type="search"
                value={query}
                placeholder={t('view.settings.search.placeholder')}
                aria-label={t('view.settings.search.placeholder')}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                        setQuery('');
                    }
                }}
            />
            {query ? (
                <InputGroupAddon align="inline-end">
                    <InputGroupButton
                        size="icon-xs"
                        aria-label={t('view.settings.search.clear')}
                        onClick={() => setQuery('')}
                    >
                        <XIcon />
                    </InputGroupButton>
                </InputGroupAddon>
            ) : null}
        </InputGroup>
    );
}

export function SettingsSearchResults({
    containerRef
}: {
    containerRef: RefObject<HTMLElement | null>;
}) {
    const { t } = useTranslation();
    const shell = useSettingsPageSection('shell');
    const query = useSettingsSearchStore((state) => state.query);
    const setQuery = useSettingsSearchStore((state) => state.setQuery);
    const setCardOpen = useNavigationCacheStore(
        (state) => state.setSettingsCardOpen
    );
    const [matches, setMatches] = useState<SettingsSearchMatch[]>([]);
    const tabLabels = new Map(
        shell.settingsTabs.map(([value, labelKey]) => [value, t(labelKey)])
    );

    // Tabs mount in the same commit the query appears, so read the DOM after
    // it has painted.
    useEffect(() => {
        const frame = window.requestAnimationFrame(() => {
            setMatches(
                containerRef.current
                    ? findSettingsMatches(containerRef.current, query)
                    : []
            );
        });
        return () => window.cancelAnimationFrame(frame);
    }, [containerRef, query]);

    function open(match: SettingsSearchMatch) {
        setQuery('');
        if (match.tab) {
            shell.setActiveSettingsTab(match.tab);
        }
        if (match.cardId) {
            setCardOpen(match.cardId, true);
        }
        // Wait for the tab to show and the card to expand before scrolling.
        window.requestAnimationFrame(() =>
            window.requestAnimationFrame(() => {
                if (!match.element.isConnected) {
                    return;
                }
                match.element.scrollIntoView({ block: 'center' });
                match.element.classList.add(HIGHLIGHT_CLASS);
                window.setTimeout(
                    () => match.element.classList.remove(HIGHLIGHT_CLASS),
                    1600
                );
            })
        );
    }

    if (!matches.length) {
        return (
            <p className="text-muted-foreground p-4 text-sm">
                {t('view.settings.search.no_results', { query: query.trim() })}
            </p>
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pb-4">
            <p className="text-muted-foreground px-1 pb-1 text-xs">
                {t('view.settings.search.results', { count: matches.length })}
            </p>
            {matches.map((match) => (
                <button
                    key={match.key}
                    type="button"
                    className="hover:bg-accent focus-visible:ring-ring flex flex-col gap-0.5 rounded-lg px-3 py-2 text-left outline-none focus-visible:ring-2"
                    onClick={() => open(match)}
                >
                    <span className="text-muted-foreground text-xs">
                        {[tabLabels.get(match.tab), match.cardTitle]
                            .filter(
                                (part, index, parts) =>
                                    part &&
                                    // Card results show their title once.
                                    !(index === 1 && part === match.label) &&
                                    parts.indexOf(part) === index
                            )
                            .join(' › ')}
                    </span>
                    <span className="text-sm font-medium">{match.label}</span>
                    {match.description ? (
                        <span className="text-muted-foreground line-clamp-2 text-xs">
                            {match.description}
                        </span>
                    ) : null}
                </button>
            ))}
        </div>
    );
}
