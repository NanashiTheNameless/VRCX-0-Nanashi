import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import mutualGraphPersistenceRepository from '@/repositories/mutualGraphPersistenceRepository';
import { useResolvedThemeMode } from '@/services/themeService';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useMutualGraphRevisionStore } from '@/state/mutualGraphRevisionStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { assignMutualFriendCommunities } from './mutualFriendsCommunities';
import {
    buildMutualFriendsBaseGraph,
    buildMutualFriendsCoverage
} from './mutualFriendsGraphData';
import {
    mutualFriendsCommunityPalette,
    mutualFriendsNeutralCommunityColor
} from './mutualFriendsPalette';
import { readExcludedMutualFriendIds } from './mutualFriendsSettings';
import type {
    MutualFriendCommunity,
    MutualFriendLink,
    MutualFriendSnapshot
} from './mutualFriendsTypes';
import { useMutualFriendLabels } from './useMutualFriendLabels';

const EMPTY_COMMUNITY_INDEX: ReadonlyMap<string, number> = new Map();
const EMPTY_COMMUNITIES: readonly MutualFriendCommunity[] = [];
const EMPTY_LINKS: readonly MutualFriendLink[] = [];
const EMPTY_SNAPSHOT: MutualFriendSnapshot = new Map();

export function useMutualFriendGraphContext(
    enabled: boolean,
    { withCommunities = false }: { withCommunities?: boolean } = {}
) {
    const currentUserId =
        useRuntimeStore((state) => state.auth.currentUserId) || '';
    const revision = useMutualGraphRevisionStore((state) =>
        state.ownerUserId === currentUserId ? state.revision : 0
    );
    const completedRunId = useRuntimeStore((state) =>
        state.mutualGraph.status === 'completed' ? state.mutualGraph.runId : 0
    );
    const isGraphFetching = useRuntimeStore(
        (state) =>
            (!state.mutualGraph.ownerUserId ||
                state.mutualGraph.ownerUserId === currentUserId) &&
            (state.mutualGraph.status === 'running' ||
                state.mutualGraph.status === 'cancelling')
    );
    const friendLabelsById = useMutualFriendLabels();
    const orderedFriendIds = useFriendRosterStore(
        (state) => state.orderedFriendIds
    );
    const isDarkMode = useResolvedThemeMode() === 'dark';
    const [excludedFriendIds] = useState(readExcludedMutualFriendIds);
    const snapshotQuery = useQuery({
        queryKey: [
            'mutual-graph-snapshot',
            currentUserId,
            revision,
            completedRunId
        ],
        enabled: enabled && Boolean(currentUserId),
        retry: false,
        staleTime: Infinity,
        gcTime: 0,
        refetchOnWindowFocus: false,
        queryFn: () =>
            mutualGraphPersistenceRepository.getSnapshot(currentUserId)
    });
    const snapshotData = snapshotQuery.data;

    const baseGraph = useMemo(
        () =>
            snapshotData
                ? buildMutualFriendsBaseGraph(
                      snapshotData.snapshot,
                      snapshotData.meta,
                      friendLabelsById,
                      excludedFriendIds
                  )
                : null,
        [excludedFriendIds, friendLabelsById, snapshotData]
    );
    const assignment = useMemo(
        () =>
            baseGraph && withCommunities
                ? assignMutualFriendCommunities(
                      baseGraph,
                      mutualFriendsCommunityPalette(isDarkMode),
                      mutualFriendsNeutralCommunityColor(isDarkMode)
                  )
                : null,
        [baseGraph, isDarkMode, withCommunities]
    );
    const nodeById = useMemo(
        () => new Map(baseGraph?.nodes.map((node) => [node.id, node])),
        [baseGraph]
    );
    const needsGraphBuild = useMemo(() => {
        if (!snapshotData) {
            return false;
        }
        const coverage = buildMutualFriendsCoverage(
            snapshotData.meta,
            orderedFriendIds
        );
        return (
            coverage.friendCount > 0 &&
            coverage.fetchedCount * 2 < coverage.friendCount
        );
    }, [orderedFriendIds, snapshotData]);

    return {
        communities: assignment?.communities ?? EMPTY_COMMUNITIES,
        communityIndexById:
            assignment?.communityIndexById ?? EMPTY_COMMUNITY_INDEX,
        isGraphFetching,
        links: baseGraph?.links ?? EMPTY_LINKS,
        needsGraphBuild: needsGraphBuild && !isGraphFetching,
        nodeById,
        snapshot: snapshotData?.snapshot ?? EMPTY_SNAPSHOT
    };
}
