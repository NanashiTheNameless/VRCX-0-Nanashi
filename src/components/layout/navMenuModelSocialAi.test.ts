import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ stored: '' }));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getString: vi.fn(async () => mocks.stored),
        setString: vi.fn(async () => null)
    }
}));

import { createBaseDefaultNavLayout, loadNavMenuModel } from './navMenuModel';

const t = (key: string) => key;

function socialFolderItems(layout: unknown[]) {
    const folder = layout.find(
        (entry) =>
            typeof entry === 'object' &&
            entry !== null &&
            'id' in entry &&
            entry.id === 'default-folder-social'
    ) as { items: unknown[] } | undefined;
    return folder?.items;
}

describe('Social AI nav entry', () => {
    beforeEach(() => {
        mocks.stored = '';
    });

    it('sits at the bottom of the Social folder by default', () => {
        expect(socialFolderItems(createBaseDefaultNavLayout(t))).toEqual([
            'friend-log',
            'friend-list',
            'moderation',
            'social-ai',
            'reminders'
        ]);
    });

    it('joins the Social folder of a saved layout that predates it', async () => {
        mocks.stored = JSON.stringify({
            layout: [
                { type: 'item', key: 'feed' },
                {
                    type: 'folder',
                    id: 'default-folder-social',
                    nameKey: 'nav_tooltip.social',
                    name: 'Social',
                    icon: 'lucide:ContactRound',
                    items: ['friend-log', 'friend-list', 'moderation']
                }
            ],
            hiddenKeys: []
        });

        const model = await loadNavMenuModel({ t });

        expect(socialFolderItems(model.layout)).toEqual([
            'friend-log',
            'friend-list',
            'moderation',
            'reminders',
            'social-ai'
        ]);
        expect(model.layout).not.toContainEqual({
            type: 'item',
            key: 'social-ai'
        });
    });

    it('stays hidden when the user hid it', async () => {
        mocks.stored = JSON.stringify({
            layout: [
                {
                    type: 'folder',
                    id: 'default-folder-social',
                    nameKey: 'nav_tooltip.social',
                    name: 'Social',
                    items: ['friend-log']
                }
            ],
            hiddenKeys: ['social-ai', 'reminders']
        });

        const model = await loadNavMenuModel({ t });

        expect(socialFolderItems(model.layout)).toEqual(['friend-log']);
    });
});
