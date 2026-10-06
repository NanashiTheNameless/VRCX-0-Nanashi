import { PageScaffold } from '@/components/layout/PageScaffold';
import { Tabs, TabsContent } from '@/ui/shadcn/tabs';

import { FriendsLocationsToolbar } from './components/FriendsLocationsToolbar';
import { FriendsLocationsVirtualList } from './components/FriendsLocationsVirtualList';
import { isFriendsLocationsSegment } from './friendsLocationsConfig';
import { useFriendsLocationsPageController } from './useFriendsLocationsPageController';

export function FriendsLocationsPage({
    embedded = false
}: {
    embedded?: boolean;
} = {}) {
    const { actions, derived, filters, load, preferences, runtime, scroll } =
        useFriendsLocationsPageController();

    return (
        <PageScaffold
            embedded={embedded}
            flushBottom={!embedded}
            className="friend-view flex-1"
        >
            <Tabs
                value={filters.activeSegment}
                onValueChange={(value) => {
                    if (isFriendsLocationsSegment(value)) {
                        filters.setActiveSegment(value);
                    }
                }}
                className="flex min-h-0 flex-1 flex-col gap-0"
            >
                <FriendsLocationsToolbar
                    segmentOptions={derived.segmentOptions}
                    searchQuery={filters.searchQuery}
                    showSameInstanceInOnline={
                        preferences.showSameInstanceInOnline
                    }
                    showFavoritesInOnline={preferences.showFavoritesInOnline}
                    density={preferences.density}
                    viewMode={preferences.viewMode}
                    onSearchQueryChange={filters.setSearchQuery}
                    onShowSameInstanceInOnlineChange={
                        preferences.changeShowSameInstanceInOnline
                    }
                    onShowFavoritesInOnlineChange={
                        preferences.changeShowFavoritesInOnline
                    }
                    onDensityChange={preferences.changeDensityPreference}
                    onViewModeChange={preferences.changeViewMode}
                />
                <TabsContent
                    value={filters.activeSegment}
                    className="flex min-h-0 flex-1 flex-col"
                >
                    {preferences.preferencesReady ? (
                        <FriendsLocationsVirtualList
                            derived={derived}
                            filters={filters}
                            load={load}
                            locationCommands={actions}
                            runtime={runtime}
                            scroll={scroll}
                        />
                    ) : null}
                </TabsContent>
            </Tabs>
        </PageScaffold>
    );
}
