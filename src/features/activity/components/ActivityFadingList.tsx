import { ChevronDownIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { UserHoverCard } from '@/components/user-hover-card/UserHoverCard';
import { formatDateFilterOrFallback } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
import type { ActivityPageFadingRow } from '@/platform/tauri/bindings';
import { openUserDialog } from '@/services/dialogService';

const VISIBLE_ROWS = 5;
const MIN_DROP_PERCENT = 40;

export function ActivityFadingList({
    rows
}: {
    rows: ActivityPageFadingRow[];
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const listId = useId();
    const visible = rows
        .filter((row) => row.dropPercent >= MIN_DROP_PERCENT)
        .slice(0, VISIBLE_ROWS);

    if (visible.length === 0) {
        return null;
    }

    return (
        <div className="mt-4 border-t border-[var(--act-edge)] pt-3">
            <button
                type="button"
                aria-expanded={open}
                aria-controls={listId}
                onClick={() => setOpen((value) => !value)}
                className="text-muted-foreground hover:text-foreground flex w-full items-center justify-between gap-2 text-xs transition-colors"
            >
                <span>{t('view.activity.people.fading_title')}</span>
                <ChevronDownIcon
                    className={cn(
                        'size-4 text-[var(--act-accent)] transition-transform duration-300 ease-out',
                        open ? 'rotate-180' : ''
                    )}
                />
            </button>
            <div id={listId} className="activity-fold" data-open={open}>
                <div>
                    <div className="pt-3">
                        <p className="text-muted-foreground pb-2 text-xs">
                            {t('view.activity.people.fading_caveat')}
                        </p>
                        {visible.map((row) => (
                            <UserHoverCard
                                key={row.userId || row.displayName}
                                userId={row.userId}
                            >
                                <button
                                    type="button"
                                    onClick={() =>
                                        openUserDialog({
                                            userId: row.userId,
                                            title: row.displayName
                                        })
                                    }
                                    className="flex w-full items-center justify-between gap-3 px-2 py-1.5 text-left transition-colors hover:bg-[var(--act-track)]"
                                >
                                    <span className="text-muted-foreground truncate text-sm">
                                        {row.displayName || row.userId}
                                    </span>
                                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                                        {t(
                                            'view.activity.people.fading_last_seen',
                                            {
                                                date: formatDateFilterOrFallback(
                                                    row.lastSeenTogether,
                                                    'short'
                                                )
                                            }
                                        )}
                                    </span>
                                </button>
                            </UserHoverCard>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
