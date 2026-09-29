import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import {
    FALLBACK_LOCALE_CODE,
    fallbackLocaleMessages,
    getLoadedLocaleMessages,
    loadLocaleMessages
} from '@/localization/index';
import { normalizeLanguageCode } from '@/localization/locales';
import type { TimeUnitLabels } from '@/shared/utils/dateTime';
import { isRecord } from '@/shared/utils/record';

const TIME_UNIT_KEYS = ['y', 'd', 'h', 'm', 's'] as const;
const i18nResources = {
    [FALLBACK_LOCALE_CODE]: { translation: fallbackLocaleMessages }
};

const i18n = createInstance();
const i18nReady = i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['translation'],
    defaultNS: 'translation',
    resources: i18nResources,
    interpolation: {
        escapeValue: false,
        prefix: '{',
        suffix: '}'
    },
    react: {
        useSuspense: false
    },
    returnNull: false
});

export default i18n;

function resolveMessage(messages: unknown, key: string): unknown {
    return key
        .split('.')
        .reduce(
            (current: unknown, part) =>
                isRecord(current) ? current[part] : undefined,
            messages
        );
}

function normalizeLocale(locale: string): string {
    return normalizeLanguageCode(locale);
}

export async function setI18nLanguage(locale: string): Promise<string> {
    const normalizedLocale = normalizeLocale(locale);
    await i18nReady;
    if (!i18n.hasResourceBundle(normalizedLocale, 'translation')) {
        const messages = await loadLocaleMessages(normalizedLocale);
        i18n.addResourceBundle(normalizedLocale, 'translation', messages);
    }
    await i18n.changeLanguage(normalizedLocale);
    return normalizedLocale;
}

export function getTimeUnitLabels(
    locale: string,
    defaultLabels: TimeUnitLabels
): TimeUnitLabels {
    const localizedMessages =
        getLoadedLocaleMessages(normalizeLocale(locale)) ?? {};
    const fallbackMessages = fallbackLocaleMessages;
    const labels: TimeUnitLabels = { ...defaultLabels };

    for (const unit of TIME_UNIT_KEYS) {
        const key = `common.time_units.${unit}`;
        const localized = resolveMessage(localizedMessages, key);
        const fallback = resolveMessage(fallbackMessages, key);
        labels[unit] =
            typeof localized === 'string'
                ? localized
                : typeof fallback === 'string'
                  ? fallback
                  : defaultLabels[unit];
    }

    return labels;
}
