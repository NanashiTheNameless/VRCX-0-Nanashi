import { describe, expect, it } from 'vitest';

import { isBotContributor } from './useAboutContributors';

describe('isBotContributor', () => {
    it('hides GitHub bots and app accounts reported as users', () => {
        for (const entry of [
            { login: 'dependabot[bot]', type: 'Bot' },
            { login: 'github-actions[bot]', type: 'Bot' },
            { login: 'claude', type: 'User' },
            { login: 'codex', type: 'User' },
            { login: 'chatgpt-codex-connector', type: 'User' },
            { login: 'ImgBotApp', type: 'User' },
            { login: 'fossabot', type: 'User' }
        ]) {
            expect(isBotContributor(entry), entry.login).toBe(true);
        }
    });

    it('keeps people', () => {
        for (const login of ['Map1en', 'NanashiTheNameless', 'CQMHV']) {
            expect(isBotContributor({ login, type: 'User' }), login).toBe(
                false
            );
        }
    });
});
