import { CodeXml, Palette, ShieldCheck, Star } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';

import { FORK_DEVELOPER_USER_ID } from '@/shared/constants/user';
import { useCustomBadgeStore } from '@/state/customBadgeStore';

import { buildOverlayUserBadges } from './overlayBadgeSyncService';

const icons = { CodeXml, Palette, ShieldCheck, Star };

describe('buildOverlayUserBadges', () => {
    afterEach(() => {
        useCustomBadgeStore.setState({ badges: [], loaded: false });
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
            round: false
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
    });
});
