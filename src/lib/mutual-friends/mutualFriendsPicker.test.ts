import { describe, expect, it } from 'vitest';

import type { FriendRecord } from '@/domain/friends/types';
import { MUTUAL_GRAPH_EMPTY_USER_ID } from '@/lib/mutual-friends/mutualFriendsSettings';
import { offlinePresence } from '@/test/presenceFixtures';

import {
    buildMutualFriendExcludePickerOptions,
    buildMutualFriendPickerOption,
    truncateMutualFriendLabel
} from './mutualFriendsPicker';

function friend(patch: Partial<FriendRecord> = {}): FriendRecord {
    return {
        id: 'usr_1',
        displayName: 'Friend',
        tags: [],
        $presence: offlinePresence,
        $trustLevel: 'Visitor',
        $friendNumber: 0,
        $trustClass: 'x-tag-untrusted',
        $trustSortNum: 0,
        $isModerator: false,
        $isTroll: false,
        $isProbableTroll: false,
        $platform: '',
        ...patch
    };
}

describe('mutualFriendsPicker', () => {
    it('builds picker search text from the name, username and id', () => {
        const built = buildMutualFriendPickerOption(
            ' usr_ava ',
            {
                usr_ava: friend({
                    id: 'usr_ava',
                    displayName: 'Ava Star',
                    username: 'ava_user'
                })
            },
            '',
            5
        );

        expect(built?.search).toBe('Ava Star ava_user usr_ava');
        expect(built?.displayLabel).toBe('Ava Star (5)');
    });

    it('builds hidden-friend picker choices from all cached graph ids without duplicates or self', () => {
        const options = buildMutualFriendExcludePickerOptions(
            new Map([
                ['usr_self', ['usr_a', 'usr_b']],
                ['usr_a', ['usr_self', 'usr_b', MUTUAL_GRAPH_EMPTY_USER_ID]]
            ]),
            {
                usr_a: friend({ id: 'usr_a', displayName: 'Ava' }),
                usr_b: friend({ id: 'usr_b', displayName: 'Ben' })
            },
            'usr_self'
        );

        expect(options.map((item) => item.value)).toEqual(['usr_a', 'usr_b']);
        expect(options.map((item) => item.label)).toEqual(['Ava', 'Ben']);
    });

    it('keeps long graph labels compact for node rendering', () => {
        expect(truncateMutualFriendLabel('Short name', 20)).toBe('Short name');
        expect(truncateMutualFriendLabel('Very long display name', 10)).toBe(
            'Very long...'
        );
    });
});
