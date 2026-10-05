import { CheckCheckIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { PageToolbar, PageToolbarRow } from '@/components/layout/PageScaffold';
import {
    ToolbarActions,
    ToolbarIconButton,
    ToolbarRefreshButton,
    ToolbarSearch,
    ToolbarTabs,
    ToolbarViews,
    type ToolbarSegmentOption
} from '@/components/layout/ToolbarControls';
import { Button } from '@/ui/shadcn/button';

import type { NotificationLoadStatus } from '../notificationPageTypes';
import type { NotificationQuickFilter } from '../useNotificationFilters';
import { NotificationTypeFilterDropdown } from './NotificationViewParts';

const QUICK_FILTERS: { value: NotificationQuickFilter; labelKey: string }[] = [
    { value: 'all', labelKey: 'view.notification.feed.all' },
    {
        value: 'action',
        labelKey: 'side_panel.notification_center.group_action'
    },
    { value: 'unread', labelKey: 'view.notification.feed.unread' }
];

type NotificationPageToolbarProps = {
    activeTypes: string[];
    loadStatus: NotificationLoadStatus;
    notificationTypeLabel: (type: string) => string;
    onActiveTypesChange: (types: string[]) => void;
    onClearFilters: () => void;
    onMarkAllSeen: () => void;
    onRefresh: () => void;
    onSearchQueryChange: (value: string) => void;
    quickFilter: NotificationQuickFilter;
    searchQuery: string;
    canMarkAllSeen: boolean;
};

export function NotificationPageToolbar({
    activeTypes,
    searchQuery,
    notificationTypeLabel,
    loadStatus,
    quickFilter,
    canMarkAllSeen,
    onActiveTypesChange,
    onSearchQueryChange,
    onMarkAllSeen,
    onRefresh,
    onClearFilters
}: NotificationPageToolbarProps) {
    const { t } = useTranslation();
    const quickFilterOptions: ToolbarSegmentOption<NotificationQuickFilter>[] =
        QUICK_FILTERS.map((entry) => ({
            value: entry.value,
            label: t(entry.labelKey)
        }));
    const hasActiveFilters =
        activeTypes.length > 0 ||
        quickFilter !== 'all' ||
        Boolean(searchQuery.trim());

    return (
        <PageToolbar>
            <PageToolbarRow>
                <ToolbarViews>
                    <ToolbarTabs options={quickFilterOptions} />
                    <NotificationTypeFilterDropdown
                        value={activeTypes}
                        onChange={onActiveTypesChange}
                        getTypeLabel={notificationTypeLabel}
                    />
                    {hasActiveFilters ? (
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={onClearFilters}
                        >
                            {t('common.actions.clear')}
                        </Button>
                    ) : null}
                </ToolbarViews>

                <ToolbarSearch
                    value={searchQuery}
                    onValueChange={onSearchQueryChange}
                />

                <ToolbarActions>
                    <ToolbarRefreshButton
                        onRefresh={onRefresh}
                        loading={loadStatus === 'running'}
                        label={t('view.notification.refresh_tooltip')}
                    />
                    <ToolbarIconButton
                        icon={CheckCheckIcon}
                        label={t(
                            'side_panel.notification_center.mark_all_read'
                        )}
                        disabled={!canMarkAllSeen}
                        onClick={onMarkAllSeen}
                    />
                </ToolbarActions>
            </PageToolbarRow>
        </PageToolbar>
    );
}
