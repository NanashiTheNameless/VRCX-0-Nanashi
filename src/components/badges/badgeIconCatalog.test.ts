import { icons, type LucideIcon } from 'lucide-react';
import { beforeAll, describe, expect, it } from 'vitest';

import { badgeIconLabel, loadBadgeIcons, resolveBadgeIcon } from './badgeIcons';

let BADGE_ICONS: Readonly<Record<string, LucideIcon>> = {};
let BADGE_ICON_NAMES: readonly string[] = [];

describe('badge icon catalog', () => {
    beforeAll(async () => {
        ({ icons: BADGE_ICONS, names: BADGE_ICON_NAMES } =
            await loadBadgeIcons());
    });

    it('offers every Lucide icon and the Lucide Lab icons under a Lab prefix', () => {
        for (const name of Object.keys(icons)) {
            expect(BADGE_ICONS[name], name).toBeDefined();
        }
        expect(BADGE_ICONS.LabAstronautHelmet).toBeDefined();
        expect(BADGE_ICON_NAMES).toContain('LabAstronautHelmet');
        expect(BADGE_ICON_NAMES).not.toContain('LabDefault');
        expect(
            BADGE_ICON_NAMES.filter((name) => !/^[A-Z][A-Za-z0-9]*$/.test(name))
        ).toEqual([]);
    });

    it('leaves out Lab icons that Lucide has adopted', () => {
        expect(BADGE_ICONS.Avocado).toBeDefined();
        expect(BADGE_ICONS.LabAvocado).toBeUndefined();
    });

    it('draws a saved Lab icon with the Lucide icon that replaced it', () => {
        expect(resolveBadgeIcon(BADGE_ICONS, 'LabAvocado')).toBe(
            BADGE_ICONS.Avocado
        );
        expect(resolveBadgeIcon(BADGE_ICONS, 'LabCheese')).toBe(
            BADGE_ICONS.Cheese
        );
        expect(resolveBadgeIcon(BADGE_ICONS, 'LabNoSuchIcon')).toBeUndefined();
    });

    it('labels Lab icons so they read as Lab icons', () => {
        expect(badgeIconLabel('LabAstronautHelmet')).toBe(
            'Astronaut Helmet (Lab)'
        );
        expect(badgeIconLabel('CalendarDays')).toBe('Calendar Days');
    });
});
