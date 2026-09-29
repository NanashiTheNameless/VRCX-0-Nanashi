import { describe, expect, it } from 'vitest';

import { matchFriendByName } from './matchFriendByName';

const friends = [
    { id: 'usr_a', displayName: 'Alice' },
    { id: 'usr_al', displayName: 'Alicia' },
    { id: 'usr_b', displayName: 'Bobby Tables' }
];

describe('matchFriendByName', () => {
    it('prefers an exact, case-insensitive name', () => {
        expect(matchFriendByName('alice', friends)).toBe('usr_a');
    });

    it('accepts a unique prefix or substring', () => {
        expect(matchFriendByName('bob', friends)).toBe('usr_b');
        expect(matchFriendByName('tables', friends)).toBe('usr_b');
    });

    it('leaves ambiguous or unknown names unmatched', () => {
        expect(matchFriendByName('ali', friends)).toBe('');
        expect(matchFriendByName('carol', friends)).toBe('');
        expect(matchFriendByName('  ', friends)).toBe('');
    });
});
