import { describe, expect, it } from 'vitest';

import {
    collectFavoriteGroupFriendIds,
    resolveSelectedFavoriteGroupKeys
} from './favoriteGroupSelection';

describe('favorite group selection', () => {
    it('drops deleted groups and falls back to every group when none remain', () => {
        const groups = ['group_a', 'local:Mine'];
        expect(
            resolveSelectedFavoriteGroupKeys(['group_a', 'gone'], groups)
        ).toEqual(['group_a']);
        expect(resolveSelectedFavoriteGroupKeys(['gone'], groups)).toEqual(
            groups
        );
        expect(resolveSelectedFavoriteGroupKeys([], groups)).toEqual(groups);
        expect(resolveSelectedFavoriteGroupKeys(undefined, groups)).toEqual(
            groups
        );
    });

    it('collects remote and local group members by group key', () => {
        expect([
            ...collectFavoriteGroupFriendIds(
                ['group_a', 'local:Mine'],
                { group_a: [' usr_remote ', ''], group_b: ['usr_other'] },
                { Mine: ['usr_local'] }
            )
        ]).toEqual(['usr_remote', 'usr_local']);
    });
});
