import { TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { PageScaffold } from '@/components/layout/PageScaffold';
import { AvatarProviderSettingsDialog } from '@/components/search/AvatarProviderSettingsDialog';
import { cn } from '@/lib/utils';
import {
    Alert,
    AlertAction,
    AlertDescription,
    AlertTitle
} from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';
import { Tabs } from '@/ui/shadcn/tabs';

import { SearchControlBand } from './components/SearchControlBand';
import { SearchEmptyState } from './components/SearchResultParts';
import {
    SearchAvatarTabPanel,
    SearchGroupTabPanel,
    SearchUserTabPanel,
    SearchWorldTabPanel
} from './components/SearchTabPanels';
import { useSearchPageController } from './useSearchPageController';

export function SearchPage({ embedded = false }: { embedded?: boolean } = {}) {
    const { t } = useTranslation();
    const { config, filters, results } = useSearchPageController();
    const searchedByTab: Record<string, boolean> = {
        user: results.hasUserSearched,
        world: results.hasWorldSearched,
        avatar: results.hasAvatarSearched,
        group: results.hasGroupSearched
    };
    const isLanding = !searchedByTab[filters.activeTab];
    const avatarProviderConfigured =
        config.avatarProviderEnabled && config.activeAvatarProviders.length > 0;
    const avatarSearchDisabled =
        filters.activeTab === 'avatar' &&
        !config.avatarProviderEnabled &&
        config.activeAvatarProviders.length > 0;
    const needsAvatarProvider =
        filters.activeTab === 'avatar' &&
        !avatarProviderConfigured &&
        !avatarSearchDisabled;

    return (
        <PageScaffold embedded={embedded} className="flex-1">
            <Tabs
                value={filters.activeTab}
                onValueChange={filters.setActiveTab}
                className="flex min-h-0 flex-1 flex-col"
            >
                <div
                    className={cn(
                        'flex min-h-0 flex-1 flex-col',
                        isLanding && 'justify-center'
                    )}
                >
                    <SearchControlBand
                        activeTab={filters.activeTab}
                        searchText={filters.searchText}
                        onSearchTextChange={filters.setSearchText}
                        onSearch={results.handleSearch}
                        onClearSearch={results.handleClearSearch}
                        viewOptions={{
                            avatarProviderList: config.avatarProviderList,
                            includeCommunityLabs: filters.includeCommunityLabs,
                            disabledAvatarProviders:
                                config.disabledAvatarProviders,
                            onAvatarProviderToggle:
                                config.handleAvatarProviderToggle,
                            onIncludeCommunityLabsChange:
                                filters.setIncludeCommunityLabs,
                            onOpenAvatarProviderSettings: () =>
                                config.setIsAvatarProviderDialogOpen(true),
                            onSearchUserByBioChange: filters.setSearchUserByBio,
                            onSearchUserSortByLastLoggedInChange:
                                filters.setSearchUserSortByLastLoggedIn,
                            onWorldCategoryChange:
                                results.handleWorldCategoryChange,
                            searchUserByBio: filters.searchUserByBio,
                            searchUserSortByLastLoggedIn:
                                filters.searchUserSortByLastLoggedIn,
                            selectedWorldCategory:
                                filters.selectedWorldCategory,
                            worldCategories: config.worldCategories
                        }}
                    />
                    {avatarSearchDisabled ? (
                        <Alert className="mt-3">
                            <TriangleAlertIcon />
                            <AlertTitle>
                                {t('view.search.avatar.search_disabled')}
                            </AlertTitle>
                            <AlertDescription>
                                {t(
                                    'view.search.avatar.search_disabled_description'
                                )}
                            </AlertDescription>
                            <AlertAction>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={config.enableAvatarSearch}
                                >
                                    {t('view.search.avatar.turn_on')}
                                </Button>
                            </AlertAction>
                        </Alert>
                    ) : null}
                    {isLanding && needsAvatarProvider ? (
                        <div className="animate-in fade-in duration-200">
                            <SearchEmptyState
                                kind="avatar"
                                searched={false}
                                avatarProviderConfigured={false}
                                onClear={results.handleClearSearch}
                                onConfigureAvatarProvider={() =>
                                    config.setIsAvatarProviderDialogOpen(true)
                                }
                            />
                        </div>
                    ) : null}
                    {isLanding ? null : (
                        <div className="animate-in fade-in flex min-h-0 flex-1 flex-col duration-200">
                            <SearchUserTabPanel
                                isLoading={results.isUserLoading}
                                results={results.userResults}
                                languageOptionsMap={config.languageOptionsMap}
                                pagination={results.pagination}
                                searched={results.hasUserSearched}
                                onClear={results.handleClearSearch}
                            />
                            <SearchWorldTabPanel
                                isLoading={results.isWorldLoading}
                                results={results.worldResults}
                                pagination={results.pagination}
                                searched={results.hasWorldSearched}
                                onClear={results.handleClearSearch}
                            />
                            <SearchAvatarTabPanel
                                isLoading={results.isAvatarLoading}
                                results={results.avatarPageResults}
                                pagination={results.pagination}
                                searched={results.hasAvatarSearched}
                                avatarProviderConfigured={
                                    avatarProviderConfigured
                                }
                                onClear={results.handleClearSearch}
                                onConfigureAvatarProvider={() =>
                                    config.setIsAvatarProviderDialogOpen(true)
                                }
                            />
                            <SearchGroupTabPanel
                                isLoading={results.isGroupLoading}
                                results={results.groupResults}
                                pagination={results.pagination}
                                searched={results.hasGroupSearched}
                                onClear={results.handleClearSearch}
                            />
                        </div>
                    )}
                </div>
            </Tabs>
            <AvatarProviderSettingsDialog
                open={config.isAvatarProviderDialogOpen}
                onOpenChange={config.setIsAvatarProviderDialogOpen}
                providerList={config.avatarProviderList}
                onConfigSaved={config.applyAvatarProviderConfig}
            />
        </PageScaffold>
    );
}
