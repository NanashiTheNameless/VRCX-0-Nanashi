import { ExternalLinkIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isReservedBadgeIcon } from '@/domain/badges/customBadges';
import { cn } from '@/lib/utils';
import { openExternalLink } from '@/services/entityMediaService';
import { links } from '@/shared/constants/link';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import { Spinner } from '@/ui/shadcn/spinner';

import { BadgeIcon } from './BadgeIcon';
import { badgeIconLabel, useBadgeIconCatalog } from './badgeIcons';

// About 2,000 icons are available, so the grid draws them in batches as the
// list scrolls instead of all at once.
const BATCH = 160;

export function BadgeIconPicker({
    value,
    onValueChange,
    allowReserved = false
}: {
    value: string;
    onValueChange: (value: string) => void;
    // The global badge editor may pick any icon; custom badges may not.
    allowReserved?: boolean;
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const catalog = useBadgeIconCatalog(open);

    const { results, held } = useMemo(() => {
        const needle = query
            .trim()
            .toLowerCase()
            .replace(/[\s_-]+/g, '');
        const matches = (catalog?.names ?? []).filter(
            (name) => !needle || name.toLowerCase().includes(needle)
        );
        if (allowReserved) {
            return { results: matches, held: 0 };
        }
        const allowed = matches.filter((name) => !isReservedBadgeIcon(name));
        return { results: allowed, held: matches.length - allowed.length };
    }, [catalog, query, allowReserved]);
    const [shown, setShown] = useState(BATCH);
    // State, not a ref: the marker only exists once the popover is open,
    // and the effect below must run again when it appears.
    const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
    useEffect(() => {
        setShown(BATCH);
    }, [query, open]);
    useEffect(() => {
        if (!sentinel || shown >= results.length) {
            return;
        }
        if (typeof IntersectionObserver === 'undefined') {
            setShown(results.length);
            return;
        }
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                setShown((count) => count + BATCH);
            }
        });
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [results.length, shown, sentinel]);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
                render={
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        aria-label={t(
                            'view.settings.appearance.user_badges.icon'
                        )}
                    >
                        <BadgeIcon
                            name={value}
                            allowReserved={allowReserved}
                            className="size-4"
                        />
                        <span className="max-w-32 truncate">
                            {badgeIconLabel(value)}
                        </span>
                    </Button>
                }
            />
            <PopoverContent
                align="start"
                className="flex w-80 flex-col gap-2 p-2"
            >
                <Input
                    autoFocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t(
                        'view.settings.appearance.user_badges.icon_search'
                    )}
                    aria-label={t(
                        'view.settings.appearance.user_badges.icon_search'
                    )}
                />
                {catalog ? (
                    <>
                        <div className="grid max-h-72 grid-cols-8 gap-1 overflow-y-auto">
                            {results.slice(0, shown).map((name) => {
                                const Icon = catalog.icons[name];
                                const selected = name === value;
                                return (
                                    <Button
                                        key={name}
                                        type="button"
                                        variant={
                                            selected ? 'secondary' : 'ghost'
                                        }
                                        size="icon-sm"
                                        title={badgeIconLabel(name)}
                                        aria-label={badgeIconLabel(name)}
                                        aria-pressed={selected}
                                        className={cn(
                                            selected && 'text-primary'
                                        )}
                                        onClick={() => {
                                            onValueChange(name);
                                            setOpen(false);
                                        }}
                                    >
                                        {Icon ? (
                                            <Icon aria-hidden="true" />
                                        ) : null}
                                    </Button>
                                );
                            })}
                            {shown < results.length ? (
                                <div
                                    ref={setSentinel}
                                    aria-hidden="true"
                                    className="col-span-8 h-4"
                                />
                            ) : null}
                        </div>
                        {held > 0 && query.trim() ? (
                            <p className="text-muted-foreground text-xs">
                                {t(
                                    'view.settings.appearance.user_badges.icon_reserved'
                                )}
                            </p>
                        ) : null}
                        <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
                            <span>
                                {t(
                                    'view.settings.appearance.user_badges.icon_results',
                                    { count: results.length }
                                )}
                            </span>
                            <Button
                                type="button"
                                variant="link"
                                size="sm"
                                className="h-auto gap-1 p-0 text-xs"
                                onClick={() => {
                                    void openExternalLink(links.lucideIcons);
                                }}
                            >
                                <ExternalLinkIcon aria-hidden="true" />
                                {t(
                                    'view.settings.appearance.user_badges.icon_browse'
                                )}
                            </Button>
                        </div>
                    </>
                ) : (
                    <div className="flex justify-center p-4">
                        <Spinner />
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
}
