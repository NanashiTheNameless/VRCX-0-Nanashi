import { CodeXml, Diamond, Palette, ShieldCheck, Star } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { normalizeGlobalBadgeCatalog } from '@/domain/badges/globalBadges';
import {
    FORK_DEVELOPER_USER_ID,
    UPSTREAM_DEVELOPER_USER_ID
} from '@/shared/constants/user';
import { useCustomBadgeStore } from '@/state/customBadgeStore';
import { useGlobalBadgeStore } from '@/state/globalBadgeStore';
import { usePreferencesStore } from '@/state/preferencesStore';

import { buildOverlayUserBadges } from './overlayBadgeSyncService';

const icons = { CodeXml, Diamond, Palette, ShieldCheck, Star };

describe('buildOverlayUserBadges', () => {
    afterEach(() => {
        useCustomBadgeStore.setState({ badges: [], loaded: false });
        useGlobalBadgeStore.setState({ catalog: null });
        usePreferencesStore.setState({ reducedMotionAndBlur: false });
        vi.unstubAllGlobals();
    });

    it('gives the developer the built-in badge and listed users their custom badges', () => {
        useCustomBadgeStore.setState({
            loaded: true,
            badges: [
                {
                    id: 'artist',
                    label: 'Artist',
                    icon: 'Palette',
                    color: '#ff0000',
                    enabled: true,
                    rules: [
                        {
                            kind: 'users',
                            userIds: ['usr_artist', FORK_DEVELOPER_USER_ID]
                        }
                    ]
                },
                {
                    id: 'imitator',
                    label: 'Fake dev',
                    icon: 'CodeXml',
                    color: '#ffff00',
                    enabled: true,
                    rules: [{ kind: 'users', userIds: ['usr_artist'] }]
                }
            ]
        });

        const table = buildOverlayUserBadges(icons);
        const styleOf = (userId: string) =>
            (table.users?.[userId] ?? []).map((index) => table.styles?.[index]);

        const developer = styleOf(FORK_DEVELOPER_USER_ID);
        expect(developer).toHaveLength(2);
        expect(developer[0]).toMatchObject({
            colorBorder: '#e5202e',
            round: false,
            effects: ['glitch']
        });
        expect(developer[0]?.icon).toMatch(/^M/);
        expect(developer[1]).toMatchObject({
            colorFrom: '#ff0000',
            colorIcon: '#ffffff',
            round: true
        });

        const artist = styleOf('usr_artist');
        expect(artist).toHaveLength(2);
        expect(artist[0]?.icon).toBe(developer[1]?.icon);
        // A custom badge cannot borrow the developer badge's reserved icon.
        expect(artist[1]?.icon).not.toBe(developer[0]?.icon);
        expect(artist[1]?.colorIcon).toBe('#111111');

        expect(table.users?.usr_nobody).toBeUndefined();
        expect(table.animations).toBe(true);
        const upstreamIndex = table.users?.[UPSTREAM_DEVELOPER_USER_ID]?.[0];
        expect(table.styles?.[upstreamIndex!]?.effects).toEqual(['sparkle']);
        expect(developer[1]?.effects ?? []).toEqual([]);
    });

    it('passes combined global effects and per-award overrides to the overlay', () => {
        useGlobalBadgeStore.setState({
            catalog: normalizeGlobalBadgeCatalog({
                badges: [
                    { id: 'artist', icon: 'Palette', animation: 'embers glow' }
                ],
                awards: [
                    { userId: 'usr_artist', badge: 'artist' },
                    {
                        userId: 'usr_still',
                        badge: 'artist',
                        overrides: { animation: 'none' }
                    }
                ]
            })
        });

        const table = buildOverlayUserBadges(icons);
        const artist = table.users?.usr_artist?.[0];
        const still = table.users?.usr_still?.[0];
        expect(artist).toBeDefined();
        expect(still).toBeDefined();
        expect(table.styles?.[artist!]?.effects).toEqual(['embers', 'glow']);
        expect(table.styles?.[still!]?.effects).toEqual([]);
    });

    it('stops overlay motion when Reduce Effects is enabled', () => {
        usePreferencesStore.setState({ reducedMotionAndBlur: true });
        expect(buildOverlayUserBadges(icons).animations).toBe(false);
        usePreferencesStore.setState({ reducedMotionAndBlur: false });
        expect(buildOverlayUserBadges(icons).animations).toBe(true);
    });

    it('honors the OS reduced-motion preference', () => {
        const matchMedia = vi.fn(() => ({ matches: true }));
        vi.stubGlobal('window', { matchMedia });
        expect(buildOverlayUserBadges(icons).animations).toBe(false);
        expect(matchMedia).toHaveBeenCalledWith(
            '(prefers-reduced-motion: reduce)'
        );
    });
});
