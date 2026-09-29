import { describe, expect, it } from 'vitest';

import {
    getToolsByCategory,
    toolCategories,
    toolDefinitionMap,
    toolNavDefinitions
} from './tools';

describe('tool catalog categories', () => {
    it('uses the intended category order and tool grouping', () => {
        expect(toolCategories.map((category) => category.key)).toEqual([
            'image',
            'shortcuts',
            'automation',
            'group',
            'vrchat',
            'data',
            'debug',
            'other'
        ]);
        expect(
            Object.fromEntries(
                toolCategories.map((category) => [
                    category.key,
                    getToolsByCategory(category.key).map((tool) => tool.key)
                ])
            )
        ).toEqual({
            image: ['screenshot-metadata', 'gallery', 'inventory'],
            shortcuts: [
                'vrc-photos',
                'steam-screenshots',
                'vrcx-data',
                'vrchat-data',
                'crash-dumps'
            ],
            automation: [
                'app-launcher',
                'presence-schedule',
                'presence-room-rules',
                'presence-invite-requests'
            ],
            group: ['group-calendar', 'my-groups', 'group-moderation'],
            vrchat: ['vrchat-config', 'launch-options'],
            data: [
                'profile-backup',
                'registry-backup',
                'discord-names',
                'export-notes',
                'export-friend-list',
                'export-own-avatars'
            ],
            debug: ['vrchat-log'],
            other: ['llm-endpoints', 'social-ai', 'edit-invite-message']
        });
    });
});

describe('tool navigation definitions', () => {
    it('dispatches every pinned tool through the shared tool owner', () => {
        for (const tool of toolDefinitionMap.values()) {
            expect(
                toolNavDefinitions.find(
                    (definition) => definition.key === `tool-${tool.key}`
                )
            ).toMatchObject({
                action: { type: 'tool', toolKey: tool.key }
            });
        }
    });
});
