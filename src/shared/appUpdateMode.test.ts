import { describe, expect, it } from 'vitest';

import { isAppUpdateMode, normalizeAppUpdateMode } from './appUpdateMode';

describe('app update mode', () => {
    it('keeps a stored mode', () => {
        expect(normalizeAppUpdateMode('Off', false)).toBe('Off');
        expect(normalizeAppUpdateMode(' Auto Download ')).toBe('Auto Download');
    });

    it('maps the legacy auto-install switch: on -> Auto Install, off -> Notify', () => {
        expect(normalizeAppUpdateMode('', true)).toBe('Auto Install');
        expect(normalizeAppUpdateMode('', false)).toBe('Notify');
        expect(normalizeAppUpdateMode(undefined)).toBe('Auto Install');
    });

    it('recognizes only known modes', () => {
        expect(isAppUpdateMode('Notify')).toBe(true);
        expect(isAppUpdateMode('notify')).toBe(false);
        expect(isAppUpdateMode(null)).toBe(false);
    });
});
