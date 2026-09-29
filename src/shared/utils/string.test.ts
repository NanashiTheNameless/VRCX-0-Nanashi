import { describe, expect, it } from 'vitest';

import { localeIncludes, normalizeString, replaceBioSymbols } from './string';

describe('string utils', () => {
    it('matches locale-aware substrings with the supplied comparer', () => {
        const comparer = new Intl.Collator('en', {
            sensitivity: 'base'
        });

        expect(localeIncludes('Cafe noir', 'CAFÉ', comparer)).toBe(true);
        expect(localeIncludes('Cafe noir', 'tea', comparer)).toBe(false);
        expect(localeIncludes('Cafe noir', '', comparer)).toBe(true);
        expect(localeIncludes('', 'Cafe', comparer)).toBe(false);
    });

    it('trims strings and coerces non-string inputs', () => {
        expect(normalizeString('  hi  ')).toBe('hi');
        expect(normalizeString(null)).toBe('');
        expect(normalizeString(undefined)).toBe('');
        expect(normalizeString(42)).toBe('42');
        expect(normalizeString(true)).toBe('true');
    });

    it('normalizes bio symbols', () => {
        expect(replaceBioSymbols('Hi  ＠＃≺tag≻＼path  ')).toBe(
            'Hi @#<tag>\\path'
        );
        expect(replaceBioSymbols(null)).toBe('');
    });
});
