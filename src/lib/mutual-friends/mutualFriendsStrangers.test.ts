import { describe, expect, it } from 'vitest';

import { MUTUAL_GRAPH_EMPTY_USER_ID } from './mutualFriendsSettings';
import {
    dominantMutualFriendCommunity,
    mutualFriendIdsOf,
    summarizeRoomMutualCircles
} from './mutualFriendsStrangers';
import type { MutualFriendCommunity } from './mutualFriendsTypes';

function community(index: number, isNamed = true): MutualFriendCommunity {
    return {
        index,
        size: 10 - index,
        color: `#00000${index}`,
        label: `anchor_${index}`,
        isNamed
    };
}

const communities = [community(0), community(1), community(2, false)];

describe('mutualFriendIdsOf', () => {
    it('keeps disclosed mutual friend ids once in response order', () => {
        expect(
            mutualFriendIdsOf([
                { id: ' usr_b ' },
                { id: MUTUAL_GRAPH_EMPTY_USER_ID },
                { id: 'usr_a' },
                { id: 'usr_b' },
                {}
            ])
        ).toEqual(['usr_b', 'usr_a']);
    });
});

describe('dominantMutualFriendCommunity', () => {
    const communityIndexById = new Map([
        ['usr_a', 0],
        ['usr_b', 1],
        ['usr_c', 1],
        ['usr_d', 2],
        ['usr_e', 2],
        ['usr_f', 2]
    ]);

    it('picks the named circle holding most of the shared friends', () => {
        expect(
            dominantMutualFriendCommunity(
                ['usr_a', 'usr_b', 'usr_c', 'usr_d', 'usr_e', 'usr_f'],
                communityIndexById,
                communities
            )
        ).toBe(communities[1]);
    });

    it('breaks ties toward the larger circle and ignores unnamed ones', () => {
        expect(
            dominantMutualFriendCommunity(
                ['usr_b', 'usr_a', 'usr_d'],
                communityIndexById,
                communities
            )
        ).toBe(communities[0]);
        expect(
            dominantMutualFriendCommunity(
                ['usr_d', 'usr_unknown'],
                communityIndexById,
                communities
            )
        ).toBeNull();
    });
});

describe('summarizeRoomMutualCircles', () => {
    it('lists at most two circles shared by at least two players', () => {
        expect(
            summarizeRoomMutualCircles([
                communities[1],
                communities[0],
                communities[1],
                communities[0],
                communities[1],
                community(3),
                null
            ])
        ).toEqual([communities[1], communities[0]]);
        expect(
            summarizeRoomMutualCircles([communities[0], communities[1], null])
        ).toEqual([]);
    });
});
