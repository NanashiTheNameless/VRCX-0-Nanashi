import { describe, expect, it } from 'vitest';

import {
    assignUserMutualEgoCommunities,
    buildUserMutualEgoGraph
} from './userDialogMutualEgoGraph';

describe('buildUserMutualEgoGraph', () => {
    it('connects the profile to every mutual friend and keeps only friend edges inside the circle', () => {
        const graph = buildUserMutualEgoGraph({
            center: { id: 'usr_target', label: 'Target' },
            friends: [
                { id: 'usr_a', label: 'A' },
                { id: 'usr_b', label: 'B' }
            ],
            links: [
                { source: 'usr_a', target: 'usr_b' },
                { source: 'usr_a', target: 'usr_outside' }
            ],
            nodeById: new Map([
                [
                    'usr_a',
                    {
                        id: 'usr_a',
                        label: 'A',
                        lastFetchedAt: '2026-09-01T00:00:00.000Z',
                        optedOut: false,
                        degree: 40,
                        mutualCount: 42
                    }
                ]
            ])
        });

        expect(graph.links).toEqual([
            { source: 'usr_target', target: 'usr_a' },
            { source: 'usr_target', target: 'usr_b' },
            { source: 'usr_a', target: 'usr_b' }
        ]);
        expect(graph.nodes).toEqual([
            {
                id: 'usr_target',
                label: 'Target',
                lastFetchedAt: '',
                optedOut: false,
                degree: 2,
                mutualCount: 2
            },
            {
                id: 'usr_a',
                label: 'A',
                lastFetchedAt: '2026-09-01T00:00:00.000Z',
                optedOut: false,
                degree: 2,
                mutualCount: 42
            },
            {
                id: 'usr_b',
                label: 'B',
                lastFetchedAt: null,
                optedOut: false,
                degree: 2,
                mutualCount: 0
            }
        ]);
    });

    it('finds circles among the mutual friends shown here without the profile joining them together', () => {
        const ids = ['usr_a', 'usr_b', 'usr_c', 'usr_d', 'usr_e', 'usr_f'];
        const graph = buildUserMutualEgoGraph({
            center: { id: 'usr_target', label: 'Target' },
            friends: ids.map((id) => ({ id, label: id })),
            links: [
                { source: 'usr_a', target: 'usr_b' },
                { source: 'usr_b', target: 'usr_c' },
                { source: 'usr_a', target: 'usr_c' },
                { source: 'usr_d', target: 'usr_e' },
                { source: 'usr_e', target: 'usr_f' },
                { source: 'usr_d', target: 'usr_f' }
            ],
            nodeById: new Map()
        });

        const { communityIndexById, communities } =
            assignUserMutualEgoCommunities(graph, 'usr_target', true);

        expect(communityIndexById.has('usr_target')).toBe(false);
        expect(communities.map((community) => community.size)).toEqual([3, 3]);
        expect(communityIndexById.get('usr_a')).toBe(
            communityIndexById.get('usr_c')
        );
        expect(communityIndexById.get('usr_a')).not.toBe(
            communityIndexById.get('usr_d')
        );
    });
});
