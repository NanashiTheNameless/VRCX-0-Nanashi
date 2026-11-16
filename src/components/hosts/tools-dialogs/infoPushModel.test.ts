import { describe, expect, it } from 'vitest';

import {
    infoPushActionLink,
    infoPushArticleBlocks,
    infoPushCategory,
    infoPushDescription,
    infoPushImageUrl,
    infoPushLinks,
    infoPushName,
    infoPushStatus,
    type InfoPushItem
} from './infoPushModel';

const NOW = Date.parse('2026-06-01T00:00:00Z');

describe('info push model', () => {
    it('sorts items into the VRCX categories', () => {
        expect(infoPushCategory({ tags: ['x', 'help-article'] })).toBe(
            'help-article'
        );
        expect(infoPushCategory({ tags: ['quick-menu-banner'] })).toBe(
            'quick-menu-banner'
        );
        expect(infoPushCategory({ tags: ['news'] })).toBe('other');
        expect(infoPushCategory({})).toBe('other');
    });

    it('takes names and descriptions from the first field VRChat filled', () => {
        const item: InfoPushItem = {
            id: 'ip_1',
            data: {
                name: { fallback: 'Welcome' },
                tooltipDescription: 'Tooltip'
            }
        };
        expect(infoPushName(item)).toBe('Welcome');
        expect(infoPushDescription(item)).toBe('Tooltip');
        expect(infoPushName({ id: 'ip_2' })).toBe('ip_2');
    });

    it('only uses https images', () => {
        expect(
            infoPushImageUrl({ data: { imageUrl: 'https://a.test/x.png' } })
        ).toBe('https://a.test/x.png');
        expect(
            infoPushImageUrl({ data: { imageUrl: 'http://a.test/x.png' } })
        ).toBe('');
    });

    it('marks disabled, expired and scheduled items', () => {
        expect(infoPushStatus({ isEnabled: false }, NOW)).toBe('disabled');
        expect(
            infoPushStatus(
                { isEnabled: true, endDate: '2026-05-01T00:00:00Z' },
                NOW
            )
        ).toBe('expired');
        expect(
            infoPushStatus(
                { isEnabled: true, startDate: '2026-07-01T00:00:00Z' },
                NOW
            )
        ).toBe('scheduled');
        expect(infoPushStatus({ isEnabled: true }, NOW)).toBe('');
    });

    it('turns article content into plain blocks', () => {
        expect(
            infoPushArticleBlocks({
                data: {
                    article: {
                        content: [
                            { text: '<size=120%><b>Title</b></size>' },
                            { text: 'Line one<br>Line&nbsp;two' },
                            { imageUrl: 'https://a.test/i.png' },
                            { videoUrl: 'https://youtu.be/x' }
                        ]
                    }
                }
            })
        ).toEqual([
            { type: 'heading', value: 'Title' },
            { type: 'text', value: 'Line one\nLine two' },
            { type: 'image', value: 'https://a.test/i.png' },
            { type: 'video', value: 'https://youtu.be/x' }
        ]);
    });

    it('collects unique links and the pressed action', () => {
        const item: InfoPushItem = {
            data: {
                onPressed: {
                    command: 'OpenURL',
                    parameters: ['https://hello.vrchat.com']
                },
                article: {
                    moreInfoLinks: [
                        { command: 'OpenHelpArticle', parameters: ['ip_2'] },
                        { command: 'OpenHelpArticle', parameters: ['ip_2'] }
                    ],
                    embeddedLinkData: [{ name: 'no command' }]
                }
            }
        };
        expect(infoPushActionLink(item)).toEqual({
            command: 'OpenURL',
            target: 'https://hello.vrchat.com',
            name: ''
        });
        expect(infoPushLinks(item)).toEqual([
            { command: 'OpenHelpArticle', target: 'ip_2', name: '' }
        ]);
    });
});
