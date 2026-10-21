import { LayoutGridIcon, ListIcon } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import type { AppTable } from '@/components/data-table/appTable';
import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu';
import { useHasLicensedAvatars } from '@/components/economy/useHasLicensedAvatars';
import { PageToolbar, PageToolbarRow } from '@/components/layout/PageScaffold';
import {
    ToolbarActions,
    ToolbarRefreshButton,
    ToolbarSearch,
    ToolbarSegmented,
    ToolbarViews,
    type ToolbarSegmentOption
} from '@/components/layout/ToolbarControls';
import { useRuntimeStore } from '@/state/runtimeStore';

import type {
    MyAvatarsGridDensity,
    MyAvatarsLoadStatus,
    MyAvatarRow,
    MyAvatarsPlatformFilter,
    MyAvatarsReleaseStatusFilter,
    MyAvatarsSource,
    MyAvatarsViewMode
} from '../myAvatarsTypes';
import { LocalTestAvatarsButton } from './LocalTestAvatarsDialog';
import { GridSettingsMenu, MyAvatarFilterPopover } from './MyAvatarsViewParts';

type MyAvatarsToolbarProps = {
    source: MyAvatarsSource;
    onSourceChange: (value: MyAvatarsSource) => void;
    viewMode: MyAvatarsViewMode;
    activeFilterCount: number;
    allTags: string[];
    releaseStatusFilter: MyAvatarsReleaseStatusFilter;
    platformFilter: MyAvatarsPlatformFilter;
    tagFilters: Set<string>;
    loadStatus: MyAvatarsLoadStatus;
    searchQuery: string;
    gridDensity: MyAvatarsGridDensity;
    table: AppTable<MyAvatarRow>;
    onViewModeChange: (value: MyAvatarsViewMode) => void;
    onReleaseStatusChange: (value: MyAvatarsReleaseStatusFilter) => void;
    onPlatformChange: (value: MyAvatarsPlatformFilter) => void;
    onTagFiltersChange: Dispatch<SetStateAction<Set<string>>>;
    onClearFilters: () => void;
    onSearchChange: (value: string) => void;
    onGridDensityChange: (value: MyAvatarsGridDensity) => void;
    onRefresh: () => void;
};

export function MyAvatarsToolbar({
    source,
    onSourceChange,
    viewMode,
    activeFilterCount,
    allTags,
    releaseStatusFilter,
    platformFilter,
    tagFilters,
    loadStatus,
    searchQuery,
    gridDensity,
    table,
    onViewModeChange,
    onReleaseStatusChange,
    onPlatformChange,
    onTagFiltersChange,
    onClearFilters,
    onSearchChange,
    onGridDensityChange,
    onRefresh
}: MyAvatarsToolbarProps) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const viewModeOptions: ToolbarSegmentOption<MyAvatarsViewMode>[] = [
        {
            value: 'grid',
            label: t('view.my_avatars.action.show_avatar_grid'),
            icon: LayoutGridIcon
        },
        {
            value: 'table',
            label: t('view.my_avatars.action.show_avatar_table'),
            icon: ListIcon
        }
    ];

    const hasLicensedAvatars = useHasLicensedAvatars(true);
    const sourceOptions: ToolbarSegmentOption<MyAvatarsSource>[] = [
        { value: 'own', label: t('view.my_avatars.source.own') },
        { value: 'licensed', label: t('view.my_avatars.source.licensed') }
    ];

    return (
        <PageToolbar>
            <PageToolbarRow>
                <ToolbarViews>
                    {hasLicensedAvatars || source === 'licensed' ? (
                        <ToolbarSegmented
                            value={source}
                            onValueChange={onSourceChange}
                            options={sourceOptions}
                        />
                    ) : null}
                    <ToolbarSegmented
                        iconOnly
                        value={viewMode}
                        onValueChange={onViewModeChange}
                        options={viewModeOptions}
                    />
                    <MyAvatarFilterPopover
                        activeFilterCount={activeFilterCount}
                        allTags={allTags}
                        releaseStatusFilter={releaseStatusFilter}
                        platformFilter={platformFilter}
                        tagFilters={tagFilters}
                        onReleaseStatusChange={onReleaseStatusChange}
                        onPlatformChange={onPlatformChange}
                        onTagFiltersChange={onTagFiltersChange}
                        onClearFilters={onClearFilters}
                    />
                </ToolbarViews>

                <ToolbarSearch
                    value={searchQuery}
                    onValueChange={onSearchChange}
                />

                <ToolbarActions>
                    <ToolbarRefreshButton
                        onRefresh={onRefresh}
                        loading={loadStatus === 'running'}
                        disabled={!currentUserId}
                        label={t(
                            'view.my_avatars.action.refresh_avatar_inventory'
                        )}
                    />
                    <LocalTestAvatarsButton />
                    {viewMode === 'grid' ? (
                        <GridSettingsMenu
                            gridDensity={gridDensity}
                            onGridDensityChange={onGridDensityChange}
                        />
                    ) : null}
                    {viewMode === 'table' ? (
                        <TableColumnVisibilityMenu table={table} />
                    ) : null}
                </ToolbarActions>
            </PageToolbarRow>
        </PageToolbar>
    );
}
