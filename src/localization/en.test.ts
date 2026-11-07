import { describe, expect, it } from 'vitest';

import en from './en.json';

function collectStrings(node: unknown, path: string, out: [string, string][]) {
    if (typeof node === 'string') {
        out.push([path, node]);
    } else if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
            collectStrings(value, path ? `${path}.${key}` : key, out);
        }
    }
}

describe('en.json', () => {
    // i18nService interpolates with single braces, so "{{name}}" is shown to
    // the user as literal text.
    it('uses single-brace placeholders only', () => {
        const strings: [string, string][] = [];
        collectStrings(en, '', strings);
        const doubled = strings
            .filter(([, value]) => value.includes('{{'))
            .map(([path]) => path);
        expect(doubled).toEqual([]);
    });
});
