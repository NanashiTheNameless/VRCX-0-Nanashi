import { describe, expect, it } from 'vitest';

import {
    normalizeSidebarTabLayout,
    serializeSidebarTabLayout,
    type SidebarTabLayout
} from '@/shared/utils/sidebarTabLayout';

const WORLD_ID = 'wrld_11111111-1111-1111-1111-111111111111';

function savedWorldTabs(saved: unknown) {
    return normalizeSidebarTabLayout(JSON.stringify(saved))
        .filter((item) => item.type === 'worldRooms')
        .map((item) => item.id);
}

describe('saved sidebar layout with world tabs', () => {
    it('restores a pinned world tab exactly as it was saved', () => {
        const layout: SidebarTabLayout = [
            {
                id: 'friends',
                type: 'system',
                systemTab: 'friends',
                icon: 'lucide:UserRound',
                visible: true
            },
            {
                id: 'world-karaoke',
                type: 'worldRooms',
                worldId: WORLD_ID,
                name: 'Karaoke',
                visible: false
            },
            {
                id: 'groups',
                type: 'system',
                systemTab: 'groups',
                icon: 'lucide:UsersRound',
                visible: true
            },
            // Fork: the dedicated left-navigation page tabs are part of every
            // saved layout, so they have to be saved for a faithful round trip.
            {
                id: 'page-chartsMutual',
                type: 'page',
                page: 'chartsMutual',
                labelKey: 'app.routes.charts_mutual',
                icon: 'lucide:UsersRound',
                visible: true
            },
            {
                id: 'page-reminders',
                type: 'page',
                page: 'reminders',
                labelKey: 'view.reminders.title',
                icon: 'lucide:AlarmClock',
                visible: true
            },
            {
                id: 'page-tools',
                type: 'page',
                page: 'tools',
                labelKey: 'app.routes.tools',
                icon: 'lucide:Wrench',
                visible: true
            }
        ];

        expect(
            normalizeSidebarTabLayout(serializeSidebarTabLayout(layout))
        ).toEqual(layout);
    });

    it('ignores a custom icon saved on a world tab because the world cover is its icon', () => {
        const [worldTab] = normalizeSidebarTabLayout(
            JSON.stringify([
                {
                    id: 'world-karaoke',
                    type: 'worldRooms',
                    worldId: WORLD_ID,
                    name: 'Karaoke',
                    icon: 'lucide:Gamepad2'
                }
            ])
        ).filter((item) => item.type === 'worldRooms');

        expect(worldTab).not.toHaveProperty('icon');
    });

    it('drops a saved world tab that has no valid world id', () => {
        expect(
            savedWorldTabs([
                { id: 'a', type: 'worldRooms', worldId: '', name: 'A' },
                { id: 'b', type: 'worldRooms', worldId: 'usr_x', name: 'B' }
            ])
        ).toEqual([]);
    });

    it('keeps a single tab when the same world was saved twice', () => {
        expect(
            savedWorldTabs([
                { id: 'a', type: 'worldRooms', worldId: WORLD_ID, name: 'A' },
                { id: 'b', type: 'worldRooms', worldId: WORLD_ID, name: 'B' }
            ])
        ).toEqual(['a']);
    });
});
