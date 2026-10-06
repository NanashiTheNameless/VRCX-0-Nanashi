import { GlobeIcon, LayoutGridIcon } from 'lucide-react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import { PageToolbar, PageToolbarRow } from '@/components/layout/PageScaffold';
import {
    ToolbarActions,
    ToolbarSearch,
    ToolbarSegmented,
    ToolbarTabs,
    ToolbarViewMenu,
    ToolbarViews,
    type ToolbarSegmentOption
} from '@/components/layout/ToolbarControls';
import { Field, FieldContent, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Switch } from '@/ui/shadcn/switch';
import {
    ToggleGroup,
    ToggleGroupItem,
    ToggleGroupSeparator
} from '@/ui/shadcn/toggle-group';

import { type FriendsLocationsSegment } from '../friendsLocationsConfig';
import {
    FRIENDS_LOCATIONS_DENSITY_OPTIONS,
    sanitizeFriendsLocationsDensity,
    type FriendsLocationsDensity
} from '../friendsLocationsDensity';
import type { FriendsLocationsViewMode } from '../friendsLocationsWorlds';

type FriendsLocationsSegmentOption = {
    value: FriendsLocationsSegment;
    labelKey: string;
    count: number;
};

type FriendsLocationsToolbarProps = {
    segmentOptions: FriendsLocationsSegmentOption[];
    searchQuery: string;
    showSameInstanceInOnline: boolean;
    showFavoritesInOnline: boolean;
    density: FriendsLocationsDensity;
    viewMode: FriendsLocationsViewMode;
    onSearchQueryChange: (value: string) => void;
    onShowSameInstanceInOnlineChange: (value: boolean) => void;
    onShowFavoritesInOnlineChange: (value: boolean) => void;
    onDensityChange: (value: FriendsLocationsDensity) => void;
    onViewModeChange: (value: FriendsLocationsViewMode) => void;
};

export function FriendsLocationsToolbar({
    segmentOptions,
    searchQuery,
    showSameInstanceInOnline,
    showFavoritesInOnline,
    density,
    viewMode,
    onSearchQueryChange,
    onShowSameInstanceInOnlineChange,
    onShowFavoritesInOnlineChange,
    onDensityChange,
    onViewModeChange
}: FriendsLocationsToolbarProps) {
    const { t } = useTranslation();
    const options: ToolbarSegmentOption<FriendsLocationsSegment>[] =
        segmentOptions.map((segment) => ({
            value: segment.value,
            label: t(segment.labelKey),
            count: segment.count
        }));

    return (
        <PageToolbar>
            <PageToolbarRow>
                <ToolbarViews className="min-h-9.5 sm:min-h-8.5">
                    <ToolbarSegmented
                        iconOnly
                        value={viewMode}
                        onValueChange={onViewModeChange}
                        options={[
                            {
                                value: 'people',
                                label: t('view.friends_locations.view_people'),
                                icon: LayoutGridIcon
                            },
                            {
                                value: 'worlds',
                                label: t('view.friends_locations.view_worlds'),
                                icon: GlobeIcon
                            }
                        ]}
                    />
                    {viewMode === 'worlds' ? null : (
                        <ToolbarTabs options={options} />
                    )}
                </ToolbarViews>

                <ToolbarSearch
                    value={searchQuery}
                    onValueChange={onSearchQueryChange}
                    placeholder={t('view.friends_locations.search_placeholder')}
                />

                <ToolbarActions>
                    <ToolbarViewMenu contentClassName="p-3">
                        <FieldGroup
                            onClick={(event) => event.stopPropagation()}
                        >
                            <Field orientation="horizontal">
                                <FieldContent>
                                    <FieldLabel htmlFor="friends-locations-same-instance">
                                        {t(
                                            'view.friends_locations.show_same_instance_in_online'
                                        )}
                                    </FieldLabel>
                                </FieldContent>
                                <Switch
                                    id="friends-locations-same-instance"
                                    checked={showSameInstanceInOnline}
                                    onCheckedChange={
                                        onShowSameInstanceInOnlineChange
                                    }
                                />
                            </Field>
                            <Field orientation="horizontal">
                                <FieldContent>
                                    <FieldLabel htmlFor="friends-locations-favorites">
                                        {t(
                                            'view.friends_locations.show_favorites_in_online'
                                        )}
                                    </FieldLabel>
                                </FieldContent>
                                <Switch
                                    id="friends-locations-favorites"
                                    checked={showFavoritesInOnline}
                                    onCheckedChange={
                                        onShowFavoritesInOnlineChange
                                    }
                                />
                            </Field>
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
                                        if (nextValue[0]) {
                                            onDensityChange(
                                                sanitizeFriendsLocationsDensity(
                                                    nextValue[0]
                                                )
                                            );
                                        }
                                    }}
                                    className="w-full [&>[data-slot=toggle]]:min-w-0 [&>[data-slot=toggle]]:flex-1"
                                >
                                    {FRIENDS_LOCATIONS_DENSITY_OPTIONS.map(
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
                </ToolbarActions>
            </PageToolbarRow>
        </PageToolbar>
    );
}
