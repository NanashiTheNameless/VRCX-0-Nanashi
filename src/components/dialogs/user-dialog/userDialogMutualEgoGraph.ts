import { assignMutualFriendCommunities } from '@/lib/mutual-friends/mutualFriendsCommunities';
import {
    mutualFriendsCommunityPalette,
    mutualFriendsNeutralCommunityColor
} from '@/lib/mutual-friends/mutualFriendsPalette';
import type {
    MutualFriendCommunityAssignment,
    MutualFriendGraph,
    MutualFriendLink,
    MutualFriendNode
} from '@/lib/mutual-friends/mutualFriendsTypes';

type EgoGraphNode = { id: string; label: string };

const EGO_COMMUNITY_OPTIONS = {
    resolution: 0.6,
    namedLimit: 3,
    minNamedSize: 3
};

export function buildUserMutualEgoGraph({
    center,
    friends,
    links,
    nodeById
}: {
    center: EgoGraphNode;
    friends: readonly EgoGraphNode[];
    links: readonly MutualFriendLink[];
    nodeById: ReadonlyMap<string, MutualFriendNode>;
}): MutualFriendGraph {
    const friendIds = new Set(friends.map((friend) => friend.id));
    const friendLinks = links.filter(
        (link) => friendIds.has(link.source) && friendIds.has(link.target)
    );
    const degreeById = new Map<string, number>();
    for (const link of friendLinks) {
        degreeById.set(link.source, (degreeById.get(link.source) ?? 0) + 1);
        degreeById.set(link.target, (degreeById.get(link.target) ?? 0) + 1);
    }

    return {
        nodes: [
            {
                id: center.id,
                label: center.label,
                lastFetchedAt: '',
                optedOut: false,
                degree: friends.length,
                mutualCount: friends.length
            },
            ...friends.map((friend) => {
                const node = nodeById.get(friend.id);
                return {
                    id: friend.id,
                    label: friend.label,
                    lastFetchedAt: node?.lastFetchedAt ?? null,
                    optedOut: node?.optedOut ?? false,
                    degree: (degreeById.get(friend.id) ?? 0) + 1,
                    mutualCount: node?.mutualCount ?? 0
                };
            })
        ],
        links: [
            ...friends.map((friend) => ({
                source: center.id,
                target: friend.id
            })),
            ...friendLinks
        ]
    };
}

export function assignUserMutualEgoCommunities(
    egoGraph: MutualFriendGraph,
    centerId: string,
    isDarkMode: boolean
): MutualFriendCommunityAssignment {
    return assignMutualFriendCommunities(
        {
            nodes: egoGraph.nodes.filter((node) => node.id !== centerId),
            links: egoGraph.links.filter(
                (link) => link.source !== centerId && link.target !== centerId
            )
        },
        mutualFriendsCommunityPalette(isDarkMode),
        mutualFriendsNeutralCommunityColor(isDarkMode),
        EGO_COMMUNITY_OPTIONS
    );
}
