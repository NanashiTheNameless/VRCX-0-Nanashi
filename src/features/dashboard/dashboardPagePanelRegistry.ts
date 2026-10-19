import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

type DashboardEmbeddedPage = ComponentType<{ embedded?: boolean }>;
function lazyDashboardPage<ExportName extends string>(
    importPage: () => Promise<Record<ExportName, DashboardEmbeddedPage>>,
    exportName: ExportName
): LazyExoticComponent<DashboardEmbeddedPage> {
    return lazy(() =>
        importPage().then((module) => ({
            default: module[exportName]
        }))
    );
}

const feedPage = lazyDashboardPage(
    () => import('@/features/feed/FeedPage'),
    'FeedPage'
);
const friendsLocationsPage = lazyDashboardPage(
    () => import('@/features/friends/FriendsLocationsPage'),
    'FriendsLocationsPage'
);
const gameLogPage = lazyDashboardPage(
    () => import('@/features/game-log/GameLogPage'),
    'GameLogPage'
);
const playerListPage = lazyDashboardPage(
    () => import('@/features/player-list/PlayerListPage'),
    'PlayerListPage'
);
const searchPage = lazyDashboardPage(
    () => import('@/features/search/SearchPage'),
    'SearchPage'
);
const favoriteFriendsPage = lazyDashboardPage(
    () => import('@/features/favorites/FavoritesPage'),
    'FavoriteFriendsPage'
);
const favoriteWorldsPage = lazyDashboardPage(
    () => import('@/features/favorites/FavoritesPage'),
    'FavoriteWorldsPage'
);
const favoriteAvatarsPage = lazyDashboardPage(
    () => import('@/features/favorites/FavoritesPage'),
    'FavoriteAvatarsPage'
);
const friendLogPage = lazyDashboardPage(
    () => import('@/features/friends/FriendLogPage'),
    'FriendLogPage'
);
const friendListPage = lazyDashboardPage(
    () => import('@/features/friends/FriendListPage'),
    'FriendListPage'
);
const moderationPage = lazyDashboardPage(
    () => import('@/features/moderation/ModerationPage'),
    'ModerationPage'
);
const notificationPage = lazyDashboardPage(
    () => import('@/features/notifications/VrcNotificationPage'),
    'VrcNotificationPage'
);
const myAvatarsPage = lazyDashboardPage(
    () => import('@/features/my-avatars/MyAvatarsPage'),
    'MyAvatarsPage'
);
const vrchatLogPage = lazyDashboardPage(
    () => import('@/features/tools/VrchatLogPage'),
    'VrchatLogPage'
);
const toolsPage = lazyDashboardPage(
    () => import('@/features/tools/ToolsPage'),
    'ToolsPage'
);

const dashboardPagePanelComponentMap: Record<
    string,
    LazyExoticComponent<DashboardEmbeddedPage>
> = {
    feed: feedPage,
    'friends-locations': friendsLocationsPage,
    'game-log': gameLogPage,
    'player-list': playerListPage,
    search: searchPage,
    'favorite-friends': favoriteFriendsPage,
    'favorite-worlds': favoriteWorldsPage,
    'favorite-avatars': favoriteAvatarsPage,
    'social/friend-log': friendLogPage,
    'social/friend-list': friendListPage,
    'social/moderation': moderationPage,
    notification: notificationPage,
    'my-avatars': myAvatarsPage,
    'friend-log': friendLogPage,
    'friend-list': friendListPage,
    moderation: moderationPage,
    'vrchat-log': vrchatLogPage,
    tools: toolsPage
};

export function getDashboardPagePanelComponent(key: string | null) {
    const normalizedKey = (key ?? '').trim();
    return normalizedKey
        ? (dashboardPagePanelComponentMap[normalizedKey] ?? null)
        : null;
}

export function canEmbedDashboardPagePanel(key: string | null) {
    return Boolean(getDashboardPagePanelComponent(key));
}
