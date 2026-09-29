import { describe, expect, it } from 'vitest';

import {
    languageCodeLabel,
    languageTooltipLabel,
    resolveFriendStatusMeta
} from './friendListDisplay';

describe('friendListDisplay', () => {
    it('shows compact language codes and readable fallbacks for the language column', () => {
        expect(languageCodeLabel('eng')).toBe('ENG');
        expect(languageCodeLabel('language_jpn')).toBe('JPN');
        expect(languageCodeLabel('')).toBe('');

        expect(
            languageTooltipLabel({ value: 'English', key: 'eng' }, 'ENG')
        ).toBe('English');
        expect(languageTooltipLabel({ key: 'jpn' }, 'JPN')).toBe('JPN');
        expect(languageTooltipLabel({}, '')).toBe('');
    });

    it('shows status text and indicator state for friend status badges', () => {
        const active = resolveFriendStatusMeta({
            status: 'active',
            statusDescription: '',
            state: 'online'
        });
        expect(active.label).toBe('');
        expect(active.showIndicator).toBe(true);

        const custom = resolveFriendStatusMeta({
            status: 'busy',
            statusDescription: 'Do not disturb'
        });
        expect(custom.label).toBe('Do not disturb');

        expect(resolveFriendStatusMeta(null).showIndicator).toBe(false);
    });

    it('ranks join me, active, ask me, busy, then offline friends for sorting', () => {
        const ranks = [
            { status: 'join me', state: 'online' },
            { status: 'active', state: 'online' },
            { status: 'ask me', state: 'online' },
            { status: 'busy', state: 'online' },
            { status: 'active', state: 'offline' }
        ].map((friend) => resolveFriendStatusMeta(friend).sortRank);

        expect([...ranks].sort((left, right) => left - right)).toEqual(ranks);
        expect(new Set(ranks).size).toBe(ranks.length);
    });
});
