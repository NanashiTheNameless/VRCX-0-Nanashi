import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    stored: '',
    bools: {} as Record<string, boolean>,
    setString: vi.fn(async () => null)
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getString: vi.fn(async () => mocks.stored),
        setString: mocks.setString,
        getBool: vi.fn(
            async (key: string, fallback: boolean) =>
                mocks.bools[key] ?? fallback
        ),
        setBool: vi.fn(async (key: string, value: boolean) => {
            mocks.bools[key] = value;
            return null;
        })
    }
}));

import {
    createBaseDefaultNavLayout,
    loadNavMenuModel,
    moveAssistantOutOfSocialFolder
} from './navMenuModel';

const t = (key: string) => key;
const MIGRATED = 'VRCX_navAssistantTopLevelMigrated';

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

function socialFolder(items: unknown[]) {
    return {
        type: 'folder',
        id: 'default-folder-social',
        nameKey: 'nav_tooltip.social',
        name: 'Social',
        icon: 'lucide:ContactRound',
        items
    };
}

function topLevelKeys(layout: unknown[]) {
    return layout.flatMap((entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        'type' in entry &&
        entry.type === 'item' &&
        'key' in entry
            ? [entry.key]
            : []
    );
}

describe('AI Assistant nav entry', () => {
    beforeEach(() => {
        mocks.stored = '';
        mocks.bools = {};
        mocks.setString.mockClear();
    });

    it('sits in the main list right after the Social folder by default', () => {
        const layout = createBaseDefaultNavLayout(t);
        expect(socialFolderItems(layout)).toEqual([
            'friend-log',
            'friend-list',
            'moderation',
            'reminders'
        ]);
        const folderIndex = layout.findIndex(
            (entry) =>
                entry.type === 'folder' && entry.id === 'default-folder-social'
        );
        expect(layout[folderIndex + 1]).toEqual({
            type: 'item',
            key: 'social-ai'
        });
    });

    it('joins the main list of a saved layout that predates it', async () => {
        mocks.stored = JSON.stringify({
            layout: [
                { type: 'item', key: 'feed' },
                socialFolder(['friend-log', 'friend-list', 'moderation'])
            ],
            hiddenKeys: []
        });

        const model = await loadNavMenuModel({ t });

        expect(socialFolderItems(model.layout)).toEqual([
            'friend-log',
            'friend-list',
            'moderation',
            'reminders'
        ]);
        expect(topLevelKeys(model.layout)).toContain('social-ai');
    });

    it('moves it out of the default Social folder once, keeping its icon', async () => {
        mocks.stored = JSON.stringify({
            layout: [
                { type: 'item', key: 'feed' },
                socialFolder([
                    'friend-log',
                    { key: 'social-ai', icon: 'lucide:Bot' },
                    'reminders'
                ]),
                { type: 'item', key: 'tools' }
            ],
            hiddenKeys: []
        });

        const model = await loadNavMenuModel({ t });

        expect(socialFolderItems(model.layout)).toEqual([
            'friend-log',
            'reminders'
        ]);
        expect(model.layout[2]).toEqual({
            type: 'item',
            key: 'social-ai',
            icon: 'lucide:Bot'
        });
        expect(mocks.bools[MIGRATED]).toBe(true);
        expect(mocks.setString).toHaveBeenCalledTimes(1);
    });

    it('leaves the layout alone after the migration ran', async () => {
        mocks.bools[MIGRATED] = true;
        mocks.stored = JSON.stringify({
            layout: [socialFolder(['friend-log', 'social-ai'])],
            hiddenKeys: []
        });

        const model = await loadNavMenuModel({ t });

        expect(socialFolderItems(model.layout)).toEqual([
            'friend-log',
            'social-ai',
            'reminders'
        ]);
        expect(mocks.setString).not.toHaveBeenCalled();
    });

    it('does not move it out of a folder the user made', () => {
        const layout = [
            {
                type: 'folder',
                id: 'nav-folder-mine',
                name: 'Mine',
                items: ['social-ai']
            }
        ];
        expect(moveAssistantOutOfSocialFolder(layout)).toBe(layout);
    });

    it('stays hidden when the user hid it', async () => {
        mocks.stored = JSON.stringify({
            layout: [socialFolder(['friend-log'])],
            hiddenKeys: ['social-ai', 'reminders']
        });

        const model = await loadNavMenuModel({ t });

        expect(socialFolderItems(model.layout)).toEqual(['friend-log']);
        expect(topLevelKeys(model.layout)).not.toContain('social-ai');
    });
});
