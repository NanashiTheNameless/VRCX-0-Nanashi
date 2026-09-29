import { WaypointsIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
    EmptyState as AppEmptyState,
    LoadingState as AppLoadingState
} from '@/components/layout/PageScaffold';
import type { MutualFriendsSnapshotStatus } from '@/lib/mutual-friends/mutualFriendsTypes';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';

import { MutualFriendsSurface } from './MutualFriendsSurface';

export function MutualFriendsLayoutBadge() {
    const { t } = useTranslation();

    return (
        <MutualFriendsSurface className="animate-in fade-in-0 absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 px-3 py-1.5 duration-200 ease-out">
            <Spinner className="size-3.5" />
            <span className="text-muted-foreground text-xs">
                {t('view.charts.mutual_friend.progress.laying_out')}
            </span>
        </MutualFriendsSurface>
    );
}

function StageOverlay({ children }: { children: ReactNode }) {
    return (
        <div className="animate-in fade-in-0 absolute inset-0 z-10 flex items-center justify-center duration-200 ease-out">
            {children}
        </div>
    );
}

export function MutualFriendsStageOverlay({
    baseNodeCount,
    detail,
    hasActiveFilters,
    nodeCount,
    onLoadConnections,
    onClearFilters,
    status
}: {
    baseNodeCount: number;
    detail: string;
    hasActiveFilters: boolean;
    nodeCount: number;
    onLoadConnections: () => void;
    onClearFilters: () => void;
    status: MutualFriendsSnapshotStatus;
}) {
    const { t } = useTranslation();

    if (status === 'running' && !baseNodeCount) {
        return (
            <StageOverlay>
                <AppLoadingState
                    label={t(
                        'view.charts.loading.loading_mutual_graph_snapshot'
                    )}
                />
            </StageOverlay>
        );
    }

    if (status === 'error') {
        return (
            <StageOverlay>
                <AppEmptyState
                    title={t('view.charts.error.mutual_graph_failed_to_load')}
                    description={
                        detail ||
                        t('view.charts.error.mutual_graph_cache_unreadable')
                    }
                    contentClassName="max-w-md"
                />
            </StageOverlay>
        );
    }

    if (!baseNodeCount) {
        return (
            <StageOverlay>
                <AppEmptyState
                    icon={WaypointsIcon}
                    title={t('empty_state.mutual_friends_title')}
                    description={t('empty_state.mutual_friends_description')}
                    contentClassName="max-w-md"
                >
                    <Button
                        type="button"
                        variant="link"
                        onClick={onLoadConnections}
                    >
                        {t('empty_state.load_mutual_friends')}
                    </Button>
                </AppEmptyState>
            </StageOverlay>
        );
    }

    if (!nodeCount) {
        return (
            <StageOverlay>
                <AppEmptyState
                    title={t(
                        'view.charts.empty.no_graph_nodes_match_the_current_search'
                    )}
                    description={t(
                        'view.charts.label.try_a_broader_search_term_or_clear_the_node_filter'
                    )}
                    contentClassName="max-w-md"
                >
                    {hasActiveFilters ? (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onClearFilters}
                        >
                            {t(
                                'view.charts.mutual_friend.actions.clear_filters'
                            )}
                        </Button>
                    ) : null}
                </AppEmptyState>
            </StageOverlay>
        );
    }

    return null;
}
