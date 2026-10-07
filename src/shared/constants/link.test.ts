import { describe, expect, it } from 'vitest';

import { links } from './link';

describe('links', () => {
    it('uses GitHub Sponsors as the donation target', () => {
        expect(links.githubSponsors).toBe(
            'https://github.com/sponsors/NanashiTheNameless'
        );
    });

    it('uses Ko-fi as the alternate support target', () => {
        expect(links.kofi).toBe('https://ko-fi.com/NanashiTheNameless');
    });

    it('contains VRChat docs and status links', () => {
        expect(links.vrchatStatus).toBe('https://status.vrchat.com/');
        expect(links.vrchatDocsConfigurationFile).toBe(
            'https://docs.vrchat.com/docs/configuration-file'
        );
        expect(links.vrchatDocsLaunchOptions).toBe(
            'https://docs.vrchat.com/docs/launch-options'
        );
    });

    it('contains community theme source links', () => {
        expect(links.communityThemesRepository).toBe(
            'https://github.com/Map1en/VRCX-0-Community-Themes'
        );
        expect(links.communityThemesIndex).toBe(
            'https://raw.githubusercontent.com/Map1en/VRCX-0-Community-Themes/master/themes/index.json'
        );
    });
});
