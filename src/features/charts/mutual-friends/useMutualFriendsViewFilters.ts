import { useCallback, useState } from 'react';

import {
    MUTUAL_GRAPH_DEFAULT_VIEW_FILTERS,
    MUTUAL_GRAPH_MIN_DEGREE_LIMITS
} from '@/lib/mutual-friends/mutualFriendsFilters';
import { clampMutualGraphNumber } from '@/lib/mutual-friends/mutualFriendsSettings';
import type { MutualFriendsViewFilters } from '@/lib/mutual-friends/mutualFriendsTypes';

export function useMutualFriendsViewFilters() {
    const [filters, setFilters] = useState<MutualFriendsViewFilters>(
        MUTUAL_GRAPH_DEFAULT_VIEW_FILTERS
    );
    const [crossCommunityOnly, setCrossCommunityOnly] = useState(false);

    const setSearchQuery = useCallback((searchQuery: string) => {
        setFilters((current) => ({ ...current, searchQuery }));
    }, []);

    const setMinDegree = useCallback((minDegree: number) => {
        setFilters((current) => ({
            ...current,
            minDegree: clampMutualGraphNumber(
                minDegree,
                MUTUAL_GRAPH_MIN_DEGREE_LIMITS.min,
                MUTUAL_GRAPH_MIN_DEGREE_LIMITS.max,
                MUTUAL_GRAPH_DEFAULT_VIEW_FILTERS.minDegree
            )
        }));
    }, []);

    const toggleFocusedCommunity = useCallback((communityIndex: number) => {
        setFilters((current) => ({
            ...current,
            focusedCommunity:
                current.focusedCommunity === communityIndex
                    ? null
                    : communityIndex
        }));
    }, []);

    const toggleCrossCommunityOnly = useCallback(() => {
        setCrossCommunityOnly((current) => !current);
    }, []);

    const clearFilters = useCallback(() => {
        setFilters(MUTUAL_GRAPH_DEFAULT_VIEW_FILTERS);
        setCrossCommunityOnly(false);
    }, []);

    return {
        filters,
        crossCommunityOnly,
        setSearchQuery,
        setMinDegree,
        toggleFocusedCommunity,
        toggleCrossCommunityOnly,
        clearFilters
    };
}
