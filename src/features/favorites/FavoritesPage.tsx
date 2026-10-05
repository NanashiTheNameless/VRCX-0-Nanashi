import { PageScaffold } from '@/components/layout/PageScaffold';
import type { FavoriteKind } from '@/domain/favorites/types';
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup
} from '@/ui/shadcn/resizable';

import { FavoriteExportDialog } from './components/FavoriteExportDialog';
import {
    FavoritesContentPanel,
    FavoritesGroupRailPanel
} from './components/FavoritesPanels';
import { FavoritesToolbar } from './components/FavoritesToolbar';
import { useFavoritesPageController } from './useFavoritesPageController';
import { useStableEvent } from './useStableEvent';

function FavoritesPage({
    kind,
    embedded = false
}: {
    kind: FavoriteKind;
    embedded?: boolean;
}) {
    const state = useFavoritesPageController({ kind });
    const {
        actions,
        collections,
        creatingLocalGroup,
        exportDialogOpen,
        filters,
        layout,
        newLocalGroupName,
        order,
        selection,
        setCreatingLocalGroup,
        setExportDialogOpen,
        setNewLocalGroupName,
        setVisibleWorldIds,
        viewData,
        instanceActionGatesByItemKey
    } = state;
    const handleToggleOrderEditing = useStableEvent(() =>
        order.editing ? order.stop() : order.start()
    );
    const handleGroupRailRefresh = useStableEvent(() =>
        actions.refreshFavorites()
    );
    const handleImportFavorites = useStableEvent(() =>
        actions.importFavorites()
    );
    const handleExportFavorites = useStableEvent(() =>
        actions.exportCurrentFavorites()
    );
    const handleSplitterResize = useStableEvent(layout.handleSplitterResize);
    const handleSplitterLayout = useStableEvent(layout.persistSplitterLayout);

    return (
        <PageScaffold embedded={embedded} flushBottom className="flex-1">
            <FavoritesToolbar
                kind={kind}
                sortValue={layout.sortValue}
                searchQuery={filters.searchQuery}
                searchPlaceholder={viewData.pageConfig.searchPlaceholder}
                searchMode={filters.searchMode}
                density={layout.density}
                refreshing={
                    actions.refreshing ||
                    collections.favoriteLoadStatus === 'running'
                }
                canEditOrder={order.canEdit}
                orderEditing={order.editing}
                onToggleOrderEditing={handleToggleOrderEditing}
                onSortValueChange={layout.handleSortValueChange}
                onSearchChange={filters.setSearchQuery}
                onSearchModeChange={filters.setSearchMode}
                onDensityChange={layout.handleDensityChange}
                onRefresh={handleGroupRailRefresh}
                onImport={handleImportFavorites}
                onExport={handleExportFavorites}
            />
            <FavoriteExportDialog
                open={exportDialogOpen}
                onOpenChange={setExportDialogOpen}
                kind={kind}
                remoteGroups={viewData.remoteGroups}
                localGroups={viewData.localGroups}
                remoteItemsByGroup={viewData.remoteItemsByGroup}
                localItemsByGroup={viewData.localItemsByGroup}
                remoteDetailsStatus={collections.remoteEntityDetails.status}
            />

            <div className="flex h-full min-h-0 min-w-0 flex-1">
                <ResizablePanelGroup
                    key={`${kind}:${layout.splitterLayoutVersion}`}
                    id={`favorites-${kind}-splitter`}
                    orientation="horizontal"
                    className="h-full min-h-0 min-w-0 flex-1"
                    onLayoutChanged={handleSplitterLayout}
                >
                    <ResizablePanel
                        id={`favorites-${kind}-groups`}
                        defaultSize={layout.splitterSizePx}
                        minSize={0}
                        className="min-w-0"
                        collapsible
                        collapsedSize={0}
                        groupResizeBehavior="preserve-pixel-size"
                        onResize={handleSplitterResize}
                    >
                        <FavoritesGroupRailPanel
                            kind={kind}
                            favoriteCommands={actions}
                            collections={collections}
                            creatingLocalGroup={creatingLocalGroup}
                            filters={filters}
                            newLocalGroupName={newLocalGroupName}
                            onNewGroupNameChange={setNewLocalGroupName}
                            setCreatingLocalGroup={setCreatingLocalGroup}
                            viewData={viewData}
                        />
                    </ResizablePanel>
                    <ResizableHandle withHandle />
                    <ResizablePanel
                        id={`favorites-${kind}-content`}
                        minSize={320}
                        className="min-w-0"
                    >
                        <FavoritesContentPanel
                            kind={kind}
                            favoriteCommands={actions}
                            collections={collections}
                            filters={filters}
                            layout={layout}
                            order={order}
                            selection={selection}
                            viewData={viewData}
                            instanceActionGatesByItemKey={
                                instanceActionGatesByItemKey
                            }
                            onVisibleWorldIdsChange={setVisibleWorldIds}
                        />
                    </ResizablePanel>
                </ResizablePanelGroup>
            </div>
        </PageScaffold>
    );
}

type FavoriteRoutePageProps = {
    embedded?: boolean;
};

export function FavoriteFriendsPage(props: FavoriteRoutePageProps) {
    return <FavoritesPage kind="friend" {...props} />;
}

export function FavoriteWorldsPage(props: FavoriteRoutePageProps) {
    return <FavoritesPage kind="world" {...props} />;
}

export function FavoriteAvatarsPage(props: FavoriteRoutePageProps) {
    return <FavoritesPage kind="avatar" {...props} />;
}
