// VRChat's infoPush items, read the same way as VRCX's Info Push dialog.

import { isRecord } from '@/shared/utils/record';

export const INFO_PUSH_BANNER_CATEGORIES = [
    'quick-menu-banner',
    'loading-screen-banners'
];
export const INFO_PUSH_CATEGORY_ORDER = [
    'help-article',
    ...INFO_PUSH_BANNER_CATEGORIES
];

type Localized = string | { fallback?: string } | null | undefined;

type InfoPushSourceLink = {
    command?: string;
    parameters?: unknown[];
    name?: string;
};

export type InfoPushItem = Record<string, unknown> & {
    id?: string;
    isEnabled?: boolean;
    startDate?: string;
    endDate?: string;
    createdAt?: string;
    tags?: string[];
    data?: Record<string, unknown> & {
        name?: Localized;
        title?: string;
        description?: Localized;
        subtitle?: string;
        tooltipDescription?: Localized;
        disclaimerText?: string;
        body?: string;
        authorName?: string;
        finalName?: string;
        worldTag?: string;
        version?: string;
        contentList?: { name?: Localized };
        search?: { searchQuery?: string };
        imageUrl?: string;
        thumbnailImageUrl?: string;
        bannerImageUrl?: string;
        iconImageUrl?: string;
        domainList?: unknown[];
        onPressed?: InfoPushSourceLink;
        article?: {
            content?: Array<{
                imageUrl?: string;
                videoUrl?: string;
                text?: string;
            }>;
            moreInfoLinks?: InfoPushSourceLink[];
            embeddedLinkData?: InfoPushSourceLink[];
        };
    };
};

export type InfoPushLink = {
    command: string;
    target: string;
    name: string;
};

export type InfoPushBlock = {
    type: 'image' | 'video' | 'heading' | 'text';
    value: string;
};

function localize(value: Localized): string {
    if (typeof value === 'string') {
        return value;
    }
    return isRecord(value) && typeof value.fallback === 'string'
        ? value.fallback
        : '';
}

function text(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function dateMs(value: unknown): number {
    const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) ? parsed : 0;
}

export function infoPushCategory(item: InfoPushItem): string {
    const tags = Array.isArray(item.tags) ? item.tags : [];
    return (
        tags.find((tag) => INFO_PUSH_CATEGORY_ORDER.includes(tag)) ?? 'other'
    );
}

export function infoPushSortDate(item: InfoPushItem): number {
    return dateMs(item.startDate ?? item.createdAt);
}

export function infoPushName(item: InfoPushItem): string {
    const data = item.data ?? {};
    return (
        localize(data.name) ||
        text(data.title) ||
        localize(data.contentList?.name) ||
        text(data.finalName) ||
        text(data.worldTag) ||
        text(data.version) ||
        text(item.id)
    );
}

export function infoPushDescription(item: InfoPushItem): string {
    const data = item.data ?? {};
    return (
        localize(data.description) ||
        text(data.subtitle) ||
        localize(data.tooltipDescription) ||
        text(data.disclaimerText) ||
        text(data.body) ||
        text(data.search?.searchQuery) ||
        text(data.authorName) ||
        ''
    );
}

export function infoPushImageUrl(item: InfoPushItem): string {
    const data = item.data ?? {};
    const url =
        text(data.imageUrl) ||
        text(data.thumbnailImageUrl) ||
        text(data.bannerImageUrl) ||
        text(data.iconImageUrl);
    return /^https:\/\//i.test(url) ? url : '';
}

export function infoPushStatus(
    item: InfoPushItem,
    nowMs: number
): '' | 'disabled' | 'expired' | 'scheduled' {
    if (!item.isEnabled) {
        return 'disabled';
    }
    if (item.endDate && dateMs(item.endDate) < nowMs) {
        return 'expired';
    }
    if (item.startDate && dateMs(item.startDate) > nowMs) {
        return 'scheduled';
    }
    return '';
}

// VRChat writes article text with Unity rich text tags; keep the words.
function toPlainText(value: string): string {
    return value
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .trim();
}

export function infoPushArticleBlocks(item: InfoPushItem): InfoPushBlock[] {
    const blocks: InfoPushBlock[] = [];
    for (const content of item.data?.article?.content ?? []) {
        if (!isRecord(content)) {
            continue;
        }
        if (text(content.imageUrl)) {
            if (/^https:\/\//i.test(text(content.imageUrl))) {
                blocks.push({ type: 'image', value: text(content.imageUrl) });
            }
        } else if (text(content.videoUrl)) {
            blocks.push({ type: 'video', value: text(content.videoUrl) });
        } else if (text(content.text)) {
            const value = toPlainText(text(content.text));
            if (value) {
                const heading = /^<size=[^>]+>\s*<b>/i.test(
                    text(content.text).trim()
                );
                blocks.push({ type: heading ? 'heading' : 'text', value });
            }
        }
    }
    return blocks;
}

function toLink(source: InfoPushSourceLink): InfoPushLink {
    const parameters = Array.isArray(source.parameters)
        ? source.parameters
        : [];
    return {
        command: text(source.command),
        target: text(parameters[0]),
        name: text(source.name)
    };
}

export function infoPushActionLink(item: InfoPushItem): InfoPushLink | null {
    const onPressed = item.data?.onPressed;
    return isRecord(onPressed) && text(onPressed.command)
        ? toLink(onPressed)
        : null;
}

export function infoPushLinks(item: InfoPushItem): InfoPushLink[] {
    const article = item.data?.article;
    const links = new Map<string, InfoPushLink>();
    for (const source of [
        ...(article?.moreInfoLinks ?? []),
        ...(article?.embeddedLinkData ?? [])
    ]) {
        if (!isRecord(source) || !text(source.command)) {
            continue;
        }
        const link = toLink(source);
        const key = `${link.command}:${link.target}`;
        if (!links.has(key)) {
            links.set(key, link);
        }
    }
    return [...links.values()];
}
