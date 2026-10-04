import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    loadLocaleMessages: vi.fn()
}));

vi.mock('@/localization/index', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/localization/index')>()),
    loadLocaleMessages: mocks.loadLocaleMessages
}));

import i18n, { getTimeUnitLabels, setI18nLanguage } from './i18nService';

describe('i18nService', () => {
    beforeEach(async () => {
        mocks.loadLocaleMessages.mockReset();
        await setI18nLanguage('en');
    });

    // The fork ships English only, so every code that is not a registered
    // custom locale normalizes to "en" and a stale switch between two built-in
    // languages is no longer observable. What this still pins down is that an
    // unsupported code resolves to the English catalog and that the duration
    // labels are read from the active language rather than a stored snapshot.
    it('normalizes an unsupported locale to English', async () => {
        await setI18nLanguage('ja');

        expect(i18n.language).toBe('en');
        expect(getTimeUnitLabels()).toEqual({
            y: 'y',
            d: 'd',
            h: 'h',
            m: 'm',
            s: 's'
        });
    });

    it('reads duration labels from the active language without reloading a built-in catalog', async () => {
        await setI18nLanguage('ko');
        expect(i18n.language).toBe('en');

        const labels = getTimeUnitLabels();
        expect(labels).toEqual({ y: 'y', d: 'd', h: 'h', m: 'm', s: 's' });
        // English is bundled, so switching must not need a catalog load.
        expect(mocks.loadLocaleMessages).not.toHaveBeenCalled();
    });
});
