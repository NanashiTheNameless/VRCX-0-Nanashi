import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isReservedBadgeIcon } from '@/domain/badges/customBadges';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import { Spinner } from '@/ui/shadcn/spinner';

import { BadgeIcon } from './BadgeIcon';
import { badgeIconLabel, useBadgeIconCatalog } from './badgeIcons';

const RESULT_LIMIT = 240;

export function BadgeIconPicker({
    value,
    onValueChange
}: {
    value: string;
    onValueChange: (value: string) => void;
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const catalog = useBadgeIconCatalog(open);

    const { results, total } = useMemo(() => {
        const names = (catalog?.names ?? []).filter(
            (name) => !isReservedBadgeIcon(name)
        );
        const needle = query
            .trim()
            .toLowerCase()
            .replace(/[\s_-]+/g, '');
        const matches = needle
            ? names.filter((name) => name.toLowerCase().includes(needle))
            : names;
        return {
            results: matches.slice(0, RESULT_LIMIT),
            total: matches.length
        };
    }, [catalog, query]);

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
                        <BadgeIcon name={value} className="size-4" />
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
                            {results.map((name) => {
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
                        </div>
                        <div className="text-muted-foreground text-xs">
                            {total > results.length
                                ? t(
                                      'view.settings.appearance.user_badges.icon_results_limited',
                                      { shown: results.length, total }
                                  )
                                : t(
                                      'view.settings.appearance.user_badges.icon_results',
                                      { count: total }
                                  )}
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
