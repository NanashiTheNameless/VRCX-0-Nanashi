import { describe, expect, it } from 'vitest';

import {
    canSearchInApp,
    codeSearchLinkUrl,
    findCodeCandidates,
    isValidLinkTemplate,
    parseCodeSearchResults,
    type CodeSearchSettings
} from './codeSearchService';

const settings: CodeSearchSettings = {
    linkEngine: '',
    linkTemplate: '',
    provider: '',
    apiKey: '',
    googleEngineId: '',
    searxngEndpoint: ''
};

describe('code search', () => {
    it('opens no link until an engine is chosen', () => {
        expect(codeSearchLinkUrl(settings, 'VRChat code')).toBeNull();
        expect(
            codeSearchLinkUrl({ ...settings, linkEngine: 'bing' }, 'a b')
        ).toBe('https://www.bing.com/search?q=a%20b');
        expect(
            codeSearchLinkUrl(
                {
                    ...settings,
                    linkEngine: 'custom',
                    linkTemplate: 'https://search.example.org/?s={query}'
                },
                'x'
            )
        ).toBe('https://search.example.org/?s=x');
        expect(
            codeSearchLinkUrl(
                {
                    ...settings,
                    linkEngine: 'custom',
                    linkTemplate: 'javascript:alert({query})'
                },
                'x'
            )
        ).toBeNull();
        expect(isValidLinkTemplate('https://example.org/')).toBe(false);
    });

    it('searches in the app only with what the chosen engine needs', () => {
        expect(canSearchInApp(settings)).toBe(false);
        expect(canSearchInApp({ ...settings, provider: 'brave' })).toBe(false);
        expect(
            canSearchInApp({ ...settings, provider: 'brave', apiKey: 'k' })
        ).toBe(true);
        expect(
            canSearchInApp({ ...settings, provider: 'google', apiKey: 'k' })
        ).toBe(false);
        expect(
            canSearchInApp({
                ...settings,
                provider: 'searxng',
                searxngEndpoint: 'https://search.example.org'
            })
        ).toBe(true);
    });

    it('picks out words that look like codes', () => {
        expect(
            findCodeCandidates(
                'Use code SPRING2026 or VRC-4F7K-2Q9P on VRChat via HTTPS today'
            )
        ).toEqual(['SPRING2026', 'VRC-4F7K-2Q9P']);
        expect(findCodeCandidates('no codes HERE 12345')).toEqual([]);
    });

    it('reads each engine answer', () => {
        expect(
            parseCodeSearchResults('brave', {
                web: {
                    results: [
                        {
                            title: 'Free <strong>hat</strong>',
                            url: 'https://example.org/a',
                            description: 'Redeem HAT2026 now'
                        }
                    ]
                }
            })
        ).toEqual([
            {
                title: 'Free hat',
                url: 'https://example.org/a',
                snippet: 'Redeem HAT2026 now',
                codes: ['HAT2026']
            }
        ]);
        expect(
            parseCodeSearchResults('google', {
                items: [
                    {
                        title: 'G',
                        link: 'https://example.org/g',
                        snippet: 'none'
                    },
                    { title: 'Bad', link: 'javascript:alert(1)' }
                ]
            }).map((row) => row.url)
        ).toEqual(['https://example.org/g']);
        expect(
            parseCodeSearchResults('searxng', {
                results: [
                    {
                        title: 'S',
                        url: 'https://example.org/s',
                        content: 'CODE-ABC123'
                    }
                ]
            })[0]?.codes
        ).toEqual(['CODE-ABC123']);
    });
});
