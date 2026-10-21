import { describe, expect, it } from 'vitest';

import {
    instanceLanguageBadges,
    instanceLanguageRows
} from './instanceLanguages';

describe('instanceLanguageRows', () => {
    it('names languages through their ISO 639 keys and orders them by share', () => {
        const names: Record<string, string> = {
            eng: 'English',
            zho: 'Chinese'
        };

        const rows = instanceLanguageRows(
            {
                languages: ['en', 'zh-cn', 'zh-tw'],
                languagesIso639: ['eng', 'zho'],
                languageRatio: { en: 0.25, 'zh-cn': 0.5, 'zh-tw': 0.25 }
            },
            (key) => names[key]
        );

        expect(rows).toEqual([
            {
                code: 'zh-cn',
                iso639: 'zho',
                label: 'Chinese (CN)',
                percent: 50
            },
            { code: 'en', iso639: 'eng', label: 'English', percent: 25 },
            { code: 'zh-tw', iso639: 'zho', label: 'Chinese (TW)', percent: 25 }
        ]);
        expect(instanceLanguageBadges(rows)).toEqual([
            { code: 'ZHO', tooltip: 'Chinese (CN) 50% · Chinese (TW) 25%' },
            { code: 'ENG', tooltip: 'English 25%' }
        ]);
    });

    it('keeps slim ratios without ISO codes out of the badges', () => {
        const rows = instanceLanguageRows(
            { languageRatio: { ja: 0.47, 'zh-CN': 0.35 } },
            () => undefined
        );

        expect(rows.map((row) => row.code)).toEqual(['ja', 'zh-CN']);
        expect(instanceLanguageBadges(rows)).toEqual([]);
    });

    it('returns nothing for instances without language data', () => {
        expect(instanceLanguageRows({}, () => undefined)).toEqual([]);
    });
});
