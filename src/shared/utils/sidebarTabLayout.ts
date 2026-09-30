import {
    DEFAULT_NAV_ICON_KEY,
    normalizeNavIconKey
} from '@/shared/constants/navIcons';
import { isRecord } from '@/shared/utils/record';

const SYSTEM_TAB_FRIENDS = 'friends';
const SYSTEM_TAB_GROUPS = 'groups';

type SidebarSystemTabId = typeof SYSTEM_TAB_FRIENDS | typeof SYSTEM_TAB_GROUPS;

interface SidebarSystemTabLayoutItem {
    id: SidebarSystemTabId;
    type: 'system';
    systemTab: SidebarSystemTabId;
    icon: string;
    visible: boolean;
}

export interface SidebarFavoriteCollectionTabLayoutItem {
    id: string;
    type: 'favoriteCollection';
    name: string;
    icon: string;
    visible: boolean;
    sourceGroupKeys: string[];
}

export interface SidebarWorldRoomsTabLayoutItem {
    id: string;
    type: 'worldRooms';
    worldId: string;
    name: string;
    visible: boolean;
}

export type SidebarTabLayoutItem =
    | SidebarSystemTabLayoutItem
    | SidebarFavoriteCollectionTabLayoutItem
    | SidebarWorldRoomsTabLayoutItem;

export type SidebarTabLayout = SidebarTabLayoutItem[];

export interface FavoriteGroupItem {
    key: string;
    label: string;
    source: 'remote' | 'local';
}

function isSidebarSystemTabLayoutItem(
    item: SidebarTabLayoutItem
): item is SidebarSystemTabLayoutItem {
    return item.type === 'system';
}

export const DEFAULT_SIDEBAR_TAB_LAYOUT: SidebarTabLayout = [
    {
        id: SYSTEM_TAB_FRIENDS,
        type: 'system',
        systemTab: SYSTEM_TAB_FRIENDS,
        icon: 'lucide:UserRound',
        visible: true
    },
    {
        id: SYSTEM_TAB_GROUPS,
        type: 'system',
        systemTab: SYSTEM_TAB_GROUPS,
        icon: 'lucide:UsersRound',
        visible: true
    }
];

function normalizeText(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function uniqueStrings(values: unknown): string[] {
    if (!Array.isArray(values)) {
        return [];
    }
    return Array.from(
        new Set(values.map((value) => normalizeText(value)).filter(Boolean))
    );
}

function parseLayoutValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value;
    }
    if (typeof value !== 'string' || !value.trim()) {
        return [];
    }
    try {
        return JSON.parse(value);
    } catch {
        return [];
    }
}

function normalizeSystemTab(
    systemTab: SidebarSystemTabId,
    source?: Record<string, unknown>
): SidebarSystemTabLayoutItem {
    const fallback = DEFAULT_SIDEBAR_TAB_LAYOUT.find(
        (item): item is SidebarSystemTabLayoutItem =>
            isSidebarSystemTabLayoutItem(item) && item.systemTab === systemTab
    );
    const visible =
        systemTab === SYSTEM_TAB_FRIENDS ? true : source?.visible !== false;
    return {
        id: systemTab,
        type: 'system',
        systemTab,
        icon: normalizeNavIconKey(source?.icon, fallback?.icon),
        visible
    };
}

function normalizeFavoriteCollectionTab(
    item: Record<string, unknown>,
    seenIds: Set<string>
): SidebarFavoriteCollectionTabLayoutItem | null {
    const id = normalizeText(item.id);
    if (!id || seenIds.has(id)) {
        return null;
    }
    seenIds.add(id);
    const name = normalizeText(item.name) || 'Favorite Collection';
    return {
        id,
        type: 'favoriteCollection',
        name,
        icon: normalizeNavIconKey(item.icon, 'lucide:UserStar'),
        visible: item.visible !== false,
        sourceGroupKeys: uniqueStrings(item.sourceGroupKeys)
    };
}

function normalizeWorldRoomsTab(
    item: Record<string, unknown>,
    seenIds: Set<string>,
    seenWorldIds: Set<string>
): SidebarWorldRoomsTabLayoutItem | null {
    const id = normalizeText(item.id);
    const worldId = normalizeText(item.worldId);
    if (
        !id ||
        !worldId.startsWith('wrld_') ||
        seenIds.has(id) ||
        seenWorldIds.has(worldId)
    ) {
        return null;
    }
    seenIds.add(id);
    seenWorldIds.add(worldId);
    return {
        id,
        type: 'worldRooms',
        worldId,
        name: normalizeText(item.name) || worldId,
        visible: item.visible !== false
    };
}

export function normalizeSidebarTabLayout(value: unknown): SidebarTabLayout {
    const parsed = parseLayoutValue(value);
    const sourceItems = Array.isArray(parsed) ? parsed : [];
    const nextLayout: SidebarTabLayout = [];
    const seenSystemTabs = new Set<SidebarSystemTabId>();
    const seenCustomIds = new Set<string>();
    const seenWorldIds = new Set<string>();

    for (const rawItem of sourceItems) {
        if (!isRecord(rawItem)) {
            continue;
        }
        const item = rawItem;
        if (item.type === 'system') {
            const systemTab = normalizeText(item.systemTab || item.id);
            if (
                (systemTab === SYSTEM_TAB_FRIENDS ||
                    systemTab === SYSTEM_TAB_GROUPS) &&
                !seenSystemTabs.has(systemTab)
            ) {
                nextLayout.push(normalizeSystemTab(systemTab, item));
                seenSystemTabs.add(systemTab);
            }
            continue;
        }

        if (item.type === 'favoriteCollection') {
            const customTab = normalizeFavoriteCollectionTab(
                item,
                seenCustomIds
            );
            if (customTab) {
                nextLayout.push(customTab);
            }
            continue;
        }

        if (item.type === 'worldRooms') {
            const worldTab = normalizeWorldRoomsTab(
                item,
                seenCustomIds,
                seenWorldIds
            );
            if (worldTab) {
                nextLayout.push(worldTab);
            }
        }
    }

    if (!seenSystemTabs.has(SYSTEM_TAB_FRIENDS)) {
        nextLayout.unshift(normalizeSystemTab(SYSTEM_TAB_FRIENDS));
    }
    if (!seenSystemTabs.has(SYSTEM_TAB_GROUPS)) {
        nextLayout.push(normalizeSystemTab(SYSTEM_TAB_GROUPS));
    }

    return nextLayout;
}

export function serializeSidebarTabLayout(layout: SidebarTabLayout): string {
    return JSON.stringify(normalizeSidebarTabLayout(layout));
}

export function createFavoriteCollectionTab(
    existingLayout: SidebarTabLayout,
    label = 'Favorite Collection'
): SidebarFavoriteCollectionTabLayoutItem {
    const existingIds = new Set(existingLayout.map((item) => item.id));
    let index = existingLayout.filter(
        (item) => item.type === 'favoriteCollection'
    ).length;
    let id = '';
    do {
        index += 1;
        id = `favorite-collection-${Date.now()}-${index}`;
    } while (existingIds.has(id));

    return {
        id,
        type: 'favoriteCollection',
        name: label,
        icon: 'lucide:UserStar',
        visible: true,
        sourceGroupKeys: []
    };
}

export function upsertWorldRoomsTab(
    existingLayout: SidebarTabLayout,
    world: { worldId: string; name: string }
): { layout: SidebarTabLayout; tabId: string } {
    const layout = normalizeSidebarTabLayout(existingLayout);
    const existing = layout.find(
        (item): item is SidebarWorldRoomsTabLayoutItem =>
            item.type === 'worldRooms' && item.worldId === world.worldId
    );
    if (existing) {
        return {
            layout: layout.map((item) =>
                item.id === existing.id ? { ...item, visible: true } : item
            ),
            tabId: existing.id
        };
    }
    const existingIds = new Set(layout.map((item) => item.id));
    let id = `world-rooms-${world.worldId}`;
    for (let index = 2; existingIds.has(id); index += 1) {
        id = `world-rooms-${world.worldId}-${index}`;
    }
    return {
        layout: normalizeSidebarTabLayout([
            ...layout,
            {
                id,
                type: 'worldRooms',
                worldId: world.worldId,
                name: world.name.trim() || world.worldId,
                visible: true
            }
        ]),
        tabId: id
    };
}

export function getVisibleSidebarTabs(
    layout: SidebarTabLayout
): SidebarTabLayout {
    return normalizeSidebarTabLayout(layout).filter((item) => item.visible);
}

export function moveSidebarTab(
    layout: SidebarTabLayout,
    fromIndex: number,
    toIndex: number
): SidebarTabLayout {
    if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= layout.length ||
        toIndex >= layout.length
    ) {
        return layout;
    }
    const nextLayout = [...layout];
    const [item] = nextLayout.splice(fromIndex, 1);
    nextLayout.splice(toIndex, 0, item);
    return nextLayout;
}

export function sidebarTabFallbackIcon(
    item: SidebarSystemTabLayoutItem | SidebarFavoriteCollectionTabLayoutItem
): string {
    if (item.type === 'favoriteCollection') {
        return 'lucide:UserStar';
    }
    if (item.systemTab === SYSTEM_TAB_GROUPS) {
        return 'lucide:UsersRound';
    }
    if (item.systemTab === SYSTEM_TAB_FRIENDS) {
        return 'lucide:UserRound';
    }
    return DEFAULT_NAV_ICON_KEY;
}
