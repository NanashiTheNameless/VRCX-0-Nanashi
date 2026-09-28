import enMessages from './en.json';
import { registerLanguageCode, unregisterLanguageCode } from './locales';

export type LocalizedStringTable = Record<string, unknown> & {
    language?: string;
};

type LocaleLoader = () => Promise<{ default: LocalizedStringTable }>;

const languageNames: Record<string, string> = {
    en: 'English (en)'
};

// Fork: English only. Other locale files were removed.
const localeLoaders: Record<string, LocaleLoader> = {};

const loadedLocales = new Map<string, LocalizedStringTable>([
    ['en', enMessages]
]);
const pendingLocales = new Map<string, Promise<LocalizedStringTable>>();

export const FALLBACK_LOCALE_CODE = 'en';
export const fallbackLocaleMessages: LocalizedStringTable = enMessages;

export function getLoadedLocaleMessages(
    code: string
): LocalizedStringTable | undefined {
    return loadedLocales.get(code);
}

export function loadLocaleMessages(
    code: string
): Promise<LocalizedStringTable> {
    const loaded = loadedLocales.get(code);
    if (loaded) {
        return Promise.resolve(loaded);
    }

    const pending = pendingLocales.get(code);
    if (pending) {
        return pending;
    }

    const loader = localeLoaders[code];
    if (!loader) {
        return Promise.resolve(enMessages);
    }

    const request = loader()
        .then((module) => {
            const messages = module.default;
            loadedLocales.set(code, messages);
            pendingLocales.delete(code);
            return messages;
        })
        .catch((error: unknown) => {
            pendingLocales.delete(code);
            throw error;
        });
    pendingLocales.set(code, request);
    return request;
}

/** Register (or replace) a user-supplied locale table loaded at runtime. */
export function registerCustomLocale(
    code: string,
    name: string,
    messages: LocalizedStringTable
) {
    languageNames[code] = name;
    loadedLocales.set(code, messages);
    registerLanguageCode(code);
}

export function unregisterCustomLocale(code: string) {
    if (code === FALLBACK_LOCALE_CODE) {
        return;
    }
    delete languageNames[code];
    loadedLocales.delete(code);
    unregisterLanguageCode(code);
}

function getLanguageName(code: string) {
    return (languageNames[code] ?? code).replace(/\s+\([^)]+\)$/, '');
}

export * from './locales';
export { getLanguageName };
