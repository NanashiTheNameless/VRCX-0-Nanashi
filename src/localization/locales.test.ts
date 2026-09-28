import { describe, expect, it, vi } from 'vitest';

import {
    getLanguageCodesSnapshot,
    registerLanguageCode,
    subscribeLanguageCodes,
    unregisterLanguageCode
} from './locales';

describe('language code registry', () => {
    it('notifies subscribers and replaces the snapshot on change', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeLanguageCodes(listener);
        const before = getLanguageCodesSnapshot();

        registerLanguageCode('tlh_aa');
        const added = getLanguageCodesSnapshot();
        expect(added).not.toBe(before);
        expect(added).toContain('tlh_aa');

        registerLanguageCode('tlh_aa');
        expect(getLanguageCodesSnapshot()).toBe(added);

        unregisterLanguageCode('tlh_aa');
        expect(getLanguageCodesSnapshot()).not.toContain('tlh_aa');
        expect(listener).toHaveBeenCalledTimes(2);

        unregisterLanguageCode('en');
        expect(getLanguageCodesSnapshot()).toContain('en');
        expect(listener).toHaveBeenCalledTimes(2);

        unsubscribe();
    });
});
