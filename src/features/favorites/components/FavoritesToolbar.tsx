import {
    ArrowUpDownIcon,
    DownloadIcon,
    ExternalLinkIcon,
    ListFilterIcon,
    UploadIcon
} from 'lucide-react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import { PageToolbar, PageToolbarRow } from '@/components/layout/PageScaffold';
import {
    ToolbarActions,
    ToolbarOverflowMenu,
    ToolbarRefreshButton,
    ToolbarSearch,
    toolbarSearchScopeTrigger,
    ToolbarViewMenu,
    ToolbarViews
} from '@/components/layout/ToolbarControls';
import type { FavoriteKind } from '@/domain/favorites/types';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Field, FieldContent, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import {
    ToggleGroup,
    ToggleGroupItem,
    ToggleGroupSeparator
} from '@/ui/shadcn/toggle-group';
import { Tooltip } from '@/ui/shadcn/tooltip';

import {
    FAVORITES_DENSITY_OPTIONS,
    type FavoritesDensity
} from '../favoritesDensity';
import {
    normalizeFavoriteSortValue,
    type FavoriteSortValue
} from '../favoritesItems';
import type { FavoriteSearchMode } from '../favoritesTypes';

type FavoritesToolbarProps = {
    kind: FavoriteKind;
    sortValue: FavoriteSortValue;
    searchQuery: string;
    searchPlaceholder: string;
    searchMode: FavoriteSearchMode;
    density: FavoritesDensity;
    refreshing: boolean;
    canEditOrder: boolean;
    orderEditing: boolean;
    onToggleOrderEditing: () => void;
    onSortValueChange: (value: FavoriteSortValue) => void;
    onSearchChange: (value: string) => void;
    onSearchModeChange: (mode: FavoriteSearchMode) => void;
    onDensityChange: (value: FavoritesDensity) => void;
    onRefresh: () => void;
    onImport: () => void;
    onExport: () => void;
    onManageShares?: () => void;
};

function FavoritesToolbar({
    kind,
    sortValue,
    searchQuery,
    searchPlaceholder,
    searchMode,
    density,
    refreshing,
    canEditOrder,
    orderEditing,
    onToggleOrderEditing,
    onSortValueChange,
    onSearchChange,
    onSearchModeChange,
    onDensityChange,
    onRefresh,
    onImport,
    onExport,
    onManageShares
}: FavoritesToolbarProps) {
    const { t } = useTranslation();
    const sortItems: Array<{ value: FavoriteSortValue; label: string }> = [
        { value: 'name', label: t('view.search.avatar.sort_name') },
        { value: 'date', label: t('view.favorite.label.sort_by_date') },
        { value: 'custom', label: t('view.favorite.label.sort_by_custom') }
    ];
    const searchModes: Array<{ value: FavoriteSearchMode; label: string }> = [
        { value: 'name', label: t('view.favorite.worlds.search_mode_name') },
        { value: 'tag', label: t('view.favorite.worlds.search_mode_tag') }
    ];
    if (kind === 'world') {
        sortItems.push({
            value: 'players',
            label: t('view.favorite.label.sort_by_players')
        });
    }

    return (
        <PageToolbar>
            <PageToolbarRow>
                <ToolbarViews>
                    <Select
                        value={sortValue}
                        items={sortItems}
                        onValueChange={(value) =>
                            onSortValueChange(
                                normalizeFavoriteSortValue(kind, value)
                            )
                        }
                    >
                        <SelectTrigger
                            className="max-w-56 min-w-40 shrink-0"
                            disabled={orderEditing}
                        >
                            <span className="flex min-w-0 items-center gap-2">
                                <ArrowUpDownIcon className="text-muted-foreground size-4 shrink-0" />
                                <SelectValue
                                    placeholder={t(
                                        'view.favorite.label.sort_favorites'
                                    )}
                                />
                            </span>
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {sortItems.map((item) => (
                                    <SelectItem
                                        key={item.value}
                                        value={item.value}
                                    >
                                        {item.label}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </ToolbarViews>

                <ToolbarSearch
                    value={searchQuery}
                    onValueChange={onSearchChange}
                    disabled={orderEditing}
                    placeholder={
                        kind === 'world' && searchMode === 'tag'
                            ? t('view.favorite.worlds.search_tags')
                            : searchPlaceholder
                    }
                    trailing={
                        kind === 'world' ? (
                            <DropdownMenu>
                                <Tooltip>
                                    <DropdownMenuTrigger
                                        render={toolbarSearchScopeTrigger({
                                            active: searchMode === 'tag',
                                            icon: ListFilterIcon,
                                            label: t(
                                                'view.favorite.worlds.search_mode'
                                            )
                                        })}
                                    />
                                </Tooltip>
                                <DropdownMenuContent
                                    align="end"
                                    className="w-40"
                                >
                                    <DropdownMenuGroup>
                                        {searchModes.map((mode) => (
                                            <DropdownMenuCheckboxItem
                                                key={mode.value}
                                                checked={
                                                    mode.value === searchMode
                                                }
                                                onCheckedChange={() =>
                                                    onSearchModeChange(
                                                        mode.value
                                                    )
                                                }
                                            >
                                                {mode.label}
                                            </DropdownMenuCheckboxItem>
                                        ))}
                                    </DropdownMenuGroup>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        ) : undefined
                    }
                />

                <ToolbarActions>
                    {canEditOrder || orderEditing ? (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={onToggleOrderEditing}
                        >
                            {orderEditing
                                ? t('view.favorite.order.exit_edit')
                                : t('view.favorite.order.edit')}
                        </Button>
                    ) : null}
                    <ToolbarRefreshButton
                        onRefresh={onRefresh}
                        loading={refreshing}
                    />
                    <ToolbarViewMenu contentClassName="p-3">
                        <FieldGroup
                            onClick={(event) => event.stopPropagation()}
                        >
                            <Field>
                                <FieldContent>
                                    <FieldLabel>
                                        {t('view.friends_locations.density')}
                                    </FieldLabel>
                                </FieldContent>
                                <ToggleGroup
                                    variant="outline"
                                    size="sm"
                                    value={density ? [density] : []}
                                    onValueChange={(nextValue) => {
                                        const option =
                                            FAVORITES_DENSITY_OPTIONS.find(
                                                (candidate) =>
                                                    candidate.value ===
                                                    nextValue[0]
                                            );
                                        if (option) {
                                            onDensityChange(option.value);
                                        }
                                    }}
                                    className="w-full [&>[data-slot=toggle]]:min-w-0 [&>[data-slot=toggle]]:flex-1"
                                >
                                    {FAVORITES_DENSITY_OPTIONS.map(
                                        (option, index) => (
                                            <Fragment key={option.value}>
                                                {index > 0 ? (
                                                    <ToggleGroupSeparator />
                                                ) : null}
                                                <ToggleGroupItem
                                                    value={option.value}
                                                    aria-label={t(
                                                        option.labelKey
                                                    )}
                                                    className="w-full min-w-0 justify-center px-2"
                                                >
                                                    <span className="truncate">
                                                        {t(option.labelKey)}
                                                    </span>
                                                </ToggleGroupItem>
                                            </Fragment>
                                        )
                                    )}
                                </ToggleGroup>
                            </Field>
                        </FieldGroup>
                    </ToolbarViewMenu>
                    <ToolbarOverflowMenu>
                        <DropdownMenuGroup>
                            <DropdownMenuItem onClick={onImport}>
                                <UploadIcon data-icon="inline-start" />
                                {t('view.favorite.import')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={onExport}>
                                <DownloadIcon data-icon="inline-start" />
                                {t('view.favorite.export')}
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                        {kind === 'world' && onManageShares ? (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuGroup>
                                    <DropdownMenuItem onClick={onManageShares}>
                                        <ExternalLinkIcon data-icon="inline-start" />
                                        {t(
                                            'view.favorite.share_collection.action.open_manage'
                                        )}
                                    </DropdownMenuItem>
                                </DropdownMenuGroup>
                            </>
                        ) : null}
                    </ToolbarOverflowMenu>
                </ToolbarActions>
            </PageToolbarRow>
            {orderEditing ? (
                <p className="text-muted-foreground px-1.5 text-xs">
                    {t('view.favorite.order.hint')}
                </p>
            ) : null}
        </PageToolbar>
    );
}

export { FavoritesToolbar };
