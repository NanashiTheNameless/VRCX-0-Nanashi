import { describe, expect, it } from 'vitest';

import { assignMutualFriendCommunities } from './mutualFriendsCommunities';
import type { MutualFriendGraph } from './mutualFriendsTypes';

const PALETTE = ['#a', '#b', '#c', '#d', '#e', '#f'];

function ringOfTriangles(count: number): MutualFriendGraph {
    const nodes = [];
    const links = [];
    for (let group = 0; group < count; group += 1) {
        const ids = [0, 1, 2].map((member) => `usr_${group}_${member}`);
        for (const id of ids) {
            nodes.push({
                id,
                label: id,
                lastFetchedAt: null,
                optedOut: false,
                degree: 0,
                mutualCount: 0
            });
        }
        links.push(
            { source: ids[0], target: ids[1] },
            { source: ids[1], target: ids[2] },
            { source: ids[0], target: ids[2] },
            { source: ids[2], target: `usr_${(group + 1) % count}_0` }
        );
    }
    return { nodes, links };
}

describe('assignMutualFriendCommunities', () => {
    it('finds each tight friend group as its own coloured circle by default', () => {
        const { communities } = assignMutualFriendCommunities(
            ringOfTriangles(4),
            PALETTE,
            '#neutral'
        );

        expect(communities.map((community) => community.size)).toEqual([
            3, 3, 3, 3
        ]);
        expect(communities.every((community) => community.isNamed)).toBe(true);
    });

    it('merges into fewer circles at a lower resolution', () => {
        const graph = ringOfTriangles(8);
        const detailed = assignMutualFriendCommunities(
            graph,
            PALETTE,
            '#neutral'
        );
        const coarse = assignMutualFriendCommunities(
            graph,
            PALETTE,
            '#neutral',
            { resolution: 0.3 }
        );

        expect(coarse.communities.length).toBeLessThan(
            detailed.communities.length
        );
    });

    it('colours only as many large enough circles as allowed', () => {
        const { communities } = assignMutualFriendCommunities(
            ringOfTriangles(4),
            PALETTE,
            '#neutral',
            { namedLimit: 2 }
        );
        expect(communities.map((community) => community.isNamed)).toEqual([
            true,
            true,
            false,
            false
        ]);
        expect(communities[2]?.color).toBe('#neutral');

        const small = assignMutualFriendCommunities(
            ringOfTriangles(4),
            PALETTE,
            '#neutral',
            { minNamedSize: 4 }
        );
        expect(small.communities.some((community) => community.isNamed)).toBe(
            false
        );
    });
});
