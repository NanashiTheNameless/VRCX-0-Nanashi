import {
    ChevronRightIcon,
    ExternalLinkIcon,
    RefreshCwIcon,
    RssIcon,
    VideoIcon
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState, LoadingState } from '@/components/layout/PageScaffold';
import { FadeInImage } from '@/components/media/FadeInImage';
import { formatDateFilter } from '@/lib/dateTime';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { cn } from '@/lib/utils';
import { commands } from '@/platform/tauri/bindings';
import { unwrapVrchatResponse } from '@/repositories/vrchatRequest';
import { openExternalLink } from '@/services/shellIntegrationService';
import { isRecord } from '@/shared/utils/record';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';

import {
    infoPushActionLink,
    infoPushArticleBlocks,
    infoPushCategory,
    infoPushDescription,
    infoPushImageUrl,
    infoPushLinks,
    infoPushName,
    infoPushSortDate,
    infoPushStatus,
    INFO_PUSH_BANNER_CATEGORIES,
    INFO_PUSH_CATEGORY_ORDER,
    type InfoPushItem,
    type InfoPushLink
} from './infoPushModel';

type LoadState =
    | { status: 'loading' }
    | { status: 'error'; error: unknown }
    | { status: 'ready'; items: InfoPushItem[]; loadedAtMs: number };

const NO_ITEMS: InfoPushItem[] = [];

export function InfoPushDialog({
    open,
    onOpenChange
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useTranslation();
    const [state, setState] = useState<LoadState>({ status: 'loading' });
    const [activeCategory, setActiveCategory] = useState<string>(
        INFO_PUSH_CATEGORY_ORDER[0]
    );
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    const load = useCallback(async () => {
        setState({ status: 'loading' });
        setExpanded(new Set());
        try {
            const response = unwrapVrchatResponse<unknown>(
                await commands.appVrchatInfoPushGet(),
                'infoPush'
            );
            const items = (
                Array.isArray(response.json) ? response.json : []
            ).filter(isRecord) as InfoPushItem[];
            setState({
                status: 'ready',
                items: [...items].sort(
                    (a, b) => infoPushSortDate(b) - infoPushSortDate(a)
                ),
                // Expired and scheduled are judged as of this load.
                loadedAtMs: Date.now()
            });
        } catch (error) {
            setState({ status: 'error', error });
        }
    }, []);

    useEffect(() => {
        if (open) {
            void load();
        }
    }, [open, load]);

    const items = state.status === 'ready' ? state.items : NO_ITEMS;
    const loadedAtMs = state.status === 'ready' ? state.loadedAtMs : 0;
    const itemsById = useMemo(
        () => new Map(items.map((item) => [String(item.id ?? ''), item])),
        [items]
    );
    const categories = useMemo(() => {
        const counts = new Map<string, number>();
        for (const item of items) {
            const category = infoPushCategory(item);
            counts.set(category, (counts.get(category) ?? 0) + 1);
        }
        const rank = (name: string) => {
            const index = INFO_PUSH_CATEGORY_ORDER.indexOf(name);
            return index === -1 ? INFO_PUSH_CATEGORY_ORDER.length : index;
        };
        return [...counts]
            .map(([name, count]) => ({ name, count }))
            .sort(
                (a, b) =>
                    rank(a.name) - rank(b.name) ||
                    b.count - a.count ||
                    a.name.localeCompare(b.name)
            );
    }, [items]);

    useEffect(() => {
        if (
            categories.length > 0 &&
            !categories.some((category) => category.name === activeCategory)
        ) {
            setActiveCategory(categories[0].name);
        }
    }, [categories, activeCategory]);

    const visible = items.filter(
        (item) => infoPushCategory(item) === activeCategory
    );

    function categoryLabel(name: string) {
        return INFO_PUSH_CATEGORY_ORDER.includes(name)
            ? t(`dialog.info_push.categories.${name}`)
            : name;
    }

    function isActionable(link: InfoPushLink) {
        if (link.command === 'OpenURL') {
            return /^https?:\/\//i.test(link.target);
        }
        return link.command === 'OpenHelpArticle' && itemsById.has(link.target);
    }

    function linkLabel(link: InfoPushLink) {
        if (link.name) {
            return link.name;
        }
        const article = itemsById.get(link.target);
        if (link.command === 'OpenHelpArticle' && article) {
            return infoPushName(article);
        }
        if (link.command === 'OpenURL') {
            return t('dialog.info_push.open_link');
        }
        return link.command;
    }

    function runLink(link: InfoPushLink) {
        if (link.command === 'OpenURL') {
            void openExternalLink(link.target);
            return;
        }
        const article = itemsById.get(link.target);
        if (link.command === 'OpenHelpArticle' && article) {
            setActiveCategory(infoPushCategory(article));
            setExpanded((current) => new Set(current).add(link.target));
            requestAnimationFrame(() => {
                document
                    .getElementById(`info-push-${link.target}`)
                    ?.scrollIntoView({ block: 'nearest' });
            });
        }
    }

    function toggle(id: string) {
        setExpanded((current) => {
            const next = new Set(current);
            if (!next.delete(id)) {
                next.add(id);
            }
            return next;
        });
    }

    function linkButton(link: InfoPushLink) {
        return (
            <Button
                key={`${link.command}:${link.target}`}
                type="button"
                size="sm"
                variant="outline"
                disabled={!isActionable(link)}
                onClick={(event) => {
                    event.stopPropagation();
                    runLink(link);
                }}
            >
                {link.command === 'OpenURL' ? (
                    <ExternalLinkIcon data-icon="inline-start" />
                ) : null}
                {linkLabel(link)}
            </Button>
        );
    }

    function renderBanner(item: InfoPushItem) {
        const id = String(item.id ?? '');
        const imageUrl = infoPushImageUrl(item);
        const action = infoPushActionLink(item);
        return (
            <div
                key={id}
                id={`info-push-${id}`}
                className="flex flex-col gap-1"
            >
                {imageUrl ? (
                    <FadeInImage
                        src={imageUrl}
                        alt={infoPushName(item)}
                        className="w-full rounded"
                    />
                ) : (
                    <div className="text-sm font-medium">
                        {infoPushName(item)}
                    </div>
                )}
                <div className="text-muted-foreground flex items-center gap-2 text-xs">
                    <span>
                        {formatDateFilter(
                            item.startDate ?? item.createdAt,
                            'long'
                        )}
                    </span>
                    {item.endDate ? (
                        <span>
                            {t('dialog.info_push.end_date')}:{' '}
                            {formatDateFilter(item.endDate, 'long')}
                        </span>
                    ) : null}
                    <span className="ml-auto">
                        {action ? linkButton(action) : null}
                    </span>
                </div>
            </div>
        );
    }

    function renderArticle(item: InfoPushItem) {
        const id = String(item.id ?? '');
        const isOpen = expanded.has(id);
        const imageUrl = infoPushImageUrl(item);
        const description = infoPushDescription(item);
        const status = infoPushStatus(item, loadedAtMs);
        const action = infoPushActionLink(item);
        const blocks = isOpen ? infoPushArticleBlocks(item) : [];
        const links = isOpen ? infoPushLinks(item) : [];
        const domains = Array.isArray(item.data?.domainList)
            ? item.data.domainList
            : [];
        return (
            <div
                key={id}
                id={`info-push-${id}`}
                className="border-b py-2 last:border-b-0"
            >
                <button
                    type="button"
                    className="flex w-full gap-3 text-left"
                    onClick={() => toggle(id)}
                >
                    {imageUrl ? (
                        <FadeInImage
                            src={imageUrl}
                            alt=""
                            className="h-14 w-24 flex-none rounded object-cover"
                        />
                    ) : null}
                    <div className="min-w-0 flex-1 text-sm">
                        <div className="flex items-center gap-2">
                            <ChevronRightIcon
                                className={cn(
                                    'text-muted-foreground size-4 flex-none transition-transform',
                                    isOpen && 'rotate-90'
                                )}
                            />
                            <span className="truncate font-medium">
                                {infoPushName(item)}
                            </span>
                            {status ? (
                                <Badge
                                    variant="destructive"
                                    className="flex-none"
                                >
                                    {t(`dialog.info_push.${status}`)}
                                </Badge>
                            ) : null}
                            <span className="text-muted-foreground ml-auto flex-none text-xs">
                                {formatDateFilter(
                                    item.startDate ?? item.createdAt,
                                    'long'
                                )}
                            </span>
                        </div>
                        {description ? (
                            <div
                                className={cn(
                                    'text-muted-foreground text-xs',
                                    !isOpen && 'line-clamp-2'
                                )}
                            >
                                {description}
                            </div>
                        ) : null}
                        {item.endDate ? (
                            <div className="text-muted-foreground mt-1 text-xs">
                                {t('dialog.info_push.end_date')}:{' '}
                                {formatDateFilter(item.endDate, 'long')}
                            </div>
                        ) : null}
                    </div>
                </button>
                {isOpen ? (
                    <div className="mt-3 flex flex-col gap-3 pl-7 text-sm">
                        {blocks.map((block, index) =>
                            block.type === 'image' ? (
                                <FadeInImage
                                    key={index}
                                    src={block.value}
                                    alt=""
                                    className="w-full max-w-lg rounded"
                                />
                            ) : block.type === 'video' ? (
                                <Button
                                    key={index}
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="self-start"
                                    disabled={
                                        !/^https?:\/\//i.test(block.value)
                                    }
                                    onClick={() => {
                                        void openExternalLink(block.value);
                                    }}
                                >
                                    <VideoIcon data-icon="inline-start" />
                                    {t('dialog.info_push.open_video')}
                                </Button>
                            ) : (
                                <p
                                    key={index}
                                    className={cn(
                                        'whitespace-pre-line',
                                        block.type === 'heading' &&
                                            'text-base font-semibold'
                                    )}
                                >
                                    {block.value}
                                </p>
                            )
                        )}
                        {domains.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-1">
                                <span className="text-muted-foreground text-xs">
                                    {t('dialog.info_push.domains')}:
                                </span>
                                {domains.map((entry, index) => (
                                    <Badge key={index} variant="outline">
                                        {isRecord(entry)
                                            ? String(entry.domain ?? '')
                                            : String(entry)}
                                    </Badge>
                                ))}
                            </div>
                        ) : null}
                        {links.length > 0 || action ? (
                            <div className="flex flex-wrap gap-2">
                                {[...(action ? [action] : []), ...links].map(
                                    linkButton
                                )}
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </div>
        );
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{t('dialog.info_push.header')}</DialogTitle>
                    <DialogDescription>
                        {t('dialog.info_push.description')}
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-wrap items-center gap-2">
                    <ToggleGroup
                        variant="outline"
                        size="sm"
                        value={[activeCategory]}
                        onValueChange={(value) => {
                            const next = value[0];
                            if (next) {
                                setActiveCategory(next);
                            }
                        }}
                    >
                        {categories.map((category) => (
                            <ToggleGroupItem
                                key={category.name}
                                value={category.name}
                            >
                                {categoryLabel(category.name)} ({category.count}
                                )
                            </ToggleGroupItem>
                        ))}
                    </ToggleGroup>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="ml-auto"
                        disabled={state.status === 'loading'}
                        aria-label={t('common.actions.refresh')}
                        title={t('common.actions.refresh')}
                        onClick={() => {
                            void load();
                        }}
                    >
                        <RefreshCwIcon
                            className={cn(
                                state.status === 'loading' && 'animate-spin'
                            )}
                        />
                    </Button>
                </div>
                <div className="max-h-[60vh] overflow-y-auto">
                    {state.status === 'loading' ? (
                        <LoadingState variant="panel" />
                    ) : state.status === 'error' ? (
                        <EmptyState
                            variant="panel"
                            title={t('dialog.info_push.failed_to_load')}
                            description={userFacingErrorMessage(state.error)}
                        />
                    ) : visible.length === 0 ? (
                        <EmptyState
                            variant="panel"
                            icon={RssIcon}
                            title={t('dialog.info_push.empty')}
                        />
                    ) : INFO_PUSH_BANNER_CATEGORIES.includes(activeCategory) ? (
                        <div className="flex flex-col gap-4">
                            {visible.map(renderBanner)}
                        </div>
                    ) : (
                        visible.map(renderArticle)
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
